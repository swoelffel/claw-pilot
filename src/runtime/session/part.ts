/**
 * runtime/session/part.ts
 *
 * Part CRUD operations on the rt_parts SQLite table.
 * Receives a Database instance directly — no withContext() here.
 *
 * A part is an atomic content unit within a message (text block, tool call,
 * tool result, reasoning trace, subtask reference, or compaction marker).
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { PartId, MessageId } from "../types.js";

/** Atomic content type of a message part */
export type PartType =
  | "text"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "subtask"
  | "compaction";

/** Lifecycle state of a part (relevant for tool_call / subtask parts) */
export type PartState = "pending" | "running" | "completed" | "error";

export interface PartInfo {
  id: PartId;
  messageId: MessageId;
  type: PartType;
  /** Only set for stateful part types (tool_call, subtask, etc.) */
  state: PartState | undefined;
  content: string | undefined;
  /** JSON-encoded metadata (tool name, args, result, etc.) */
  metadata: string | undefined;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// Row type from SQLite (all fields are string/number/null)
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

function fromRow(row: PartRow): PartInfo {
  return {
    id: row.id,
    messageId: row.message_id,
    type: row.type as PartType,
    state: (row.state ?? undefined) as PartState | undefined,
    content: row.content ?? undefined,
    metadata: row.metadata ?? undefined,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Return the next available sort_order for a message's parts.
 * Returns MAX(sort_order) + 1, or 0 if the message has no parts yet.
 */
export function getNextSortOrder(db: Database.Database, messageId: MessageId): number {
  const row = db
    .prepare("SELECT MAX(sort_order) AS max_order FROM rt_parts WHERE message_id = ?")
    .get(messageId) as { max_order: number | null };
  return row.max_order !== null ? row.max_order + 1 : 0;
}

/**
 * Create a new part for a message.
 * If sortOrder is not provided, it is auto-assigned as the next available value.
 */
export function createPart(
  db: Database.Database,
  input: {
    messageId: MessageId;
    type: PartType;
    content?: string;
    metadata?: string;
    sortOrder?: number;
  },
): PartInfo {
  const id = nanoid();
  const now = new Date().toISOString();
  const sortOrder = input.sortOrder ?? getNextSortOrder(db, input.messageId);

  db.prepare(
    `INSERT INTO rt_parts (id, message_id, type, content, metadata, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.messageId,
    input.type,
    input.content ?? null,
    input.metadata ?? null,
    sortOrder,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM rt_parts WHERE id = ?").get(id) as PartRow;
  return fromRow(row);
}

/**
 * Update the state (and optionally the content) of a part.
 * Always updates updated_at.
 */
export function updatePartState(
  db: Database.Database,
  id: PartId,
  state: PartState,
  content?: string,
): void {
  const now = new Date().toISOString();

  if (content !== undefined) {
    db.prepare("UPDATE rt_parts SET state = ?, content = ?, updated_at = ? WHERE id = ?").run(
      state,
      content,
      now,
      id,
    );
  } else {
    db.prepare("UPDATE rt_parts SET state = ?, updated_at = ? WHERE id = ?").run(state, now, id);
  }
}

/**
 * List all parts for a message, ordered by sort_order ascending.
 */
export function listParts(db: Database.Database, messageId: MessageId): PartInfo[] {
  const rows = db
    .prepare("SELECT * FROM rt_parts WHERE message_id = ? ORDER BY sort_order ASC")
    .all(messageId) as PartRow[];
  return rows.map(fromRow);
}
