/**
 * runtime/session/budget-check.ts
 *
 * Pre-LLM and post-LLM budget enforcement.
 * - preBudgetCheck: fast guard — throws BudgetExceededError if any budget is exceeded.
 * - postBudgetCheck: increments counter, publishes bus events on threshold crossings.
 */

import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";
import {
  checkBudgets,
  incrementSpent,
  insertBudgetEvent,
  type BudgetRow,
} from "../../core/repositories/budget-repository.js";
import { getBus } from "../bus/index.js";
import { BudgetSoftAlert, BudgetHardStop } from "../bus/events.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(public readonly budget: BudgetRow) {
    super(
      `Budget exceeded: ${budget.scope}/${budget.scope_id ?? "instance"} — ` +
        `$${budget.spent_usd.toFixed(4)} / $${budget.limit_usd.toFixed(4)}`,
    );
    this.name = "BudgetExceededError";
  }
}

// ---------------------------------------------------------------------------
// Pre-LLM check (belt)
// ---------------------------------------------------------------------------

/**
 * Check budgets BEFORE an LLM call. Throws BudgetExceededError if any
 * applicable budget (instance or agent level) has been exceeded.
 * Monthly budgets are lazily reset if their period has expired.
 */
export function preBudgetCheck(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  agentId: string,
): void {
  const results = checkBudgets(db, instanceSlug, agentId);
  for (const r of results) {
    if (r.status === "exceeded") {
      throw new BudgetExceededError(r.budget);
    }
  }
}

// ---------------------------------------------------------------------------
// Post-LLM check (suspenders)
// ---------------------------------------------------------------------------

/**
 * After an LLM call completes: increment spent_usd on all applicable budgets,
 * then check thresholds and publish bus events.
 *
 * Does NOT throw — the current response already completed. The next preBudgetCheck
 * will block subsequent calls if exceeded.
 */
export function postBudgetCheck(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  agentId: string,
  costUsd: number,
): void {
  if (costUsd <= 0) return;

  const results = checkBudgets(db, instanceSlug, agentId);
  const bus = getBus(instanceSlug);

  for (const r of results) {
    const prevPct = r.budget.limit_usd > 0 ? r.budget.spent_usd / r.budget.limit_usd : 0;
    const updated = incrementSpent(db, r.budget.id, costUsd);
    const newPct = updated.limit_usd > 0 ? updated.spent_usd / updated.limit_usd : 0;

    // Hard stop crossing
    if (newPct >= updated.hard_stop_pct && prevPct < updated.hard_stop_pct) {
      insertBudgetEvent(db, {
        budgetId: updated.id,
        eventType: "hard_stop",
        currentUsd: updated.spent_usd,
        limitUsd: updated.limit_usd,
        message: `Budget exceeded at ${Math.round(newPct * 100)}%`,
      });
      bus.publish(BudgetHardStop, {
        instanceSlug,
        budgetId: updated.id,
        scope: updated.scope,
        scopeId: updated.scope_id,
        spentUsd: updated.spent_usd,
        limitUsd: updated.limit_usd,
      });
    }
    // Soft alert crossing
    else if (newPct >= updated.soft_alert_pct && prevPct < updated.soft_alert_pct) {
      insertBudgetEvent(db, {
        budgetId: updated.id,
        eventType: "soft_alert",
        currentUsd: updated.spent_usd,
        limitUsd: updated.limit_usd,
        message: `Soft alert at ${Math.round(newPct * 100)}%`,
      });
      bus.publish(BudgetSoftAlert, {
        instanceSlug,
        budgetId: updated.id,
        scope: updated.scope,
        scopeId: updated.scope_id,
        spentUsd: updated.spent_usd,
        limitUsd: updated.limit_usd,
        pct: newPct,
      });
    }
  }
}
