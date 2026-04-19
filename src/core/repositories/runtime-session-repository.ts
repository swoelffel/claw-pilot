// src/core/repositories/runtime-session-repository.ts
//
// Repository for rt_sessions queries that require aggregated stats.
// Extracted from dashboard/routes/instances/runtime.ts to keep route handlers thin.
//
// Also exposes purgeArchivedSessions() for on-demand cleanup of ephemeral sessions.

import type Database from "better-sqlite3";
import { listSessions } from "../../runtime/index.js";
import { logger } from "../../lib/logger.js";

export interface PurgeResult {
  sessionsDeleted: number;
  messagesDeleted: number;
  partsDeleted: number;
}

export interface EnrichedSessionRow {
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
  persistent: number; // SQLite INTEGER: 0 = false, 1 = true
  total_cost_usd: number;
  message_count: number;
  total_tokens: number;
  agent_name: string | null;
  agent_is_default: number | null;
}

export interface EnrichedSession {
  id: string;
  instanceSlug: string;
  parentId: string | undefined;
  agentId: string;
  channel: string;
  peerId: string | undefined;
  title: string | undefined;
  state: "active" | "archived";
  permissions: string | undefined;
  createdAt: string;
  updatedAt: string;
  sessionKey: string | undefined;
  spawnDepth: number;
  label: string | undefined;
  metadata: string | undefined;
  persistent: boolean;
  agentName?: string;
  agentIsDefault?: boolean;
  // Aggregated fields
  totalCostUsd: number;
  messageCount: number;
  totalTokens: number;
}

export interface ListEnrichedSessionsOptions {
  /** Filter by session state. "all" returns both active and archived. Default: "active". */
  state?: "active" | "archived" | "all";
  limit?: number;
  includeInternal?: boolean;
  /** Filter by agent ID. */
  agentId?: string;
  /** Only return sessions created at or after this ISO datetime. */
  since?: string;
  /** Only return sessions created at or before this ISO datetime. */
  until?: string;
  /** Filter by persistence: 0 = ephemeral, 1 = permanent. */
  persistent?: 0 | 1;
  /** Cursor for infinite scroll: return sessions created before this ISO datetime. */
  before?: string;
}

export interface ListEnrichedSessionsResult {
  sessions: EnrichedSession[];
  hasMore: boolean;
}

/**
 * List sessions for an instance with aggregated stats (cost, message count, tokens).
 *
 * Falls back to listSessions() if the enriched query fails (e.g. on older DB schemas
 * missing the session_key or spawn_depth columns), returning sessions without aggregates.
 */
