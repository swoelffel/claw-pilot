/**
 * runtime/session/session.ts
 *
 * Session CRUD operations on the rt_sessions SQLite table.
 * Receives a Database instance directly — no withContext() here.
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { SessionId, InstanceSlug, AgentId, MessageId } from "../types.js";
import { listMessages } from "./message.js";
import { listParts, createPart } from "./part.js";

export interface SessionInfo {
  id: SessionId;
  instanceSlug: InstanceSlug;
  parentId: SessionId | undefined;
  agentId: AgentId;
  channel: string;
  peerId: string | undefined;
  title: string | undefined;
  state: "active" | "archived";
  permissions: string | undefined;
  createdAt: Date;
  updatedAt: Date;
  /** Business key: "<instanceSlug>:<agentId>:<channel>:<peerId|unknown>" */
  sessionKey: string | undefined;
  /** Depth in the session tree (0 = root, 1 = first sub-agent, etc.) */
  spawnDepth: number;
  /** Optional human-readable label */
  label: string | undefined;
  /** Extensible JSON metadata blob */
  metadata: string | undefined;
}

// Row type from SQLite (all fields are string/number/null)
interface SessionRow {
  id: string;
  instance_slug: string;
  parent_id: string | null;
  agent_id: string;
  channel: string;
  peer_id: string | null;
  title: string | null;
  state: string;
  permissions: string | null;
  created_at: string;
  updated_at: string;
  session_key: string | null;
  spawn_depth: number;
  label: string | null;
  metadata: string | null;
}

function fromRow(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    instanceSlug: row.instance_slug,
    parentId: row.parent_id ?? undefined,
    agentId: row.agent_id,
    channel: row.channel,
    peerId: row.peer_id ?? undefined,
    title: row.title ?? undefined,
    state: row.state as "active" | "archived",
    permissions: row.permissions ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    sessionKey: row.session_key ?? undefined,
    spawnDepth: row.spawn_depth ?? 0,
    label: row.label ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

/**
 * Build the business key for a session.
 * Format: "<instanceSlug>:<agentId>:<channel>:<peerId|unknown>"
 */
export function buildSessionKey(
  instanceSlug: string,
  agentId: string,
  channel: string,
  peerId: string | undefined,
): string {
  return `${instanceSlug}:${agentId}:${channel}:${peerId ?? "unknown"}`;
}

export function createSession(
  db: Database.Database,
  input: {
    instanceSlug: InstanceSlug;
    agentId: AgentId;
    channel?: string;
    peerId?: string;
    parentId?: SessionId;
    label?: string;
  },
): SessionInfo {
  const id = nanoid();
  const now = new Date().toISOString();
  const channel = input.channel ?? "web";

  // Compute spawn depth from parent session
  const spawnDepth = input.parentId ? (getSession(db, input.parentId)?.spawnDepth ?? 0) + 1 : 0;

  // Compute session key.
  // When peerId is absent (no external peer, e.g. channel "api" or "web"), append the session id
  // to guarantee uniqueness — otherwise every new root session would collide on the UNIQUE index.
  const sessionKey = buildSessionKey(
    input.instanceSlug,
    input.agentId,
    channel,
    input.peerId ?? id,
  );

  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, parent_id, agent_id, channel, peer_id, session_key, spawn_depth, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.instanceSlug,
    input.parentId ?? null,
    input.agentId,
    channel,
    input.peerId ?? null,
    sessionKey,
    spawnDepth,
    input.label ?? null,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM rt_sessions WHERE id = ?").get(id) as SessionRow;
  return fromRow(row);
}

export function getSession(db: Database.Database, id: SessionId): SessionInfo | undefined {
  const row = db.prepare("SELECT * FROM rt_sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Find a session by its business key (O(1) lookup via unique index).
 */
export function getSessionByKey(db: Database.Database, key: string): SessionInfo | undefined {
  const row = db.prepare("SELECT * FROM rt_sessions WHERE session_key = ?").get(key) as
    | SessionRow
    | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Count active child sessions for a given parent session.
 * Used to enforce maxChildrenPerSession limits.
 */
export function countActiveChildren(db: Database.Database, parentId: SessionId): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM rt_sessions WHERE parent_id = ? AND state = 'active'")
    .get(parentId) as { count: number };
  return row.count;
}

export function listSessions(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  options?: { state?: "active" | "archived"; limit?: number },
): SessionInfo[] {
  const state = options?.state;
  const limit = options?.limit ?? 100;

  let sql = "SELECT * FROM rt_sessions WHERE instance_slug = ?";
  const params: (string | number)[] = [instanceSlug];

  if (state) {
    sql += " AND state = ?";
    params.push(state);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as SessionRow[];
  return rows.map(fromRow);
}

export function updateSessionTitle(db: Database.Database, id: SessionId, title: string): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE rt_sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id);
}

export function archiveSession(db: Database.Database, id: SessionId): void {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE rt_sessions SET state = 'archived', updated_at = ? WHERE id = ? AND state = 'active'",
  ).run(now, id);
}

export function forkSession(
  db: Database.Database,
  sourceId: SessionId,
  options?: { agentId?: AgentId; upToMessageId?: MessageId },
): SessionInfo {
  const source = getSession(db, sourceId);
  if (!source) throw new Error(`Session not found: ${sourceId}`);

  // Count existing forks to generate a unique label
  const forkCount = (
    db.prepare("SELECT COUNT(*) AS count FROM rt_sessions WHERE parent_id = ?").get(sourceId) as {
      count: number;
    }
  ).count;

  const newSession = createSession(db, {
    instanceSlug: source.instanceSlug,
    agentId: options?.agentId ?? source.agentId,
    channel: source.channel,
    ...(source.peerId !== undefined ? { peerId: source.peerId } : {}),
    parentId: sourceId,
    label: `${source.title ?? sourceId} (fork #${forkCount + 1})`,
  });

  // Copy messages up to upToMessageId (inclusive), or all messages
  const allMessages = listMessages(db, sourceId);
  const messages =
    options?.upToMessageId !== undefined
      ? allMessages.slice(0, allMessages.findIndex((m) => m.id === options.upToMessageId) + 1)
      : allMessages;

  for (const msg of messages) {
    const newMsgId = nanoid();
    const msgCreatedAt = msg.createdAt.toISOString();

    // Insert the message with a new ID but preserve the original created_at
    db.prepare(
      `INSERT INTO rt_messages (id, session_id, role, agent_id, model, tokens_in, tokens_out, cost_usd, finish_reason, is_compaction, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newMsgId,
      newSession.id,
      msg.role,
      msg.agentId ?? null,
      msg.model ?? null,
      msg.tokensIn ?? null,
      msg.tokensOut ?? null,
      msg.costUsd ?? null,
      msg.finishReason ?? null,
      msg.isCompaction ? 1 : 0,
      msgCreatedAt,
    );

    // Copy all parts of this message
    const parts = listParts(db, msg.id);
    for (const part of parts) {
      createPart(db, {
        messageId: newMsgId,
        type: part.type,
        ...(part.content !== undefined ? { content: part.content } : {}),
        ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
        sortOrder: part.sortOrder,
      });
    }
  }

  return newSession;
}
