/**
 * runtime/session/session.ts
 *
 * Session CRUD operations on the rt_sessions SQLite table.
 * Receives a Database instance directly — no withContext() here.
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { SessionId, InstanceSlug, AgentId } from "../types.js";

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
  };
}

export function createSession(
  db: Database.Database,
  input: {
    instanceSlug: InstanceSlug;
    agentId: AgentId;
    channel?: string;
    peerId?: string;
    parentId?: SessionId;
  },
): SessionInfo {
  const id = nanoid();
  const now = new Date().toISOString();
  const channel = input.channel ?? "web";

  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, parent_id, agent_id, channel, peer_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.instanceSlug,
    input.parentId ?? null,
    input.agentId,
    channel,
    input.peerId ?? null,
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
  options?: { agentId?: AgentId },
): SessionInfo {
  const source = getSession(db, sourceId);
  if (!source) throw new Error(`Session not found: ${sourceId}`);

  return createSession(db, {
    instanceSlug: source.instanceSlug,
    agentId: options?.agentId ?? source.agentId,
    channel: source.channel,
    ...(source.peerId !== undefined ? { peerId: source.peerId } : {}),
    parentId: sourceId,
  });
}
