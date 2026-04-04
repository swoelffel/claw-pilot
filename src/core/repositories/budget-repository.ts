// src/core/repositories/budget-repository.ts
//
// Repository for budget enforcement — CRUD, incremental counter,
// monthly reset, reconciliation against rt_messages.

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetScope = "agent" | "instance";
export type BudgetPeriod = "monthly" | "lifetime";
export type BudgetEventType = "soft_alert" | "hard_stop" | "reset" | "override" | "reconcile";
export type BudgetStatus = "ok" | "warning" | "exceeded";

export interface BudgetRow {
  id: number;
  instance_slug: string;
  scope: BudgetScope;
  scope_id: string | null;
  period: BudgetPeriod;
  limit_usd: number;
  spent_usd: number;
  soft_alert_pct: number;
  hard_stop_pct: number;
  override_pct: number;
  enabled: number;
  period_start: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBudgetInput {
  instanceSlug: string;
  scope: BudgetScope;
  scopeId?: string | null;
  period?: BudgetPeriod;
  limitUsd: number;
  softAlertPct?: number;
  hardStopPct?: number;
  overridePct?: number;
}

export interface UpdateBudgetInput {
  limitUsd?: number;
  softAlertPct?: number;
  hardStopPct?: number;
  overridePct?: number;
  enabled?: boolean;
}

export interface BudgetCheckResult {
  budget: BudgetRow;
  status: BudgetStatus;
  usagePct: number;
  remainingUsd: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeStatus(budget: BudgetRow): BudgetStatus {
  const pct = budget.limit_usd > 0 ? budget.spent_usd / budget.limit_usd : 0;
  if (pct >= budget.hard_stop_pct) return "exceeded";
  if (pct >= budget.soft_alert_pct) return "warning";
  return "ok";
}

/** Reset a monthly budget if its period_start is before the current month. */
export function maybeResetMonthly(db: Database.Database, budget: BudgetRow): BudgetRow {
  if (budget.period !== "monthly") return budget;
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodStart = new Date(budget.period_start.replace(" ", "T") + "Z");
  if (periodStart < currentMonthStart) {
    resetPeriod(db, budget.id);
    return getBudget(db, budget.id)!;
  }
  return budget;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Create a new budget. Returns the inserted row. */
export function createBudget(db: Database.Database, input: CreateBudgetInput): BudgetRow {
  const stmt = db.prepare(`
    INSERT INTO rt_budgets (instance_slug, scope, scope_id, period, limit_usd,
      soft_alert_pct, hard_stop_pct, override_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.instanceSlug,
    input.scope,
    input.scopeId ?? null,
    input.period ?? "monthly",
    input.limitUsd,
    input.softAlertPct ?? 0.8,
    input.hardStopPct ?? 1.0,
    input.overridePct ?? 0.2,
  );
  return getBudget(db, Number(result.lastInsertRowid))!;
}

/** Get a single budget by id. */
export function getBudget(db: Database.Database, id: number): BudgetRow | undefined {
  return db.prepare("SELECT * FROM rt_budgets WHERE id = ?").get(id) as BudgetRow | undefined;
}

/** List all budgets for an instance. */
export function getBudgetsForInstance(db: Database.Database, slug: string): BudgetRow[] {
  return db
    .prepare("SELECT * FROM rt_budgets WHERE instance_slug = ? ORDER BY scope, scope_id")
    .all(slug) as BudgetRow[];
}

/** Get the budget for a specific scope. */
export function getBudgetForScope(
  db: Database.Database,
  slug: string,
  scope: BudgetScope,
  scopeId: string | null,
  period: BudgetPeriod,
): BudgetRow | undefined {
  return db
    .prepare(
      `SELECT * FROM rt_budgets
       WHERE instance_slug = ? AND scope = ? AND scope_id IS ? AND period = ?`,
    )
    .get(slug, scope, scopeId, period) as BudgetRow | undefined;
}

/** Update mutable budget fields. */
export function updateBudget(
  db: Database.Database,
  id: number,
  updates: UpdateBudgetInput,
): BudgetRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.limitUsd !== undefined) {
    sets.push("limit_usd = ?");
    params.push(updates.limitUsd);
  }
  if (updates.softAlertPct !== undefined) {
    sets.push("soft_alert_pct = ?");
    params.push(updates.softAlertPct);
  }
  if (updates.hardStopPct !== undefined) {
    sets.push("hard_stop_pct = ?");
    params.push(updates.hardStopPct);
  }
  if (updates.overridePct !== undefined) {
    sets.push("override_pct = ?");
    params.push(updates.overridePct);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }

  if (sets.length === 0) return getBudget(db, id);

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE rt_budgets SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getBudget(db, id);
}

/** Delete a budget and its events (CASCADE). */
export function deleteBudget(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM rt_budgets WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Counter operations
// ---------------------------------------------------------------------------

/** Atomically increment spent_usd. Returns updated row. */
export function incrementSpent(db: Database.Database, id: number, amountUsd: number): BudgetRow {
  db.prepare(
    "UPDATE rt_budgets SET spent_usd = spent_usd + ?, updated_at = datetime('now') WHERE id = ?",
  ).run(amountUsd, id);
  return getBudget(db, id)!;
}

/** Reset spent_usd to 0 and advance period_start to current month. */
export function resetPeriod(db: Database.Database, id: number): void {
  const budget = getBudget(db, id);
  if (!budget) return;
  db.prepare(
    `UPDATE rt_budgets
     SET spent_usd = 0, period_start = datetime('now','start of month'), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(id);
  insertBudgetEvent(db, {
    budgetId: id,
    eventType: "reset",
    currentUsd: 0,
    limitUsd: budget.limit_usd,
    message: `Monthly reset (previous spent: $${budget.spent_usd.toFixed(4)})`,
  });
}

// ---------------------------------------------------------------------------
// Budget checking
// ---------------------------------------------------------------------------

/**
 * Check all applicable budgets for an agent call.
 * Returns results for instance-level + agent-level budgets (if they exist and are enabled).
 * Monthly budgets are lazily reset if their period has expired.
 */
export function checkBudgets(
  db: Database.Database,
  slug: string,
  agentId: string,
): BudgetCheckResult[] {
  const results: BudgetCheckResult[] = [];

  // Instance-level budgets
  const instanceBudgets = db
    .prepare(
      `SELECT * FROM rt_budgets
       WHERE instance_slug = ? AND scope = 'instance' AND enabled = 1`,
    )
    .all(slug) as BudgetRow[];

  for (const raw of instanceBudgets) {
    const budget = maybeResetMonthly(db, raw);
    const usagePct = budget.limit_usd > 0 ? budget.spent_usd / budget.limit_usd : 0;
    results.push({
      budget,
      status: computeStatus(budget),
      usagePct,
      remainingUsd: Math.max(0, budget.limit_usd * budget.hard_stop_pct - budget.spent_usd),
    });
  }

  // Agent-level budgets
  const agentBudgets = db
    .prepare(
      `SELECT * FROM rt_budgets
       WHERE instance_slug = ? AND scope = 'agent' AND scope_id = ? AND enabled = 1`,
    )
    .all(slug, agentId) as BudgetRow[];

  for (const raw of agentBudgets) {
    const budget = maybeResetMonthly(db, raw);
    const usagePct = budget.limit_usd > 0 ? budget.spent_usd / budget.limit_usd : 0;
    results.push({
      budget,
      status: computeStatus(budget),
      usagePct,
      remainingUsd: Math.max(0, budget.limit_usd * budget.hard_stop_pct - budget.spent_usd),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Override
// ---------------------------------------------------------------------------

/** Apply override: increase limit_usd by override_pct. */
export function applyOverride(db: Database.Database, id: number): BudgetRow | undefined {
  const budget = getBudget(db, id);
  if (!budget) return undefined;
  const newLimit = budget.limit_usd * (1 + budget.override_pct);
  db.prepare("UPDATE rt_budgets SET limit_usd = ?, updated_at = datetime('now') WHERE id = ?").run(
    newLimit,
    id,
  );
  insertBudgetEvent(db, {
    budgetId: id,
    eventType: "override",
    currentUsd: budget.spent_usd,
    limitUsd: newLimit,
    message: `Override +${Math.round(budget.override_pct * 100)}%: $${budget.limit_usd.toFixed(2)} → $${newLimit.toFixed(2)}`,
  });
  return getBudget(db, id);
}

// ---------------------------------------------------------------------------
// Monthly reset (batch)
// ---------------------------------------------------------------------------

/** Reset all expired monthly budgets for an instance. Returns count of resets. */
export function resetExpiredMonthlyBudgets(db: Database.Database, slug: string): number {
  const monthlyBudgets = db
    .prepare(
      `SELECT * FROM rt_budgets
       WHERE instance_slug = ? AND period = 'monthly' AND enabled = 1`,
    )
    .all(slug) as BudgetRow[];

  let count = 0;
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  for (const budget of monthlyBudgets) {
    const periodStart = new Date(budget.period_start.replace(" ", "T") + "Z");
    if (periodStart < currentMonthStart) {
      resetPeriod(db, budget.id);
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Compare spent_usd against SUM(rt_messages.cost_usd). Fix drift > $0.01. */
export function reconcileBudget(
  db: Database.Database,
  id: number,
): { drift: number; corrected: boolean } {
  const budget = getBudget(db, id);
  if (!budget) return { drift: 0, corrected: false };

  const sinceDate = budget.period === "monthly" ? budget.period_start : "1970-01-01 00:00:00";

  let actualSpent: number;
  if (budget.scope === "instance") {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(m.cost_usd), 0) AS total
         FROM rt_messages m
         JOIN rt_sessions s ON s.id = m.session_id
         WHERE s.instance_slug = ? AND m.role = 'assistant' AND m.created_at >= ?`,
      )
      .get(budget.instance_slug, sinceDate) as { total: number };
    actualSpent = row.total;
  } else {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(m.cost_usd), 0) AS total
         FROM rt_messages m
         JOIN rt_sessions s ON s.id = m.session_id
         WHERE s.instance_slug = ? AND m.agent_id = ? AND m.role = 'assistant' AND m.created_at >= ?`,
      )
      .get(budget.instance_slug, budget.scope_id, sinceDate) as { total: number };
    actualSpent = row.total;
  }

  const drift = Math.abs(actualSpent - budget.spent_usd);
  if (drift > 0.01) {
    db.prepare(
      "UPDATE rt_budgets SET spent_usd = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(actualSpent, id);
    insertBudgetEvent(db, {
      budgetId: id,
      eventType: "reconcile",
      currentUsd: actualSpent,
      limitUsd: budget.limit_usd,
      message: `Drift corrected: $${budget.spent_usd.toFixed(4)} → $${actualSpent.toFixed(4)}`,
    });
    return { drift, corrected: true };
  }
  return { drift, corrected: false };
}

// ---------------------------------------------------------------------------
// Budget events
// ---------------------------------------------------------------------------

export interface InsertBudgetEventInput {
  budgetId: number;
  eventType: BudgetEventType;
  currentUsd: number;
  limitUsd: number;
  message?: string;
}

export interface BudgetEventRow {
  id: number;
  budget_id: number;
  event_type: BudgetEventType;
  current_usd: number;
  limit_usd: number;
  message: string | null;
  created_at: string;
}

/** Insert a budget event (audit log). */
export function insertBudgetEvent(db: Database.Database, input: InsertBudgetEventInput): void {
  db.prepare(
    `INSERT INTO rt_budget_events (budget_id, event_type, current_usd, limit_usd, message)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.budgetId, input.eventType, input.currentUsd, input.limitUsd, input.message ?? null);
}

/** List budget events, most recent first. */
export function getBudgetEvents(
  db: Database.Database,
  budgetId: number,
  limit = 50,
): BudgetEventRow[] {
  return db
    .prepare(`SELECT * FROM rt_budget_events WHERE budget_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(budgetId, limit) as BudgetEventRow[];
}

/** List all budget events for an instance (across all budgets), most recent first. */
export function getBudgetEventsForInstance(
  db: Database.Database,
  slug: string,
  limit = 50,
): (BudgetEventRow & { scope: BudgetScope; scope_id: string | null })[] {
  return db
    .prepare(
      `SELECT e.*, b.scope, b.scope_id
       FROM rt_budget_events e
       JOIN rt_budgets b ON b.id = e.budget_id
       WHERE b.instance_slug = ?
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
    .all(slug, limit) as (BudgetEventRow & { scope: BudgetScope; scope_id: string | null })[];
}
