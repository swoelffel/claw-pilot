// src/runtime/session/__tests__/budget-check.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { Registry } from "../../../core/registry.js";
import {
  createBudget,
  getBudget,
  incrementSpent,
  getBudgetEvents,
} from "../../../core/repositories/budget-repository.js";
import { preBudgetCheck, postBudgetCheck, BudgetExceededError } from "../budget-check.js";
import { getBus, disposeBus } from "../../bus/index.js";
import { BudgetSoftAlert, BudgetHardStop } from "../../bus/events.js";
import type { InstanceSlug } from "../../types.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
const SLUG = "test-inst" as InstanceSlug;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-budget-check-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: SLUG,
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
});

afterEach(() => {
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// preBudgetCheck
// ---------------------------------------------------------------------------

describe("preBudgetCheck", () => {
  it("does nothing when no budgets exist", () => {
    expect(() => preBudgetCheck(db, SLUG, "pilot")).not.toThrow();
  });

  it("does nothing when budget is under limit", () => {
    createBudget(db, { instanceSlug: SLUG, scope: "instance", limitUsd: 100 });
    expect(() => preBudgetCheck(db, SLUG, "pilot")).not.toThrow();
  });

  it("throws BudgetExceededError when instance budget exceeded", () => {
    const b = createBudget(db, { instanceSlug: SLUG, scope: "instance", limitUsd: 10 });
    incrementSpent(db, b.id, 10);
    expect(() => preBudgetCheck(db, SLUG, "pilot")).toThrow(BudgetExceededError);
  });

  it("throws BudgetExceededError when agent budget exceeded", () => {
    const b = createBudget(db, {
      instanceSlug: SLUG,
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 5,
    });
    incrementSpent(db, b.id, 5);
    expect(() => preBudgetCheck(db, SLUG, "pilot")).toThrow(BudgetExceededError);
  });

  it("does not throw for a different agent", () => {
    const b = createBudget(db, {
      instanceSlug: SLUG,
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 5,
    });
    incrementSpent(db, b.id, 5);
    // "builder" agent has no budget
    expect(() => preBudgetCheck(db, SLUG, "builder")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// postBudgetCheck
// ---------------------------------------------------------------------------

describe("postBudgetCheck", () => {
  it("increments spent_usd on applicable budgets", () => {
    const b = createBudget(db, { instanceSlug: SLUG, scope: "instance", limitUsd: 100 });
    postBudgetCheck(db, SLUG, "pilot", 0.5);
    expect(getBudget(db, b.id)!.spent_usd).toBeCloseTo(0.5, 6);
  });

  it("does nothing for zero cost", () => {
    const b = createBudget(db, { instanceSlug: SLUG, scope: "instance", limitUsd: 100 });
    postBudgetCheck(db, SLUG, "pilot", 0);
    expect(getBudget(db, b.id)!.spent_usd).toBe(0);
  });

  it("publishes BudgetSoftAlert when crossing soft threshold", () => {
    const b = createBudget(db, {
      instanceSlug: SLUG,
      scope: "instance",
      limitUsd: 10,
      softAlertPct: 0.8,
    });
    incrementSpent(db, b.id, 7); // 70%

    const events: unknown[] = [];
    const bus = getBus(SLUG);
    bus.subscribe(BudgetSoftAlert, (payload) => events.push(payload));

    postBudgetCheck(db, SLUG, "pilot", 1.5); // 70% + 15% = 85% → crosses 80%
    expect(events).toHaveLength(1);

    const budgetEvents = getBudgetEvents(db, b.id);
    expect(budgetEvents.some((e) => e.event_type === "soft_alert")).toBe(true);
  });

  it("publishes BudgetHardStop when crossing hard threshold", () => {
    const b = createBudget(db, {
      instanceSlug: SLUG,
      scope: "instance",
      limitUsd: 10,
      hardStopPct: 1.0,
    });
    incrementSpent(db, b.id, 9); // 90%

    const events: unknown[] = [];
    const bus = getBus(SLUG);
    bus.subscribe(BudgetHardStop, (payload) => events.push(payload));

    postBudgetCheck(db, SLUG, "pilot", 1.5); // 90% + 15% = 105% → crosses 100%
    expect(events).toHaveLength(1);

    const budgetEvents = getBudgetEvents(db, b.id);
    expect(budgetEvents.some((e) => e.event_type === "hard_stop")).toBe(true);
  });

  it("does not publish alert when already above threshold", () => {
    const b = createBudget(db, {
      instanceSlug: SLUG,
      scope: "instance",
      limitUsd: 10,
      softAlertPct: 0.8,
    });
    incrementSpent(db, b.id, 8.5); // already 85% > 80%

    const events: unknown[] = [];
    const bus = getBus(SLUG);
    bus.subscribe(BudgetSoftAlert, (payload) => events.push(payload));

    postBudgetCheck(db, SLUG, "pilot", 0.5); // 85% + 5% = 90%, but was already > 80%
    expect(events).toHaveLength(0);
  });

  it("increments both instance and agent budgets", () => {
    const b1 = createBudget(db, { instanceSlug: SLUG, scope: "instance", limitUsd: 100 });
    const b2 = createBudget(db, {
      instanceSlug: SLUG,
      scope: "agent",
      scopeId: "pilot",
      limitUsd: 20,
    });
    postBudgetCheck(db, SLUG, "pilot", 1.0);
    expect(getBudget(db, b1.id)!.spent_usd).toBeCloseTo(1.0, 6);
    expect(getBudget(db, b2.id)!.spent_usd).toBeCloseTo(1.0, 6);
  });
});
