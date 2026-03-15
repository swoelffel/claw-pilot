/**
 * runtime/session/compaction.ts
 *
 * Automatic context compaction for claw-runtime.
 *
 * When the token count approaches the model's context window limit, this module
 * generates a summary of the conversation and replaces the history with a
 * compaction marker + the summary.
 *
 * Inspired by OpenCode's session/compaction.ts but simplified for V1:
 * - No plugin hooks (Phase 2)
 * - No media stripping (Phase 2)
 * - Uses generateText (not streaming) for the summary
 */

import { generateText } from "ai";
import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import { listMessages, createAssistantMessage, updateMessageMetadata } from "./message.js";
import { createPart, listParts } from "./part.js";
import { getBus } from "../bus/index.js";
import { SessionStatusChanged, MessageCreated, MessageUpdated } from "../bus/events.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fraction of context window that triggers compaction */
const COMPACTION_THRESHOLD = 0.85;

/** Tokens to reserve for the compaction summary output */
const COMPACTION_RESERVED_TOKENS = 8_000;

/** Prompt used to generate the compaction summary */
const COMPACTION_PROMPT = `Provide a detailed summary of our conversation above that can be used to continue the work.
Focus on:
- What goal(s) the user is trying to accomplish
- Important instructions and constraints given
- What has been accomplished so far
- What is currently in progress
- What still needs to be done
- Key files, directories, and code structures involved

Format the summary as a structured document that another agent can read to continue the work seamlessly.`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CompactionInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  agentConfig: RuntimeAgentConfig;
  resolvedModel: ResolvedModel;
  /** Current token count (from the last LLM response) */
  currentTokens: number;
  /** Model context window size in tokens */
  contextWindow: number;
}

export interface CompactionResult {
  /** Whether compaction was performed */
  compacted: boolean;
  /** ID of the compaction message created (if compacted) */
  compactionMessageId: string | undefined;
}

// ---------------------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------------------

/**
 * Check if compaction should be triggered based on current token usage.
 */
export function shouldCompact(input: {
  currentTokens: number;
  contextWindow: number;
  threshold?: number;
  reservedTokens?: number;
}): boolean {
  if (input.contextWindow <= 0) return false;

  const threshold = input.threshold ?? COMPACTION_THRESHOLD;
  const reserved = input.reservedTokens ?? COMPACTION_RESERVED_TOKENS;
  const usable = input.contextWindow - reserved;

  return input.currentTokens >= usable * threshold;
}

/**
 * Perform compaction: generate a summary of the conversation and mark it
 * in the DB with a compaction part.
 *
 * After compaction, the prompt loop should use only the compaction summary
 * as context instead of the full message history.
 */
export async function compact(input: CompactionInput): Promise<CompactionResult> {
  const { db, instanceSlug, sessionId, agentConfig, resolvedModel } = input;

  const bus = getBus(instanceSlug);
  bus.publish(SessionStatusChanged, { sessionId, status: "busy" });

  try {
    // Load all messages to build the compaction context
    const messages = listMessages(db, sessionId);
    if (messages.length === 0) {
      return { compacted: false, compactionMessageId: undefined };
    }

    // Build a text representation of the conversation for the summary
    const conversationText = buildConversationText(db, messages);

    // Generate the summary using the LLM
    const summaryResult = await generateText({
      model: resolvedModel.languageModel,
      messages: [
        {
          role: "user",
          content: `${conversationText}\n\n---\n\n${COMPACTION_PROMPT}`,
        },
      ],
    });

    const summary = summaryResult.text;

    // Create a compaction assistant message
    const compactionMsg = createAssistantMessage(db, {
      sessionId,
      agentId: agentConfig.id,
      model: `${resolvedModel.providerId}/${resolvedModel.modelId}`,
    });

    bus.publish(MessageCreated, {
      sessionId,
      messageId: compactionMsg.id,
      role: "assistant",
    });

    // Add a compaction part with the summary
    createPart(db, {
      messageId: compactionMsg.id,
      type: "compaction",
      content: summary,
      metadata: JSON.stringify({
        compactedMessageCount: messages.length,
        compactedAt: new Date().toISOString(),
      }),
    });

    // Update message metadata
    const usage = summaryResult.usage;
    updateMessageMetadata(db, compactionMsg.id, {
      tokensIn: usage.inputTokens ?? 0,
      tokensOut: usage.outputTokens ?? 0,
      finishReason: summaryResult.finishReason,
    });

    bus.publish(MessageUpdated, { sessionId, messageId: compactionMsg.id });

    return { compacted: true, compactionMessageId: compactionMsg.id };
  } finally {
    bus.publish(SessionStatusChanged, { sessionId, status: "idle" });
  }
}

/**
 * Get the compaction summary for a session (if any).
 * Returns the content of the most recent compaction part, or undefined.
 */
export function getCompactionSummary(
  db: Database.Database,
  sessionId: SessionId,
): string | undefined {
  const messages = listMessages(db, sessionId);

  // Find the most recent compaction part (search backwards)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const parts = listParts(db, msg.id);
    const compactionPart = parts.find((p) => p.type === "compaction");
    if (compactionPart?.content) {
      return compactionPart.content;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildConversationText(
  db: Database.Database,
  messages: ReturnType<typeof listMessages>,
): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const parts = listParts(db, msg.id);
    const textContent = parts
      .filter((p) => p.type === "text" || p.type === "compaction")
      .map((p) => p.content ?? "")
      .filter(Boolean)
      .join("\n");

    if (!textContent) continue;

    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`**${role}:**\n${textContent}`);
  }

  return lines.join("\n\n---\n\n");
}
