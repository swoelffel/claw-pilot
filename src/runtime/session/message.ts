/**
 * runtime/session/message.ts
 *
 * Message CRUD operations on the rt_messages SQLite table.
 * Receives a Database instance directly — no withContext() here.
 *
 * A message represents a single turn (user or assistant) within a session.
 * Parts (text, tool_call, etc.) are stored separately in rt_parts.
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { MessageId, SessionId, AgentId } from "../types.js";
import { createPart } from "./part.js";

export interface MessageInfo {
  id: MessageId;
  sessionId: SessionId;
  role: "user" | "assistant";
  agentId: AgentId | undefined;
  model: string | undefined;
  tokensIn: number | undefined;
  tokensOut: number | undefined;
  costUsd: number | undefined;
  finishReason: string | undefined;
  isCompaction: boolean;
  createdAt: Date;
}

// Row type from SQLite (all fields are string/number/null)
interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  agent_id: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  finish_reason: string | null;
  is_compaction: number;
  created_at: string;
}

function fromRow(row: MessageRow): MessageInfo {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as "user" | "assistant",
    agentId: row.agent_id ?? undefined,
    model: row.model ?? undefined,
    tokensIn: row.tokens_in ?? undefined,
    tokensOut: row.tokens_out ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    finishReason: row.finish_reason ?? undefined,
    isCompaction: row.is_compaction === 1,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Create a user message and immediately add a text part with the provided text.
 */
export function createUserMessage(
  db: Database.Database,
  input: { sessionId: SessionId; text: string },
): MessageInfo {
  const id = nanoid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, created_at)
     VALUES (?, ?, 'user', ?)`,
  ).run(id, input.sessionId, now);

  // Create the initial text part
  createPart(db, { messageId: id, type: "text", content: input.text });

  const row = db.prepare("SELECT * FROM rt_messages WHERE id = ?").get(id) as MessageRow;
  return fromRow(row);
}

/**
 * Create an empty assistant message. Parts are added separately as the
 * assistant streams its response.
 */
export function createAssistantMessage(
  db: Database.Database,
  input: { sessionId: SessionId; agentId?: AgentId; model?: string },
): MessageInfo {
  const id = nanoid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, model, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?)`,
  ).run(id, input.sessionId, input.agentId ?? null, input.model ?? null, now);

  const row = db.prepare("SELECT * FROM rt_messages WHERE id = ?").get(id) as MessageRow;
  return fromRow(row);
}

/**
 * Update token counts, cost, and finish reason after the assistant turn completes.
 */
export function updateMessageMetadata(
  db: Database.Database,
  id: MessageId,
  meta: {
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    finishReason?: string;
  },
): void {
  db.prepare(
    `UPDATE rt_messages
     SET tokens_in    = COALESCE(?, tokens_in),
         tokens_out   = COALESCE(?, tokens_out),
         cost_usd     = COALESCE(?, cost_usd),
         finish_reason = COALESCE(?, finish_reason)
     WHERE id = ?`,
  ).run(
    meta.tokensIn ?? null,
    meta.tokensOut ?? null,
    meta.costUsd ?? null,
    meta.finishReason ?? null,
    id,
  );
}

/**
 * List all messages for a session, ordered chronologically (oldest first).
 */
export function listMessages(db: Database.Database, sessionId: SessionId): MessageInfo[] {
  const rows = db
    .prepare("SELECT * FROM rt_messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as MessageRow[];
  return rows.map(fromRow);
}

/**
 * Get a single message by ID.
 */
export function getMessage(db: Database.Database, id: MessageId): MessageInfo | undefined {
  const row = db.prepare("SELECT * FROM rt_messages WHERE id = ?").get(id) as
    | MessageRow
    | undefined;
  return row ? fromRow(row) : undefined;
}