export function listEnrichedSessions(
  db: Database.Database,
  instanceSlug: string,
  opts: ListEnrichedSessionsOptions = {},
): ListEnrichedSessionsResult {
  const resolvedState = opts.state ?? "active";
  const limit = opts.limit ?? 50;
  const includeInternal = opts.includeInternal ?? false;
  const safeLimit = isNaN(limit) ? 50 : limit;

  let sql = `
    SELECT s.*,
      COALESCE(SUM(m.cost_usd), 0) as total_cost_usd,
      COUNT(m.id) as message_count,
      COALESCE(SUM(COALESCE(m.tokens_in, 0) + COALESCE(m.tokens_out, 0)), 0) as total_tokens,
      a.name as agent_name,
      a.is_default as agent_is_default
    FROM rt_sessions s
    LEFT JOIN rt_messages m ON m.session_id = s.id
    LEFT JOIN instances i ON i.slug = s.instance_slug
    LEFT JOIN agents a ON a.agent_id = s.agent_id AND a.instance_id = i.id
    WHERE s.instance_slug = ?
  `;
  const params: (string | number)[] = [instanceSlug];

  if (resolvedState !== "all") {
    sql += " AND s.state = ?";
    params.push(resolvedState);
  }

  if (!includeInternal) {
    sql += " AND s.channel != 'internal'";
  }

  if (opts.agentId !== undefined) {
    sql += " AND s.agent_id = ?";
    params.push(opts.agentId);
  }

  if (opts.since !== undefined) {
    sql += " AND s.created_at >= ?";
    params.push(opts.since);
  }

  if (opts.until !== undefined) {
    sql += " AND s.created_at <= ?";
    params.push(opts.until);
  }

  if (opts.persistent !== undefined) {
    sql += " AND s.persistent = ?";
    params.push(opts.persistent);
  }

  if (opts.before !== undefined) {
    sql += " AND s.created_at < ?";
    params.push(opts.before);
  }

  // Request limit + 1 to determine hasMore
  sql += " GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?";
  params.push(safeLimit + 1);

  let rows: EnrichedSessionRow[];
  try {
    rows = db.prepare(sql).all(...params) as EnrichedSessionRow[];
  } catch (err) {
    logger.error("[runtime-session-repository] enriched query failed, falling back", {
      error: String(err),
    });
    const fallback = listSessions(db, instanceSlug, {
      ...(resolvedState !== "all" ? { state: resolvedState } : {}),
      limit: safeLimit,
      ...(includeInternal ? {} : { excludeChannels: ["internal"] }),
    });
    const sessions = fallback.map((s) => ({
      id: s.id,
      instanceSlug: s.instanceSlug,
      parentId: s.parentId,
      agentId: s.agentId,
      channel: s.channel,
      peerId: s.peerId,
      title: s.title,
      state: s.state as "active" | "archived",
      permissions: s.permissions,
      createdAt: typeof s.createdAt === "string" ? s.createdAt : s.createdAt.toISOString(),
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : s.updatedAt.toISOString(),
      sessionKey: s.sessionKey,
      spawnDepth: s.spawnDepth ?? 0,
      label: s.label,
      metadata: s.metadata,
      persistent: s.persistent,
      totalCostUsd: 0,
      messageCount: 0,
      totalTokens: 0,
    }));
    return { sessions, hasMore: false };
  }

  const hasMore = rows.length > safeLimit;
  if (hasMore) rows = rows.slice(0, safeLimit);

  const sessions = rows.map((row) => ({
    id: row.id,
    instanceSlug: row.instance_slug,
    parentId: row.parent_id ?? undefined,
    agentId: row.agent_id,
    channel: row.channel,
    peerId: row.peer_id ?? undefined,
    title: row.title ?? undefined,
    state: row.state as "active" | "archived",
    permissions: row.permissions ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionKey: row.session_key ?? undefined,
    spawnDepth: row.spawn_depth ?? 0,
    label: row.label ?? undefined,
    metadata: row.metadata ?? undefined,
    persistent: row.persistent === 1,
    ...(row.agent_name != null ? { agentName: row.agent_name } : {}),
    ...(row.agent_is_default != null ? { agentIsDefault: row.agent_is_default === 1 } : {}),
    totalCostUsd: row.total_cost_usd ?? 0,
    messageCount: row.message_count ?? 0,
    totalTokens: row.total_tokens ?? 0,
  }));

  return { sessions, hasMore };
}

/**
 * Immediately delete ALL archived ephemeral sessions for an instance.
 * Permanent sessions (persistent=1) are never touched.
 * Deletes in FK order: parts → messages → sessions.
 */
export function purgeArchivedSessions(db: Database.Database, instanceSlug: string): PurgeResult {
  const toDelete = db
    .prepare(
      `SELECT id FROM rt_sessions
       WHERE instance_slug = ? AND state = 'archived' AND persistent = 0`,
    )
    .all(instanceSlug) as Array<{ id: string }>;

  if (toDelete.length === 0) {
    return { sessionsDeleted: 0, messagesDeleted: 0, partsDeleted: 0 };
  }

  const ids = toDelete.map((s) => s.id);
  const ph = ids.map(() => "?").join(", ");

  const result = db.transaction(() => {
    const parts = db
      .prepare(
        `DELETE FROM rt_parts WHERE message_id IN
         (SELECT id FROM rt_messages WHERE session_id IN (${ph}))`,
      )
      .run(...ids);
    const messages = db.prepare(`DELETE FROM rt_messages WHERE session_id IN (${ph})`).run(...ids);
    const sessions = db.prepare(`DELETE FROM rt_sessions WHERE id IN (${ph})`).run(...ids);
    return {
      partsDeleted: parts.changes,
      messagesDeleted: messages.changes,
      sessionsDeleted: sessions.changes,
    };
  })();

  return result;
}

/**
 * Count all messages belonging to the session identified by a given session_key.
 * Returns 0 if no matching session exists.
 * Used to guard one-shot operations (e.g. kickoff) against re-entry.
 */
export function countMessagesBySessionKey(db: Database.Database, sessionKey: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       WHERE s.session_key = ?`,
    )
    .get(sessionKey) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

/**
 * Delete ALL sessions for a specific agent in an instance.
 * Messages and parts cascade automatically via FK ON DELETE CASCADE.
 * Used during agent deletion to prevent orphan sessions in the pilot screen.
 */
export function deleteSessionsByAgent(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
): number {
  const result = db
    .prepare("DELETE FROM rt_sessions WHERE instance_slug = ? AND agent_id = ?")
    .run(instanceSlug, agentId);
  return result.changes;
}
