/**
 * runtime/session/message-builder.ts
 *
 * Converts DB messages + their parts to Vercel AI SDK ModelMessage[].
 *
 * Performance: uses a single batched SQL query to load all parts for all
 * messages in one round-trip, avoiding the N+1 pattern of calling
 * listParts(db, msg.id) per message.
 */

import type Database from "better-sqlite3";
import type { ModelMessage, ToolResultPart } from "ai";
import type { MessageInfo } from "./message.js";
import type { PartInfo } from "./part.js";
import type { MessageId } from "../types.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Part row type (local — mirrors PartInfo DB row)
// ---------------------------------------------------------------------------

interface PartRow {
  id: string;
  message_id: string;
  type: string;
  state: string | null;
  content: string | null;
  metadata: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function fromPartRow(row: PartRow): PartInfo {
  return {
    id: row.id,
    messageId: row.message_id,
    type: row.type as PartInfo["type"],
    state: (row.state ?? undefined) as PartInfo["state"],
    content: row.content ?? undefined,
    metadata: row.metadata ?? undefined,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Batch part loader — single SQL join instead of N+1 per-message queries
// ---------------------------------------------------------------------------

/**
 * Load all parts for a set of messages in a single SQL query.
 * Returns a Map<messageId, PartInfo[]> sorted by sort_order ascending.
 *
 * This replaces the previous pattern of calling listParts(db, msg.id) in a loop,
 * which produced N SQLite round-trips for N messages.
 */
export function loadPartsBatch(
  db: Database.Database,
  messageIds: MessageId[],
): Map<MessageId, PartInfo[]> {
  if (messageIds.length === 0) return new Map();

  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM rt_parts
       WHERE message_id IN (${placeholders})
       ORDER BY message_id, sort_order ASC`,
    )
    .all(...messageIds) as PartRow[];

  const result = new Map<MessageId, PartInfo[]>();
  // Pre-populate keys so every message has an entry (even with 0 parts)
  for (const id of messageIds) result.set(id, []);

  for (const row of rows) {
    const bucket = result.get(row.message_id);
    if (bucket) bucket.push(fromPartRow(row));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool output pruning
// ---------------------------------------------------------------------------

const PRUNE_PROTECT_CHARS = 40_000;
const PRUNE_MINIMUM_CHARS = 20_000;

/**
 * Apply tool output pruning to a list of ModelMessages.
 * Oldest tool outputs are replaced with "[output pruned]" until total fits within limit.
 * DB data is never modified — only the in-memory LLM representation is trimmed.
 */
export function applyToolOutputPruning(messages: ModelMessage[]): ModelMessage[] {
  type ToolResultRef = { msgIndex: number; partIndex: number; chars: number };
  const toolResults: ToolResultRef[] = [];
  let totalChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    const parts = Array.isArray(msg.content) ? msg.content : [];
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (
        part &&
        part.type === "tool-result" &&
        part.output &&
        typeof part.output === "object" &&
        "value" in part.output &&
        typeof part.output.value === "string"
      ) {
        toolResults.push({ msgIndex: i, partIndex: j, chars: part.output.value.length });
        totalChars += part.output.value.length;
      }
    }
  }

  if (totalChars <= PRUNE_MINIMUM_CHARS) return messages;

  const pruned = messages.map((msg) => {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) return msg;
    return { ...msg, content: msg.content.map((p) => ({ ...p })) };
  }) as ModelMessage[];

  let remaining = totalChars;
  for (const ref of toolResults) {
    if (remaining <= PRUNE_PROTECT_CHARS) break;
    const msg = pruned[ref.msgIndex];
    if (!msg || msg.role !== "tool" || !Array.isArray(msg.content)) continue;
    const part = msg.content[ref.partIndex];
    if (
      part &&
      part.type === "tool-result" &&
      part.output &&
      typeof part.output === "object" &&
      "value" in part.output &&
      typeof part.output.value === "string"
    ) {
      remaining -= ref.chars;
      (part.output as { type: string; value: string }).value = "[output pruned]";
    }
  }

  return pruned;
}

// ---------------------------------------------------------------------------
// Prompt caching (Anthropic)
// ---------------------------------------------------------------------------

/**
 * Apply Anthropic prompt caching markers to system prompt and messages.
 * For non-Anthropic providers, returns inputs unchanged.
 */
export function applyCaching(
  systemPrompt: string,
  messages: ModelMessage[],
  providerId: string,
): { system: string; messages: ModelMessage[]; systemProviderOptions?: Record<string, unknown> } {
  if (providerId !== "anthropic") {
    return { system: systemPrompt, messages };
  }

  const nonSystemIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && msg.role !== "system") nonSystemIndices.push(i);
  }
  const indicesToCache = nonSystemIndices.slice(-2);

  const cachedMessages = messages.map((msg, i) => {
    if (!indicesToCache.includes(i) || !msg) return msg;

    if (typeof msg.content === "string") {
      return {
        ...msg,
        content: [
          {
            type: "text" as const,
            text: msg.content,
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
        ],
      };
    }

    if (Array.isArray(msg.content) && msg.content.length > 0) {
      const contentCopy = [...msg.content];
      const lastIdx = contentCopy.length - 1;
      const lastPart = contentCopy[lastIdx];
      if (lastPart && lastPart.type === "text") {
        contentCopy[lastIdx] = {
          ...lastPart,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        };
      }
      return { ...msg, content: contentCopy };
    }

    return msg;
  });

  return {
    system: systemPrompt,
    messages: cachedMessages as ModelMessage[],
    systemProviderOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}

// ---------------------------------------------------------------------------
// Core message builder — helpers
// ---------------------------------------------------------------------------

interface ToolCallMeta {
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

/** Parse tool-call metadata JSON, returning undefined on malformed data. */
function parseToolCallMeta(metadata: string | undefined): ToolCallMeta | undefined {
  if (!metadata) return undefined;
  try {
    const meta = JSON.parse(metadata) as {
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
    };
    if (meta.toolCallId && meta.toolName) {
      return { toolCallId: meta.toolCallId, toolName: meta.toolName, args: meta.args };
    }
  } catch (err) {
    logger.warn("[message-builder] JSON.parse of tool metadata failed", {
      error: String(err),
    });
  }
  return undefined;
}

/** Parse image mime type from part metadata, defaulting to image/jpeg. */
function parseImageMimeType(metadata: string | undefined): string {
  if (!metadata) return "image/jpeg";
  try {
    const meta = JSON.parse(metadata) as { mimeType?: string };
    if (meta.mimeType) return meta.mimeType;
  } catch (err) {
    logger.warn("[message-builder] JSON.parse of image metadata failed", {
      error: String(err),
    });
  }
  return "image/jpeg";
}

/** Build a user-role ModelMessage from parts (text-only or multipart with images). */
function buildUserMessage(parts: PartInfo[]): ModelMessage | undefined {
  const textParts = parts.filter((p) => p.type === "text");
  const imageParts = parts.filter((p) => p.type === "image");
  const text = textParts.map((p) => p.content ?? "").join("\n");

  if (imageParts.length > 0 && text) {
    const contentArray: Array<
      { type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }
    > = [{ type: "text", text }];

    for (const imgPart of imageParts) {
      if (!imgPart.content) continue;
      const mimeType = parseImageMimeType(imgPart.metadata);
      contentArray.push({
        type: "image",
        image: imgPart.content,
        ...(mimeType !== undefined ? { mimeType } : {}),
      });
    }
    return { role: "user", content: contentArray } as ModelMessage;
  }

  if (text) return { role: "user", content: text };
  return undefined;
}

/** Build assistant + tool-result ModelMessages from parts. */
function buildAssistantMessages(parts: PartInfo[]): ModelMessage[] {
  const textParts = parts.filter((p) => p.type === "text" || p.type === "compaction");
  const toolCallParts = parts.filter((p) => p.type === "tool_call");
  const result: ModelMessage[] = [];

  if (toolCallParts.length === 0) {
    const text = textParts.map((p) => p.content ?? "").join("\n");
    if (text) result.push({ role: "assistant", content: text });
    return result;
  }

  // Build assistant content: text parts + tool-call parts
  const contentParts: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  > = [];

  for (const tp of textParts) {
    if (tp.content) contentParts.push({ type: "text", text: tp.content });
  }

  for (const tcp of toolCallParts) {
    const meta = parseToolCallMeta(tcp.metadata);
    if (meta) {
      contentParts.push({
        type: "tool-call",
        toolCallId: meta.toolCallId,
        toolName: meta.toolName,
        input: meta.args ?? {},
      });
    }
  }

  if (contentParts.length > 0) result.push({ role: "assistant", content: contentParts });

  // Build tool-result messages for every tool-call — even on error or
  // unexpected termination.  Without this, MissingToolResultsError permanently
  // breaks permanent sessions.
  const toolResults: ToolResultPart[] = [];
  for (const tcp of toolCallParts) {
    const meta = parseToolCallMeta(tcp.metadata);
    if (!meta) continue;

    let output: string;
    if (tcp.state === "completed" && tcp.content) {
      output = tcp.content;
    } else if (tcp.state === "error") {
      output = tcp.content ?? "[Tool execution failed]";
    } else {
      output = "[Tool execution was interrupted unexpectedly]";
    }

    toolResults.push({
      type: "tool-result",
      toolCallId: meta.toolCallId,
      toolName: meta.toolName,
      output: { type: "text", value: output },
    });
  }

  if (toolResults.length > 0) result.push({ role: "tool", content: toolResults });
  return result;
}

// ---------------------------------------------------------------------------
// Core message builder
// ---------------------------------------------------------------------------

/**
 * Convert DB messages + their parts to Vercel AI SDK ModelMessage[].
 * Uses a single batched SQL query via loadPartsBatch() — 1 query instead of N.
 */
export function buildCoreMessages(db: Database.Database, messages: MessageInfo[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  // Batch-load all parts in a single SQL round-trip
  const partsMap = loadPartsBatch(
    db,
    messages.map((m) => m.id),
  );

  for (const msg of messages) {
    const parts = partsMap.get(msg.id) ?? [];

    if (msg.role === "user") {
      const userMsg = buildUserMessage(parts);
      if (userMsg) result.push(userMsg);
    } else {
      result.push(...buildAssistantMessages(parts));
    }
  }

  return applyToolOutputPruning(result);
}
