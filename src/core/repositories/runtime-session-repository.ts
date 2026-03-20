// src/core/repositories/runtime-session-repository.ts
//
// Repository for rt_sessions queries that require aggregated stats.
// Extracted from dashboard/routes/instances/runtime.ts to keep route handlers thin.

import type Database from "better-sqlite3";
import { listSessions } from "../../runtime/index.js";

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
  state?: "active" | "archived";
  limit?: number;
  includeInternal?: boolean;
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
): EnrichedSession[] {
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

  sql += " AND s.state = ?";
  params.push(resolvedState);

  if (!includeInternal) {
    sql += " AND s.channel != 'internal'";
  }

  sql += " GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?";
  params.push(safeLimit);

  let rows: EnrichedSessionRow[];
  try {
    rows = db.prepare(sql).all(...params) as EnrichedSessionRow[];
  } catch {
    // Fallback to listSessions if enriched query fails (e.g. missing columns on older DB)
    const fallback = listSessions(db, instanceSlug, {
      state: resolvedState,
      limit: safeLimit,
      ...(includeInternal ? {} : { excludeChannels: ["internal"] }),
    });
    return fallback.map((s) => ({
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
  }

  return rows.map((row) => ({
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
}
