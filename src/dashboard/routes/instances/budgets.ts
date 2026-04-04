// src/dashboard/routes/instances/budgets.ts
// Routes: CRUD for budget enforcement + override + events + reconcile

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import {
  createBudget,
  getBudgetsForInstance,
  getBudget,
  updateBudget,
  deleteBudget,
  applyOverride,
  reconcileBudget,
  getBudgetEvents,
  getBudgetEventsForInstance,
  type BudgetScope,
  type BudgetPeriod,
} from "../../../core/repositories/budget-repository.js";

const VALID_SCOPES = new Set<BudgetScope>(["agent", "instance"]);
const VALID_PERIODS = new Set<BudgetPeriod>(["monthly", "lifetime"]);

export function registerBudgetRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/budgets
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/budgets", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const rows = getBudgetsForInstance(db, slug);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        scope: r.scope,
        scopeId: r.scope_id,
        period: r.period,
        limitUsd: r.limit_usd,
        spentUsd: r.spent_usd,
        softAlertPct: r.soft_alert_pct,
        hardStopPct: r.hard_stop_pct,
        overridePct: r.override_pct,
        enabled: r.enabled === 1,
        periodStart: r.period_start,
        createdAt: r.created_at,
      })),
    );
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/budgets
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/budgets", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const body = await c.req.json<{
      scope?: string;
      scopeId?: string | null;
      period?: string;
      limitUsd?: number;
      softAlertPct?: number;
      hardStopPct?: number;
      overridePct?: number;
    }>();

    if (!body.scope || !VALID_SCOPES.has(body.scope as BudgetScope)) {
      return apiError(c, 400, "INVALID_SCOPE", "scope must be 'agent' or 'instance'");
    }
    if (body.scope === "agent" && !body.scopeId) {
      return apiError(c, 400, "MISSING_SCOPE_ID", "scopeId is required when scope is 'agent'");
    }
    if (body.period && !VALID_PERIODS.has(body.period as BudgetPeriod)) {
      return apiError(c, 400, "INVALID_PERIOD", "period must be 'monthly' or 'lifetime'");
    }
    if (typeof body.limitUsd !== "number" || body.limitUsd <= 0) {
      return apiError(c, 400, "INVALID_LIMIT", "limitUsd must be a positive number");
    }

    try {
      const row = createBudget(db, {
        instanceSlug: slug,
        scope: body.scope as BudgetScope,
        ...(body.scopeId !== undefined ? { scopeId: body.scopeId } : {}),
        ...(body.period !== undefined ? { period: body.period as BudgetPeriod } : {}),
        limitUsd: body.limitUsd,
        ...(body.softAlertPct !== undefined ? { softAlertPct: body.softAlertPct } : {}),
        ...(body.hardStopPct !== undefined ? { hardStopPct: body.hardStopPct } : {}),
        ...(body.overridePct !== undefined ? { overridePct: body.overridePct } : {}),
      });
      return c.json(
        {
          id: row.id,
          scope: row.scope,
          scopeId: row.scope_id,
          period: row.period,
          limitUsd: row.limit_usd,
          spentUsd: row.spent_usd,
          softAlertPct: row.soft_alert_pct,
          hardStopPct: row.hard_stop_pct,
          overridePct: row.override_pct,
          enabled: row.enabled === 1,
          periodStart: row.period_start,
        },
        201,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint")) {
        return apiError(
          c,
          409,
          "DUPLICATE_BUDGET",
          "A budget with this scope/period already exists",
        );
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/instances/:slug/budgets/:id
  // ---------------------------------------------------------------------------
  app.put("/api/instances/:slug/budgets/:id", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    const body = await c.req.json<{
      limitUsd?: number;
      softAlertPct?: number;
      hardStopPct?: number;
      overridePct?: number;
      enabled?: boolean;
    }>();

    const updated = updateBudget(db, id, body);
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Budget not found");

    return c.json({
      id: updated.id,
      scope: updated.scope,
      scopeId: updated.scope_id,
      period: updated.period,
      limitUsd: updated.limit_usd,
      spentUsd: updated.spent_usd,
      softAlertPct: updated.soft_alert_pct,
      hardStopPct: updated.hard_stop_pct,
      overridePct: updated.override_pct,
      enabled: updated.enabled === 1,
      periodStart: updated.period_start,
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/instances/:slug/budgets/:id
  // ---------------------------------------------------------------------------
  app.delete("/api/instances/:slug/budgets/:id", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    deleteBudget(db, id);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/budgets/:id/override
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/budgets/:id/override", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    const overridden = applyOverride(db, id);
    if (!overridden) return apiError(c, 404, "NOT_FOUND", "Budget not found");

    return c.json({
      id: overridden.id,
      limitUsd: overridden.limit_usd,
      spentUsd: overridden.spent_usd,
      overridePct: overridden.override_pct,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/budgets/:id/events
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/budgets/:id/events", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    const limit = Number(c.req.query("limit") ?? "50");
    const events = getBudgetEvents(db, id, limit);
    return c.json(
      events.map((e) => ({
        id: e.id,
        budgetId: e.budget_id,
        eventType: e.event_type,
        currentUsd: e.current_usd,
        limitUsd: e.limit_usd,
        message: e.message,
        createdAt: e.created_at,
      })),
    );
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/budgets/events (all events for instance)
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/budgets/events", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const limit = Number(c.req.query("limit") ?? "50");
    const events = getBudgetEventsForInstance(db, slug, limit);
    return c.json(
      events.map((e) => ({
        id: e.id,
        budgetId: e.budget_id,
        eventType: e.event_type,
        currentUsd: e.current_usd,
        limitUsd: e.limit_usd,
        message: e.message,
        scope: e.scope,
        scopeId: e.scope_id,
        createdAt: e.created_at,
      })),
    );
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/budgets/:id/reconcile
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/budgets/:id/reconcile", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    const { drift, corrected } = reconcileBudget(db, id);
    return c.json({ drift, corrected });
  });
}
