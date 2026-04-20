// src/dashboard/routes/instances/budgets.ts
// Routes: CRUD for budget enforcement + override + events + reconcile

import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
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

/** Map a budget DB row to the API response shape. */
function formatBudgetRow(r: ReturnType<typeof getBudgetsForInstance>[number]) {
  return {
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
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Format a budget event DB row to the API response shape. */
function formatEventRow(e: {
  id: number;
  budget_id: number;
  event_type: string;
  current_usd: number;
  limit_usd: number;
  message: string | null;
  created_at: string;
  scope?: string;
  scope_id?: string | null;
}) {
  return {
    id: e.id,
    budgetId: e.budget_id,
    eventType: e.event_type,
    currentUsd: e.current_usd,
    limitUsd: e.limit_usd,
    message: e.message,
    createdAt: e.created_at,
  };
}

/** Handle POST /budgets — create a new budget. */
async function handleCreateBudget(
  c: HonoContext,
  db: RouteDeps["db"],
  slug: string,
): Promise<Response> {
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
    return c.json(formatBudgetRow(row), 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint")) {
      return apiError(c, 409, "DUPLICATE_BUDGET", "A budget with this scope/period already exists");
    }
    throw err;
  }
}

/** Handle PUT /budgets/:id — update an existing budget. */
async function handleUpdateBudget(
  c: HonoContext,
  db: RouteDeps["db"],
  slug: string,
): Promise<Response> {
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

  return c.json(formatBudgetRow(updated));
}

/** Handle DELETE /budgets/:id — delete a budget. */
function handleDeleteBudget(c: HonoContext, db: RouteDeps["db"], slug: string): Response {
  const id = Number(c.req.param("id"));
  const existing = getBudget(db, id);
  if (!existing || existing.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Budget not found");
  }
  deleteBudget(db, id);
  return c.json({ ok: true });
}

/** Handle POST /budgets/:id/override — apply override to a budget. */
function handleOverrideBudget(c: HonoContext, db: RouteDeps["db"], slug: string): Response {
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
}

/** Handle GET /budgets/:id/events — list events for a budget. */
function handleBudgetEvents(c: HonoContext, db: RouteDeps["db"], slug: string): Response {
  const id = Number(c.req.param("id"));
  const existing = getBudget(db, id);
  if (!existing || existing.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Budget not found");
  }
  const limit = Number(c.req.query("limit") ?? "50");
  return c.json(getBudgetEvents(db, id, limit).map(formatEventRow));
}

/** Handle GET /budgets/events — list all events for an instance. */
function handleInstanceBudgetEvents(c: HonoContext, db: RouteDeps["db"], slug: string): Response {
  const limit = Number(c.req.query("limit") ?? "50");
  return c.json(
    getBudgetEventsForInstance(db, slug, limit).map((e) => ({
      ...formatEventRow(e),
      scope: e.scope,
      scopeId: e.scope_id,
    })),
  );
}

/** Handle POST /budgets/:id/reconcile — reconcile a budget. */
function handleReconcileBudget(c: HonoContext, db: RouteDeps["db"], slug: string): Response {
  const id = Number(c.req.param("id"));
  const existing = getBudget(db, id);
  if (!existing || existing.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Budget not found");
  }
  const { drift, corrected } = reconcileBudget(db, id);
  return c.json({ drift, corrected });
}

export function registerBudgetRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const rid = (c: HonoContext) => c.req.param("id");

  app.get(
    "/api/instances/:slug/budgets",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_LIST,
      resource: { kind: "budget" },
      attributes: attr,
    }),
    (c) => c.json(getBudgetsForInstance(db, getInstanceContext(c).slug).map(formatBudgetRow)),
  );
  app.post(
    "/api/instances/:slug/budgets",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_CREATE,
      resource: { kind: "budget" },
      attributes: attr,
    }),
    async (c) => handleCreateBudget(c, db, getInstanceContext(c).slug),
  );
  app.put(
    "/api/instances/:slug/budgets/:id",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_UPDATE,
      resource: { kind: "budget", id: rid },
      attributes: attr,
    }),
    async (c) => handleUpdateBudget(c, db, getInstanceContext(c).slug),
  );
  app.delete(
    "/api/instances/:slug/budgets/:id",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_DELETE,
      resource: { kind: "budget", id: rid },
      attributes: attr,
    }),
    (c) => handleDeleteBudget(c, db, getInstanceContext(c).slug),
  );
  app.post(
    "/api/instances/:slug/budgets/:id/override",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_OVERRIDE,
      resource: { kind: "budget", id: rid },
      attributes: attr,
    }),
    (c) => handleOverrideBudget(c, db, getInstanceContext(c).slug),
  );
  app.get(
    "/api/instances/:slug/budgets/:id/events",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_EVENTS_READ,
      resource: { kind: "budget", id: rid },
      attributes: attr,
    }),
    (c) => handleBudgetEvents(c, db, getInstanceContext(c).slug),
  );
  app.get(
    "/api/instances/:slug/budgets/events",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_EVENTS_READ,
      resource: { kind: "budget" },
      attributes: attr,
    }),
    (c) => handleInstanceBudgetEvents(c, db, getInstanceContext(c).slug),
  );
  app.post(
    "/api/instances/:slug/budgets/:id/reconcile",
    permission({
      action: ACTIONS.INSTANCE_BUDGET_RECONCILE,
      resource: { kind: "budget", id: rid },
      attributes: attr,
    }),
    (c) => handleReconcileBudget(c, db, getInstanceContext(c).slug),
  );
}
