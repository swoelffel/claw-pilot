// src/core/__tests__/budget-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import {
  createBudget,
  getBudget,
  getBudgetsForInstance,
  getBudgetForScope,
  updateBudget,
  deleteBudget,
  incrementSpent,
  checkBudgets,
  applyOverride,
  resetExpiredMonthlyBudgets,
  reconcileBudget,
  insertBudgetEvent,
  getBudgetEvents,
  getBudgetEventsForInstance,
} from "../repositories/budget-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;

function insertSession(id: string, slug: string, agentId = "main"): void {
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state)
     VALUES (?, ?, ?, 'web', 'active')`,
  ).run(id, slug, agentId);
}

function insertMessage(
  id: string,
  sessionId: string,
  opts: { agentId?: string; costUsd?: number; createdAt?: string } = {},
): void {
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, model, tokens_in, tokens_out, cost_usd, created_at)
     VALUES (?, ?, 'assistant', ?, 'claude-sonnet-4-6', 100, 50, ?, ?)`,
  ).run(
    id,
    sessionId,
    opts.agentId ?? "main",
    opts.costUsd ?? 0.01,
    opts.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " "),
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-budget-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("createBudget", () => {
  it("creates an instance-level monthly budget with defaults", () => {
    const b = createBudget(db, {
      instanceSlug: "test-inst",
      scope: "instance",
      limitUsd: 50,
    });
    expect(b.id).toBeGreaterThan(0);
    expect(b.scope).toBe("instance");
    expect(b.scope_id).toBeNull();
    expect(b.period).toBe("monthly");
    expect(b.limit_usd).toBe(50);
    expect(b.spent_usd).toBe(0);
    expect(b.soft_alert_pct).toBe(0.8);
    expect(b.hard_stop_pct).toBe(1.0);
    expect(b.override_pct).toBe(0.2);
    expect(b.enabled).toBe(1);
  });

  it("creates an agent-level lifetime budget", () => {
    const b = createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      period: "lifetime",
      limitUsd: 100,
      softAlertPct: 0.9,
      hardStopPct: 0.95,
      overridePct: 0.1,
    });
    expect(b.scope).toBe("agent");
    expect(b.scope_id).toBe("pilot");
    expect(b.period).toBe("lifetime");
    expect(b.soft_alert_pct).toBe(0.9);
    expect(b.hard_stop_pct).toBe(0.95);
    expect(b.override_pct).toBe(0.1);
  });

  it("rejects duplicate scope/period combination for agent scope", () => {
    createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 50,
    });
    expect(() =>
      createBudget(db, {
        instanceSlug: "test-inst",
        scope: "agent",
        scopeId: "pilot",
        limitUsd: 100,
      }),
    ).toThrow();
  });
});

describe("getBudget", () => {
  it("returns undefined for missing id", () => {
    expect(getBudget(db, 9999)).toBeUndefined();
  });
});

describe("getBudgetsForInstance", () => {
  it("returns all budgets for a slug", () => {
    createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 20,
    });
    const list = getBudgetsForInstance(db, "test-inst");
    expect(list).toHaveLength(2);
  });

  it("returns empty for unknown slug", () => {
    expect(getBudgetsForInstance(db, "unknown")).toEqual([]);
  });
});

describe("getBudgetForScope", () => {
  it("finds budget by scope key", () => {
    createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 25,
    });
    const found = getBudgetForScope(db, "test-inst", "agent", "pilot", "monthly");
    expect(found).toBeDefined();
    expect(found!.limit_usd).toBe(25);
  });

  it("returns undefined when not found", () => {
    expect(getBudgetForScope(db, "test-inst", "instance", null, "monthly")).toBeUndefined();
  });
});

