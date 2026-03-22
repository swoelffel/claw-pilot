// src/core/repositories/cost-repository.ts
//
// Repository for cost/token aggregation queries on rt_messages.
// All queries filter by instance_slug via JOIN on rt_sessions
// and only count assistant messages (which carry token/cost data).

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostPeriod = "7d" | "30d" | "all";

export interface CostSummaryRow {
  message_count: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
}

export interface DailyCostRow {
  day: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

export interface AgentCostRow {
  agent_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  message_count: number;
}

export interface ModelCostRow {
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  message_count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a period label to an ISO date string usable in WHERE clauses. */
export function sinceDateFromPeriod(period: CostPeriod): string {
  if (period === "all") return "1970-01-01T00:00:00";
  const days = period === "30d" ? 30 : 7;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Global cost totals for an instance over the given period. */
export function getCostSummary(
  db: Database.Database,
  slug: string,
  period: CostPeriod,
): CostSummaryRow {
  const since = sinceDateFromPeriod(period);
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                        AS message_count,
         COALESCE(SUM(m.tokens_in), 0)  AS total_tokens_in,
         COALESCE(SUM(m.tokens_out), 0) AS total_tokens_out,
         COALESCE(SUM(m.cost_usd), 0)   AS total_cost_usd
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       WHERE s.instance_slug = ?
         AND m.created_at >= ?
         AND m.role = 'assistant'`,
    )
    .get(slug, since) as CostSummaryRow;
  return row;
}

/** Daily cost breakdown grouped by day + model. */
export function getDailyCosts(
  db: Database.Database,
  slug: string,
  period: CostPeriod,
): DailyCostRow[] {
  const since = sinceDateFromPeriod(period);
  return db
    .prepare(
      `SELECT
         date(m.created_at) AS day,
         m.model,
         COALESCE(SUM(m.tokens_in), 0)  AS tokens_in,
         COALESCE(SUM(m.tokens_out), 0) AS tokens_out,
         COALESCE(SUM(m.cost_usd), 0)   AS cost_usd
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       WHERE s.instance_slug = ?
         AND m.created_at >= ?
         AND m.role = 'assistant'
       GROUP BY day, m.model
       ORDER BY day ASC`,
    )
    .all(slug, since) as DailyCostRow[];
}

/** Cost breakdown per agent, ordered by cost descending. */
export function getCostsByAgent(
  db: Database.Database,
  slug: string,
  period: CostPeriod,
): AgentCostRow[] {
  const since = sinceDateFromPeriod(period);
  return db
    .prepare(
      `SELECT
         m.agent_id,
         COALESCE(SUM(m.tokens_in), 0)  AS tokens_in,
         COALESCE(SUM(m.tokens_out), 0) AS tokens_out,
         COALESCE(SUM(m.cost_usd), 0)   AS cost_usd,
         COUNT(*)                        AS message_count
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       WHERE s.instance_slug = ?
         AND m.created_at >= ?
         AND m.role = 'assistant'
       GROUP BY m.agent_id
       ORDER BY cost_usd DESC`,
    )
    .all(slug, since) as AgentCostRow[];
}

/** Cost breakdown per model, ordered by cost descending. */
export function getCostsByModel(
  db: Database.Database,
  slug: string,
  period: CostPeriod,
): ModelCostRow[] {
  const since = sinceDateFromPeriod(period);
  return db
    .prepare(
      `SELECT
         m.model,
         COALESCE(SUM(m.tokens_in), 0)  AS tokens_in,
         COALESCE(SUM(m.tokens_out), 0) AS tokens_out,
         COALESCE(SUM(m.cost_usd), 0)   AS cost_usd,
         COUNT(*)                        AS message_count
       FROM rt_messages m
       JOIN rt_sessions s ON s.id = m.session_id
       WHERE s.instance_slug = ?
         AND m.created_at >= ?
         AND m.role = 'assistant'
       GROUP BY m.model
       ORDER BY cost_usd DESC`,
    )
    .all(slug, since) as ModelCostRow[];
}
