// src/core/repositories/rt-event-repository.ts
//
// Repository for persisted bus events (rt_events table).
// Used by the Activity Console and event stream endpoints.

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventLevel = "info" | "warn" | "error";

export interface RtEventRow {
  id: number;
  instance_slug: string;
  event_type: string;
  agent_id: string | null;
  session_id: string | null;
  level: EventLevel;
  summary: string | null;
  payload: string | null;
  created_at: string;
}

export interface RtEventsPage {
  events: RtEventRow[];
  nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Level derivation
// ---------------------------------------------------------------------------

const ERROR_TYPES = new Set([
  "runtime.error",
  "provider.auth_failed",
  "tool.doom_loop",
  "llm.chunk_timeout",
  "agent.timeout",
]);

const WARN_TYPES = new Set(["heartbeat.alert", "provider.failover"]);

/** Derive a severity level from the event type string. */
export function deriveLevel(eventType: string): EventLevel {
  if (ERROR_TYPES.has(eventType)) return "error";
  if (WARN_TYPES.has(eventType)) return "warn";
  return "info";
}

// ---------------------------------------------------------------------------
// Excluded types (too noisy for persistence)
// ---------------------------------------------------------------------------

const EXCLUDED_TYPES = new Set([
  "message.part.delta", // streaming deltas — extremely high volume
  "heartbeat.tick", // high frequency, no analytical value
]);

/** Check whether an event type should be excluded from persistence. */
export function isExcluded(eventType: string): boolean {
  return EXCLUDED_TYPES.has(eventType);
}

// ---------------------------------------------------------------------------
// Summary derivation
// ---------------------------------------------------------------------------

/** Produce a human-readable one-liner from an event type + payload. */
export function deriveSummary(eventType: string, payload: Record<string, unknown>): string {
  switch (eventType) {
    case "runtime.started":
      return `Runtime started`;
    case "runtime.stopped":
      return payload.reason ? `Runtime stopped: ${payload.reason}` : "Runtime stopped";
    case "runtime.state_changed":
      return `State: ${payload.previous} → ${payload.state}`;
    case "runtime.error":
      return `Error: ${payload.error}`;
    case "session.created":
      return `Session created for ${payload.agentId} on ${payload.channel}`;
    case "session.updated":
      return payload.title ? `Session titled: ${payload.title}` : "Session updated";
    case "session.ended":
      return `Session ended (${payload.reason})`;
    case "session.status":
      return `Session ${payload.status}${payload.agentId ? ` [${payload.agentId}]` : ""}`;
    case "session.system_prompt":
      return `System prompt built for ${payload.agentId}`;
    case "message.created":
      return `Message created (${payload.role})`;
    case "message.updated":
      return "Message updated";
    case "permission.asked":
      return `Permission asked: ${payload.permission} ${payload.pattern}`;
    case "permission.replied":
      return `Permission ${payload.action}: ${payload.persist ? "persisted" : "one-time"}`;
    case "provider.auth_failed":
      return `Auth failed: ${payload.providerId} (${payload.reason})`;
    case "provider.failover":
      return `Failover ${payload.providerId}: ${payload.fromProfileId} → ${payload.toProfileId}`;
    case "subagent.completed":
      return `Subagent completed (${(payload.result as Record<string, unknown>)?.steps ?? "?"} steps)`;
    case "agent.message.sent":
      return `Message: ${payload.fromAgentId} → ${payload.toAgentId}`;
    case "agent.timeout":
      return `Agent timeout: ${payload.agentId} (${payload.timeoutMs}ms)`;
    case "heartbeat.alert":
      return `Heartbeat alert: ${payload.agentId}`;
    case "mcp.server.reconnected":
      return `MCP reconnected: ${payload.serverId}`;
    case "mcp.tools.changed":
      return `MCP tools changed: ${payload.serverId} (${payload.toolCount} tools)`;
    case "tool.doom_loop":
      return `Doom loop: ${payload.toolName}`;
    case "llm.chunk_timeout":
      return `LLM chunk timeout: ${payload.agentId} (${payload.elapsedMs}ms)`;
    case "channel.message.received":
      return `Inbound ${payload.channelType} from ${payload.peerId}`;
    case "channel.message.sent":
      return `Outbound ${payload.channelType} to ${payload.peerId}`;
    default:
      return eventType;
  }
}

// ---------------------------------------------------------------------------
// ID extraction helpers
// ---------------------------------------------------------------------------

/** Extract agentId and sessionId from a bus event payload. */
export function extractIds(payload: Record<string, unknown>): {
  agentId: string | undefined;
  sessionId: string | undefined;
} {
  return {
    agentId: (payload.agentId ?? payload.fromAgentId) as string | undefined,
    sessionId: (payload.sessionId ?? payload.parentSessionId) as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface InsertRtEventParams {
  instanceSlug: string;
  eventType: string;
  agentId?: string;
  sessionId?: string;
  level: EventLevel;
  summary?: string;
  payload: string;
}

/** Insert a single event into rt_events. */
export function insertRtEvent(db: Database.Database, params: InsertRtEventParams): void {
  db.prepare(
    `INSERT INTO rt_events (instance_slug, event_type, agent_id, session_id, level, summary, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    params.instanceSlug,
    params.eventType,
    params.agentId ?? null,
    params.sessionId ?? null,
    params.level,
    params.summary ?? null,
    params.payload,
  );
}

// ---------------------------------------------------------------------------
// Query (cursor-based pagination)
// ---------------------------------------------------------------------------

export interface ListRtEventsParams {
  instanceSlug: string;
  cursor?: number;
  limit?: number;
  types?: string[];
  agentId?: string;
  level?: EventLevel;
  since?: string;
  until?: string;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** List events with cursor-based pagination (newest first). */
export function listRtEvents(db: Database.Database, params: ListRtEventsParams): RtEventsPage {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const conditions: string[] = ["instance_slug = ?"];
  const bindings: unknown[] = [params.instanceSlug];

  if (params.cursor !== undefined) {
    conditions.push("id < ?");
    bindings.push(params.cursor);
  }

  if (params.types && params.types.length > 0) {
    const placeholders = params.types.map(() => "?").join(", ");
    conditions.push(`event_type IN (${placeholders})`);
    bindings.push(...params.types);
  }

  if (params.agentId) {
    conditions.push("agent_id = ?");
    bindings.push(params.agentId);
  }

  if (params.level) {
    conditions.push("level = ?");
    bindings.push(params.level);
  }

  if (params.since) {
    conditions.push("created_at >= ?");
    bindings.push(params.since);
  }

  if (params.until) {
    conditions.push("created_at <= ?");
    bindings.push(params.until);
  }

  const where = conditions.join(" AND ");
  // Fetch limit+1 to determine if there are more results
  const rows = db
    .prepare(
      `SELECT id, instance_slug, event_type, agent_id, session_id, level, summary, payload, created_at
       FROM rt_events
       WHERE ${where}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...bindings, limit + 1) as RtEventRow[];

  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? events[events.length - 1]!.id : null;

  return { events, nextCursor };
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

/** Delete events older than the specified number of days. Returns the count of deleted rows. */
export function pruneRtEvents(
  db: Database.Database,
  instanceSlug: string,
  olderThanDays = 7,
): number {
  const result = db
    .prepare(
      `DELETE FROM rt_events
       WHERE instance_slug = ?
         AND created_at < datetime('now', '-' || ? || ' days')`,
    )
    .run(instanceSlug, olderThanDays);
  return result.changes;
}
