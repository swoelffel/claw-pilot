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
 *
 * Optional `metadata` is a JSON string attached to the text part — used to
 * carry structured context (e.g. `subSessionId` for delegation traces that
 * the UI drills into).
 */
export function createUserMessage(
  db: Database.Database,
  input: { sessionId: SessionId; text: string; metadata?: string; createdAt?: string },
): MessageInfo {
  const id = nanoid();
  const now = input.createdAt ?? new Date().toISOString();

  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, created_at)
     VALUES (?, ?, 'user', ?)`,
  ).run(id, input.sessionId, now);

  // Create the initial text part
  createPart(db, {
    messageId: id,
    type: "text",
    content: input.text,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });

  const row = db.prepare("SELECT * FROM rt_messages WHERE id = ?").get(id) as MessageRow;
  return fromRow(row);
}

/**
 * Create an empty assistant message. Parts are added separately as the
 * assistant streams its response.
 */
export function createAssistantMessage(
  db: Database.Database,
  input: { sessionId: SessionId; agentId?: AgentId; model?: string; isCompaction?: boolean },
): MessageInfo {
  const id = nanoid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, model, created_at, is_compaction)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
  ).run(
    id,
    input.sessionId,
    input.agentId ?? null,
    input.model ?? null,
    now,
    input.isCompaction ? 1 : 0,
  );

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

/** The summary may finish after new notifications arrive; its snapshot defines the cutoff. */
function lastCompactionBoundary(
  db: Database.Database,
  sessionId: SessionId,
): { id: string; created_at: string; row_id: number } | undefined {
  return db
    .prepare(
      `SELECT m.id,
      COALESCE(cutoff.created_at, m.created_at) AS created_at,
      COALESCE(cutoff.rowid, m.rowid) AS row_id
    FROM rt_messages m
    LEFT JOIN rt_parts p ON p.message_id = m.id AND p.type = 'compaction'
    LEFT JOIN rt_messages cutoff ON cutoff.id = CASE WHEN json_valid(p.metadata)
      THEN json_extract(p.metadata, '$.cutoffMessageId') END
      AND cutoff.session_id = m.session_id AND cutoff.rowid < m.rowid
    WHERE m.session_id = ? AND m.is_compaction = 1
    ORDER BY m.created_at DESC, m.rowid DESC, p.sort_order ASC
    LIMIT 1`,
    )
    .get(sessionId) as { id: string; created_at: string; row_id: number } | undefined;
}

/**
 * Charge les messages d'une session en partant de la derniere compaction.
 * Si aucune compaction n'existe, retourne tous les messages (comportement actuel).
 *
 * Resultat : [message_compaction, ...messages_posterieurs]
 * Le message de compaction est toujours le premier element si present.
 */
export function listMessagesFromCompaction(
  db: Database.Database,
  sessionId: SessionId,
): MessageInfo[] {
  const lastCompaction = lastCompactionBoundary(db, sessionId);

  if (!lastCompaction) {
    // Pas de compaction — comportement actuel inchange
    return listMessages(db, sessionId);
  }

  // Insertion order preserves concurrent and backdated notifications outside the snapshot.
  const rows = db
    .prepare(
      `SELECT * FROM rt_messages
       WHERE session_id = ?
         AND (id = ? OR (is_compaction = 0 AND rowid > ?))
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, rowid ASC`,
    )
    .all(sessionId, lastCompaction.id, lastCompaction.row_id, lastCompaction.id) as MessageRow[];

  return rows.map(fromRow);
}

/**
 * Compte les messages depuis la derniere compaction (ou depuis le debut si aucune).
 * Utilise pour le declenchement de la compaction periodique (Phase 3).
 */
export function countMessagesSinceLastCompaction(
  db: Database.Database,
  sessionId: SessionId,
): number {
  const lastCompaction = lastCompactionBoundary(db, sessionId);

  if (!lastCompaction) {
    return (
      db
        .prepare(`SELECT COUNT(*) as count FROM rt_messages WHERE session_id = ?`)
        .get(sessionId) as { count: number }
    ).count;
  }

  return (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM rt_messages
         WHERE session_id = ? AND is_compaction = 0 AND rowid > ?`,
      )
      .get(sessionId, lastCompaction.row_id) as { count: number }
  ).count;
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
