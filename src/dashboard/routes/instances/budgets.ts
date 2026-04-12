// src/dashboard/routes/instances/budgets.ts
// Routes: CRUD for budget enforcement + override + events + reconcile

import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
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
} from "../../../core/repositories/budget-repository.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const CreateBudgetSchema = z.object({
  scope: z.enum(["agent", "instance"]),
  scopeId: z.string().nullable().optional(),
  period: z.enum(["monthly", "lifetime"]).optional(),
  limitUsd: z.number().positive(),
  softAlertPct: z.number().optional(),
  hardStopPct: z.number().optional(),
  overridePct: z.number().optional(),
});

const UpdateBudgetSchema = z.object({
  limitUsd: z.number().positive().optional(),
  softAlertPct: z.number().optional(),
  hardStopPct: z.number().optional(),
  overridePct: z.number().optional(),
  enabled: z.boolean().optional(),
});

export function registerBudgetRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/budgets
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/budgets", (c) => {
    const { slug } = getInstanceContext(c);

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
    const { slug } = getInstanceContext(c);

    const body = await c.req.json().catch(() => null);
    const parsed = CreateBudgetSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    if (data.scope === "agent" && !data.scopeId) {
      return apiError(c, 400, "MISSING_SCOPE_ID", "scopeId is required when scope is 'agent'");
    }

    try {
      const row = createBudget(db, {
        instanceSlug: slug,
        scope: data.scope,
        ...(data.scopeId !== undefined ? { scopeId: data.scopeId } : {}),
        ...(data.period !== undefined ? { period: data.period } : {}),
        limitUsd: data.limitUsd,
        ...(data.softAlertPct !== undefined ? { softAlertPct: data.softAlertPct } : {}),
        ...(data.hardStopPct !== undefined ? { hardStopPct: data.hardStopPct } : {}),
        ...(data.overridePct !== undefined ? { overridePct: data.overridePct } : {}),
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
    const { slug } = getInstanceContext(c);

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateBudgetSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    const updated = updateBudget(db, id, {
      ...(data.limitUsd !== undefined ? { limitUsd: data.limitUsd } : {}),
      ...(data.softAlertPct !== undefined ? { softAlertPct: data.softAlertPct } : {}),
      ...(data.hardStopPct !== undefined ? { hardStopPct: data.hardStopPct } : {}),
      ...(data.overridePct !== undefined ? { overridePct: data.overridePct } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    });
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
    const { slug } = getInstanceContext(c);

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
    const { slug } = getInstanceContext(c);

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
    const { slug } = getInstanceContext(c);

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
    const { slug } = getInstanceContext(c);

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
    const { slug } = getInstanceContext(c);

    const id = Number(c.req.param("id"));
    const existing = getBudget(db, id);
    if (!existing || existing.instance_slug !== slug) {
      return apiError(c, 404, "NOT_FOUND", "Budget not found");
    }

    const { drift, corrected } = reconcileBudget(db, id);
    return c.json({ drift, corrected });
  });
}
