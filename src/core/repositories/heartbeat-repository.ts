// src/core/repositories/heartbeat-repository.ts
//
// Repository for heartbeat heatmap aggregation queries.
// Queries rt_messages + rt_sessions for internal heartbeat ticks,
// grouping by agent, day, and hour.

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeatmapPeriod = "7d" | "14d" | "30d";

export interface HeartbeatHourBucket {
  agentId: string;
  day: string; // "YYYY-MM-DD"
  hour: number; // 0-23
  tickCount: number;
  alertCount: number;
  okCount: number;
}

export interface HeartbeatAgentStats {
  agentId: string;
  totalTicks: number;
  totalAlerts: number;
  firstTick: string | null;
  lastTick: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a heatmap period label to an ISO date string usable in WHERE clauses. */
export function sinceDateFromPeriod(period: HeatmapPeriod): string {
  const days = period === "30d" ? 30 : period === "14d" ? 14 : 7;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Heartbeat ticks aggregated by agent + day + hour for heatmap rendering. */
export function getHeartbeatHeatmapData(
  db: Database.Database,
  slug: string,
  since: string,
): HeartbeatHourBucket[] {
  interface Row {
    agentId: string;
    day: string;
    hour: number;
    tickCount: number;
    alertCount: number;
    okCount: number;
  }

  return db
    .prepare(
      `SELECT
         s.agent_id AS agentId,
         date(m.created_at) AS day,
         CAST(strftime('%H', m.created_at) AS INTEGER) AS hour,
         COUNT(*) AS tickCount,
         SUM(CASE WHEN p.content IS NOT NULL AND p.content != ''
           AND LOWER(p.content) NOT LIKE 'heartbeat_ok%' THEN 1 ELSE 0 END) AS alertCount,
         SUM(CASE WHEN p.content IS NULL OR p.content = ''
           OR LOWER(p.content) LIKE 'heartbeat_ok%' THEN 1 ELSE 0 END) AS okCount
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       LEFT JOIN rt_parts p ON p.message_id = m.id AND p.type = 'text'
       WHERE s.instance_slug = ?
         AND s.channel = 'internal'
         AND s.peer_id LIKE 'heartbeat:%'
         AND m.role = 'assistant'
         AND m.created_at >= ?
       GROUP BY s.agent_id, date(m.created_at), CAST(strftime('%H', m.created_at) AS INTEGER)
       ORDER BY s.agent_id, day, hour`,
    )
    .all(slug, since) as Row[];
}

/** Per-agent aggregate stats over the given period. */
export function getHeartbeatAgentStats(
  db: Database.Database,
  slug: string,
  since: string,
): HeartbeatAgentStats[] {
  interface Row {
    agentId: string;
    totalTicks: number;
    totalAlerts: number;
    firstTick: string | null;
    lastTick: string | null;
  }

  return db
    .prepare(
      `SELECT
         s.agent_id AS agentId,
         COUNT(*) AS totalTicks,
         SUM(CASE WHEN p.content IS NOT NULL AND p.content != ''
           AND LOWER(p.content) NOT LIKE 'heartbeat_ok%' THEN 1 ELSE 0 END) AS totalAlerts,
         MIN(m.created_at) AS firstTick,
         MAX(m.created_at) AS lastTick
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       LEFT JOIN rt_parts p ON p.message_id = m.id AND p.type = 'text'
       WHERE s.instance_slug = ?
         AND s.channel = 'internal'
         AND s.peer_id LIKE 'heartbeat:%'
         AND m.role = 'assistant'
         AND m.created_at >= ?
       GROUP BY s.agent_id
       ORDER BY s.agent_id`,
    )
    .all(slug, since) as Row[];
}
