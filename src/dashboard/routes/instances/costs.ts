// src/dashboard/routes/instances/costs.ts
// Routes: GET costs/summary, GET costs/daily, GET costs/by-agent, GET costs/by-model

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import {
  getCostSummary,
  getDailyCosts,
  getCostsByAgent,
  getCostsByModel,
  type CostPeriod,
} from "../../../core/repositories/cost-repository.js";

const VALID_PERIODS = new Set<CostPeriod>(["7d", "30d", "all"]);

function parsePeriod(raw: string | undefined): CostPeriod {
  if (raw && VALID_PERIODS.has(raw as CostPeriod)) return raw as CostPeriod;
  return "7d";
}

export function registerCostsRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/costs/summary
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/costs/summary", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const period = parsePeriod(c.req.query("period"));
    const row = getCostSummary(db, slug, period);
    return c.json({
      messageCount: row.message_count,
      totalTokensIn: row.total_tokens_in,
      totalTokensOut: row.total_tokens_out,
      totalCostUsd: row.total_cost_usd,
      period,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/costs/daily
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/costs/daily", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const period = parsePeriod(c.req.query("period"));
    const rows = getDailyCosts(db, slug, period);
    return c.json(
      rows.map((r) => ({
        day: r.day,
        model: r.model ?? "unknown",
        tokensIn: r.tokens_in,
        tokensOut: r.tokens_out,
        costUsd: r.cost_usd,
      })),
    );
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/costs/by-agent
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/costs/by-agent", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const period = parsePeriod(c.req.query("period"));
    const rows = getCostsByAgent(db, slug, period);
    return c.json(
      rows.map((r) => ({
        agentId: r.agent_id ?? "unknown",
        tokensIn: r.tokens_in,
        tokensOut: r.tokens_out,
        costUsd: r.cost_usd,
        messageCount: r.message_count,
      })),
    );
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/costs/by-model
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/costs/by-model", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const period = parsePeriod(c.req.query("period"));
    const rows = getCostsByModel(db, slug, period);
    return c.json(
      rows.map((r) => ({
        model: r.model ?? "unknown",
        tokensIn: r.tokens_in,
        tokensOut: r.tokens_out,
        costUsd: r.cost_usd,
        messageCount: r.message_count,
      })),
    );
  });
}