describe("updateBudget", () => {
  it("updates limit and alert thresholds", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    const updated = updateBudget(db, b.id, { limitUsd: 75, softAlertPct: 0.7 });
    expect(updated!.limit_usd).toBe(75);
    expect(updated!.soft_alert_pct).toBe(0.7);
  });

  it("can disable a budget", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    const updated = updateBudget(db, b.id, { enabled: false });
    expect(updated!.enabled).toBe(0);
  });

  it("returns unchanged row when no fields provided", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    const same = updateBudget(db, b.id, {});
    expect(same!.limit_usd).toBe(50);
  });
});

describe("deleteBudget", () => {
  it("deletes budget and cascades events", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    insertBudgetEvent(db, {
      budgetId: b.id,
      eventType: "soft_alert",
      currentUsd: 40,
      limitUsd: 50,
    });
    expect(deleteBudget(db, b.id)).toBe(true);
    expect(getBudget(db, b.id)).toBeUndefined();
    expect(getBudgetEvents(db, b.id)).toEqual([]);
  });

  it("returns false for non-existent id", () => {
    expect(deleteBudget(db, 9999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Counter operations
// ---------------------------------------------------------------------------

describe("incrementSpent", () => {
  it("atomically increments spent_usd", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    const r1 = incrementSpent(db, b.id, 0.5);
    expect(r1.spent_usd).toBeCloseTo(0.5, 6);
    const r2 = incrementSpent(db, b.id, 1.3);
    expect(r2.spent_usd).toBeCloseTo(1.8, 6);
  });
});

// ---------------------------------------------------------------------------
// checkBudgets
// ---------------------------------------------------------------------------

describe("checkBudgets", () => {
  it("returns empty when no budgets exist", () => {
    expect(checkBudgets(db, "test-inst", "pilot")).toEqual([]);
  });

  it("returns ok status when under soft alert", () => {
    createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 100 });
    const results = checkBudgets(db, "test-inst", "pilot");
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("ok");
    expect(results[0]!.usagePct).toBe(0);
  });

  it("returns warning when above soft alert", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 10 });
    incrementSpent(db, b.id, 8.5); // 85%
    const results = checkBudgets(db, "test-inst", "pilot");
    expect(results[0]!.status).toBe("warning");
  });

  it("returns exceeded when above hard stop", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 10 });
    incrementSpent(db, b.id, 10); // 100%
    const results = checkBudgets(db, "test-inst", "pilot");
    expect(results[0]!.status).toBe("exceeded");
  });

  it("checks both instance and agent budgets", () => {
    createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 100 });
    createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 20,
    });
    const results = checkBudgets(db, "test-inst", "pilot");
    expect(results).toHaveLength(2);
  });

  it("skips disabled budgets", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 100 });
    updateBudget(db, b.id, { enabled: false });
    expect(checkBudgets(db, "test-inst", "pilot")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Override
// ---------------------------------------------------------------------------

describe("applyOverride", () => {
  it("increases limit by override_pct and logs event", () => {
    const b = createBudget(db, {
      instanceSlug: "test-inst",
      scope: "instance",
      limitUsd: 50,
      overridePct: 0.2,
    });
    incrementSpent(db, b.id, 50);
    const overridden = applyOverride(db, b.id);
    expect(overridden!.limit_usd).toBeCloseTo(60, 6); // 50 * 1.2
    const events = getBudgetEvents(db, b.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("override");
  });

  it("returns undefined for missing id", () => {
    expect(applyOverride(db, 9999)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Monthly reset
// ---------------------------------------------------------------------------

describe("resetExpiredMonthlyBudgets", () => {
  it("resets budgets with old period_start", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    incrementSpent(db, b.id, 30);
    // Backdate period_start to last month
    db.prepare(
      "UPDATE rt_budgets SET period_start = datetime('now','-32 days','start of month') WHERE id = ?",
    ).run(b.id);
    const count = resetExpiredMonthlyBudgets(db, "test-inst");
    expect(count).toBe(1);
    const after = getBudget(db, b.id)!;
    expect(after.spent_usd).toBe(0);
  });

  it("does not reset current-month budgets", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    incrementSpent(db, b.id, 30);
    const count = resetExpiredMonthlyBudgets(db, "test-inst");
    expect(count).toBe(0);
    expect(getBudget(db, b.id)!.spent_usd).toBeCloseTo(30, 6);
  });

  it("skips lifetime budgets", () => {
    const b = createBudget(db, {
      instanceSlug: "test-inst",
      scope: "instance",
      period: "lifetime",
      limitUsd: 500,
    });
    incrementSpent(db, b.id, 100);
    const count = resetExpiredMonthlyBudgets(db, "test-inst");
    expect(count).toBe(0);
    expect(getBudget(db, b.id)!.spent_usd).toBeCloseTo(100, 6);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

describe("reconcileBudget", () => {
  it("corrects drift when spent_usd diverges from actual messages", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    // Insert actual messages
    insertSession("s1", "test-inst");
    insertMessage("m1", "s1", { costUsd: 0.5 });
    insertMessage("m2", "s1", { costUsd: 0.3 });
    // spent_usd is still 0, drift = 0.8
    const result = reconcileBudget(db, b.id);
    expect(result.corrected).toBe(true);
    expect(result.drift).toBeCloseTo(0.8, 6);
    expect(getBudget(db, b.id)!.spent_usd).toBeCloseTo(0.8, 6);
  });

  it("does not correct small drift", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    incrementSpent(db, b.id, 0.005); // close to 0
    const result = reconcileBudget(db, b.id);
    expect(result.corrected).toBe(false);
  });

  it("scopes reconciliation to agent when scope=agent", () => {
    const b = createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 50,
    });
    insertSession("s1", "test-inst", "pilot");
    insertSession("s2", "test-inst", "other");
    insertMessage("m1", "s1", { agentId: "pilot", costUsd: 1.0 });
    insertMessage("m2", "s2", { agentId: "other", costUsd: 5.0 });
    const result = reconcileBudget(db, b.id);
    expect(result.corrected).toBe(true);
    expect(getBudget(db, b.id)!.spent_usd).toBeCloseTo(1.0, 6);
  });
});

// ---------------------------------------------------------------------------
// Budget events
// ---------------------------------------------------------------------------

describe("budget events", () => {
  it("inserts and retrieves events in reverse chronological order", () => {
    const b = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    insertBudgetEvent(db, {
      budgetId: b.id,
      eventType: "soft_alert",
      currentUsd: 40,
      limitUsd: 50,
      message: "80% reached",
    });
    insertBudgetEvent(db, {
      budgetId: b.id,
      eventType: "hard_stop",
      currentUsd: 50,
      limitUsd: 50,
    });
    const events = getBudgetEvents(db, b.id);
    expect(events).toHaveLength(2);
    // Both may have the same created_at (second precision), check both exist
    const types = events.map((e) => e.event_type);
    expect(types).toContain("soft_alert");
    expect(types).toContain("hard_stop");
    const softEvent = events.find((e) => e.event_type === "soft_alert");
    expect(softEvent!.message).toBe("80% reached");
  });

  it("getBudgetEventsForInstance joins scope info", () => {
    const b1 = createBudget(db, { instanceSlug: "test-inst", scope: "instance", limitUsd: 50 });
    const b2 = createBudget(db, {
      instanceSlug: "test-inst",
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 20,
    });
    insertBudgetEvent(db, {
      budgetId: b1.id,
      eventType: "reset",
      currentUsd: 0,
      limitUsd: 50,
    });
    insertBudgetEvent(db, {
      budgetId: b2.id,
      eventType: "soft_alert",
      currentUsd: 16,
      limitUsd: 20,
    });
    const events = getBudgetEventsForInstance(db, "test-inst");
    expect(events).toHaveLength(2);
    const agentEvent = events.find((e) => e.scope === "agent");
    expect(agentEvent!.scope_id).toBe("pilot");
  });
});
