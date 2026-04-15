// src/runtime/flow/__tests__/engine.test.ts
//
// Regression tests for the flow engine internals.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { _collectDepSitreps } from "../engine.js";
import {
  createFlowDefinition,
  createFlowRun,
  createStepRun,
  updateStepRun,
} from "../../../core/repositories/flow-repository.js";

let db: ReturnType<typeof initDatabase>;

beforeEach(() => {
  db = initDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("_collectDepSitreps", () => {
  // Regression: root steps may omit dependsOn entirely in the stored JSON
  // (Zod schema in cp_create_flow and flow routes marks it optional).
  // Before the fix, the for..of loop threw `dependsOn is not iterable`,
  // crashing the first step and deadlocking the entire flow.
  it("returns [] when dependsOn is undefined (root step)", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Root only",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go" }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    const result = _collectDepSitreps(db, run.id, undefined);
    expect(result).toEqual([]);
  });

  it("returns [] when dependsOn is an empty array", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Empty deps",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go", dependsOn: [] }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    const result = _collectDepSitreps(db, run.id, []);
    expect(result).toEqual([]);
  });

  it("collects sitreps from completed dependency steps", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "With deps",
      stepsJson: JSON.stringify([
        { id: "a", agentId: "a1", prompt: "A" },
        { id: "b", agentId: "a2", prompt: "B", dependsOn: ["a"] },
      ]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const stepA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "a1" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "a2" });

    const sitrep = { outcome: "success" as const, summary: "done", keyFindings: ["ok"] };
    updateStepRun(db, stepA.id, {
      status: "completed",
      sitrepJson: JSON.stringify(sitrep),
    });

    const result = _collectDepSitreps(db, run.id, ["a"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.stepId).toBe("a");
    expect(result[0]!.sitrep).toEqual(sitrep);
  });

  it("skips dependency steps without a sitrep", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "No sitrep",
      stepsJson: JSON.stringify([
        { id: "a", agentId: "a1", prompt: "A" },
        { id: "b", agentId: "a2", prompt: "B", dependsOn: ["a"] },
      ]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    createStepRun(db, { runId: run.id, stepId: "a", agentId: "a1" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "a2" });

    const result = _collectDepSitreps(db, run.id, ["a"]);
    expect(result).toEqual([]);
  });
});
