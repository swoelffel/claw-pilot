// src/core/__tests__/flow-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import {
  createFlowDefinition,
  getFlowDefinition,
  listFlowDefinitions,
  updateFlowDefinition,
  deleteFlowDefinition,
  createFlowRun,
  getFlowRun,
  listFlowRuns,
  updateFlowRunStatus,
  createStepRun,
  updateStepRun,
  getStepRunsForRun,
  getStepRun,
  getReadySteps,
  allStepsTerminal,
  hasFailedSteps,
  hasUnsuccessfulSteps,
  countFlowSessions,
  listFlowSessions,
} from "../repositories/flow-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;

const STEPS_LINEAR = JSON.stringify([
  { id: "a", agentId: "agent-1", prompt: "Do A", dependsOn: [] },
  { id: "b", agentId: "agent-2", prompt: "Do B", dependsOn: ["a"] },
  { id: "c", agentId: "agent-3", prompt: "Do C", dependsOn: ["b"] },
]);

const STEPS_FANOUT = JSON.stringify([
  { id: "start", agentId: "agent-1", prompt: "Start", dependsOn: [] },
  { id: "left", agentId: "agent-2", prompt: "Left branch", dependsOn: ["start"] },
  { id: "right", agentId: "agent-3", prompt: "Right branch", dependsOn: ["start"] },
  { id: "join", agentId: "agent-4", prompt: "Join", dependsOn: ["left", "right"] },
]);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-flow-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Flow definitions CRUD
// ---------------------------------------------------------------------------

describe("flow definitions", () => {
  it("creates and retrieves a flow definition", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "My Flow",
      description: "A test flow",
      stepsJson: STEPS_LINEAR,
    });
    expect(flow.id).toBeGreaterThan(0);
    expect(flow.instance_slug).toBe("inst-1");
    expect(flow.name).toBe("My Flow");
    expect(flow.description).toBe("A test flow");
    expect(flow.enabled).toBe(1);
    expect(flow.trigger_json).toBe('{"type":"manual"}');

    const fetched = getFlowDefinition(db, flow.id);
    expect(fetched).toEqual(flow);
  });

  it("lists flows for an instance", () => {
    createFlowDefinition(db, { instanceSlug: "inst-1", name: "Flow A", stepsJson: STEPS_LINEAR });
    createFlowDefinition(db, { instanceSlug: "inst-1", name: "Flow B", stepsJson: STEPS_LINEAR });
    createFlowDefinition(db, { instanceSlug: "inst-2", name: "Flow C", stepsJson: STEPS_LINEAR });

    const list = listFlowDefinitions(db, "inst-1");
    expect(list).toHaveLength(2);
    expect(list.map((f) => f.name)).toEqual(["Flow A", "Flow B"]);
  });

  it("updates a flow definition", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Original",
      stepsJson: STEPS_LINEAR,
    });
    const updated = updateFlowDefinition(db, flow.id, {
      name: "Renamed",
      description: "New desc",
      enabled: false,
    });
    expect(updated!.name).toBe("Renamed");
    expect(updated!.description).toBe("New desc");
    expect(updated!.enabled).toBe(0);
  });

  it("returns unchanged flow when update has no fields", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Stable",
      stepsJson: STEPS_LINEAR,
    });
    const same = updateFlowDefinition(db, flow.id, {});
    expect(same!.name).toBe("Stable");
  });

  it("deletes a flow definition and cascades to runs", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Doomed",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });

    expect(deleteFlowDefinition(db, flow.id)).toBe(true);
    expect(getFlowDefinition(db, flow.id)).toBeUndefined();
    expect(getFlowRun(db, run.id)).toBeUndefined();
    expect(getStepRunsForRun(db, run.id)).toHaveLength(0);
  });

  it("returns false when deleting non-existent flow", () => {
    expect(deleteFlowDefinition(db, 9999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Flow runs
// ---------------------------------------------------------------------------

describe("flow runs", () => {
  it("creates and retrieves a flow run", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
      triggerDetail: '{"user":"admin"}',
    });
    expect(run.status).toBe("pending");
    expect(run.trigger_type).toBe("manual");
    expect(run.trigger_detail).toBe('{"user":"admin"}');
    expect(run.started_at).toBeNull();
  });

  it("lists runs filtered by flow id", () => {
    const f1 = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "F1",
      stepsJson: STEPS_LINEAR,
    });
    const f2 = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "F2",
      stepsJson: STEPS_LINEAR,
    });
    createFlowRun(db, { flowId: f1.id, instanceSlug: "inst-1", triggerType: "manual" });
    createFlowRun(db, { flowId: f1.id, instanceSlug: "inst-1", triggerType: "manual" });
    createFlowRun(db, { flowId: f2.id, instanceSlug: "inst-1", triggerType: "bus" });

    const runs = listFlowRuns(db, "inst-1", { flowId: f1.id });
    expect(runs).toHaveLength(2);
  });

  it("updates run status with timestamps", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    const running = updateFlowRunStatus(db, run.id, "running");
    expect(running!.status).toBe("running");
    expect(running!.started_at).not.toBeNull();
    expect(running!.finished_at).toBeNull();

    const completed = updateFlowRunStatus(db, run.id, "completed");
    expect(completed!.status).toBe("completed");
    expect(completed!.finished_at).not.toBeNull();
  });

  it("updates run status with error", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const failed = updateFlowRunStatus(db, run.id, "failed", "Step X blew up");
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toBe("Step X blew up");
  });

  it("respects limit parameter", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    for (let i = 0; i < 5; i++) {
      createFlowRun(db, { flowId: flow.id, instanceSlug: "inst-1", triggerType: "manual" });
    }
    const limited = listFlowRuns(db, "inst-1", { limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Step runs
// ---------------------------------------------------------------------------

describe("step runs", () => {
  it("creates and retrieves step runs", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "agent-2" });

    const steps = getStepRunsForRun(db, run.id);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.step_id).toBe("a");
    expect(steps[0]!.status).toBe("pending");
  });

  it("updates step run status with timestamps", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const step = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });

    const running = updateStepRun(db, step.id, { status: "running" });
    expect(running!.status).toBe("running");
    expect(running!.started_at).not.toBeNull();

    const completed = updateStepRun(db, step.id, {
      status: "completed",
      resultText: "Done!",
      sitrepJson: '{"outcome":"success","summary":"All good"}',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.003,
    });
    expect(completed!.status).toBe("completed");
    expect(completed!.finished_at).not.toBeNull();
    expect(completed!.result_text).toBe("Done!");
    expect(completed!.sitrep_json).toContain("success");
    expect(completed!.tokens_in).toBe(100);
    expect(completed!.cost_usd).toBe(0.003);
  });

  it("gets a specific step run by run id and step id", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "agent-2" });

    const step = getStepRun(db, run.id, "b");
    expect(step!.step_id).toBe("b");
    expect(step!.agent_id).toBe("agent-2");
  });
});

// ---------------------------------------------------------------------------
// DAG-aware queries
// ---------------------------------------------------------------------------

describe("getReadySteps", () => {
  it("returns root steps (no deps) when all are pending", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "agent-2" });
    createStepRun(db, { runId: run.id, stepId: "c", agentId: "agent-3" });

    const ready = getReadySteps(db, run.id, STEPS_LINEAR);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.step_id).toBe("a");
  });

  it("returns next steps after dependency completes", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const stepA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "agent-2" });
    createStepRun(db, { runId: run.id, stepId: "c", agentId: "agent-3" });

    updateStepRun(db, stepA.id, { status: "completed" });

    const ready = getReadySteps(db, run.id, STEPS_LINEAR);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.step_id).toBe("b");
  });

  it("returns parallel steps in fan-out DAG", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Fanout",
      stepsJson: STEPS_FANOUT,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const stepStart = createStepRun(db, { runId: run.id, stepId: "start", agentId: "agent-1" });
    createStepRun(db, { runId: run.id, stepId: "left", agentId: "agent-2" });
    createStepRun(db, { runId: run.id, stepId: "right", agentId: "agent-3" });
    createStepRun(db, { runId: run.id, stepId: "join", agentId: "agent-4" });

    updateStepRun(db, stepStart.id, { status: "completed" });

    const ready = getReadySteps(db, run.id, STEPS_FANOUT);
    expect(ready).toHaveLength(2);
    expect(ready.map((s) => s.step_id).sort()).toEqual(["left", "right"]);
  });

  it("waits for all deps in fan-in", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Fanout",
      stepsJson: STEPS_FANOUT,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const stepStart = createStepRun(db, { runId: run.id, stepId: "start", agentId: "agent-1" });
    const stepLeft = createStepRun(db, { runId: run.id, stepId: "left", agentId: "agent-2" });
    createStepRun(db, { runId: run.id, stepId: "right", agentId: "agent-3" });
    createStepRun(db, { runId: run.id, stepId: "join", agentId: "agent-4" });

    updateStepRun(db, stepStart.id, { status: "completed" });
    updateStepRun(db, stepLeft.id, { status: "completed" });
    // right is still pending → join should NOT be ready

    const ready = getReadySteps(db, run.id, STEPS_FANOUT);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.step_id).toBe("right");
  });

  // Regression: agents creating flows via cp_create_flow may omit dependsOn
  // on root steps (Zod schema marks it optional). Engine must treat undefined
  // as []. Before the fix, this produced "dependsOn is not iterable".
  it("treats missing dependsOn as empty array", () => {
    const stepsJson = JSON.stringify([
      { id: "root", agentId: "agent-1", prompt: "Root" }, // no dependsOn
      { id: "child", agentId: "agent-2", prompt: "Child", dependsOn: ["root"] },
    ]);
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "No depsOn",
      stepsJson,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    createStepRun(db, { runId: run.id, stepId: "root", agentId: "agent-1" });
    createStepRun(db, { runId: run.id, stepId: "child", agentId: "agent-2" });

    const ready = getReadySteps(db, run.id, stepsJson);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.step_id).toBe("root");
  });
});

describe("allStepsTerminal", () => {
  it("returns false when some steps are pending", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    expect(allStepsTerminal(db, run.id)).toBe(false);
  });

  it("returns true when all steps are completed/failed/skipped", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    const s2 = createStepRun(db, { runId: run.id, stepId: "b", agentId: "agent-2" });
    const s3 = createStepRun(db, { runId: run.id, stepId: "c", agentId: "agent-3" });

    updateStepRun(db, s1.id, { status: "completed" });
    updateStepRun(db, s2.id, { status: "failed" });
    updateStepRun(db, s3.id, { status: "skipped" });

    expect(allStepsTerminal(db, run.id)).toBe(true);
  });
});

describe("hasFailedSteps", () => {
  it("returns false when no steps have failed", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, s1.id, { status: "completed" });

    expect(hasFailedSteps(db, run.id)).toBe(false);
  });

  it("returns true when a step has failed", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, s1.id, { status: "failed", error: "Boom" });

    expect(hasFailedSteps(db, run.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasUnsuccessfulSteps
// ---------------------------------------------------------------------------

describe("hasUnsuccessfulSteps", () => {
  it("returns false when every completed step has outcome=success", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, s1.id, {
      status: "completed",
      sitrepJson: JSON.stringify({ outcome: "success", summary: "ok", keyFindings: [] }),
    });

    expect(hasUnsuccessfulSteps(db, run.id)).toBe(false);
  });

  // Regression: web-maintenance run #2 — write-content completed with
  // outcome=partial, but hasFailedSteps (status='failed') returned false,
  // so the run was marked completed despite a functional failure.
  it("returns true when a completed step has outcome=partial", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, s1.id, {
      status: "completed",
      sitrepJson: JSON.stringify({ outcome: "partial", summary: "", keyFindings: [] }),
    });

    expect(hasUnsuccessfulSteps(db, run.id)).toBe(true);
  });

  it("returns true when a completed step has outcome=failure", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, s1.id, {
      status: "completed",
      sitrepJson: JSON.stringify({ outcome: "failure", summary: "nope", keyFindings: [] }),
    });

    expect(hasUnsuccessfulSteps(db, run.id)).toBe(true);
  });

  it("returns true when a completed step has no sitrep", () => {
    // Defensive: a completed step without a parseable success marker
    // cannot be claimed successful — the engine requires explicit confirmation.
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, s1.id, { status: "completed" });

    expect(hasUnsuccessfulSteps(db, run.id)).toBe(true);
  });

  it("ignores skipped and failed steps (those are covered by hasFailedSteps)", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: JSON.stringify([
        { id: "a", agentId: "ag", prompt: "A" },
        { id: "b", agentId: "ag", prompt: "B", dependsOn: ["a"] },
      ]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const sA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "ag" });
    const sB = createStepRun(db, { runId: run.id, stepId: "b", agentId: "ag" });
    updateStepRun(db, sA.id, { status: "failed", error: "boom" });
    updateStepRun(db, sB.id, { status: "skipped" });

    // Neither step is "completed" so hasUnsuccessfulSteps must be false —
    // the "failed" status is already covered by hasFailedSteps.
    expect(hasUnsuccessfulSteps(db, run.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getReadySteps — continueOnFailure
// ---------------------------------------------------------------------------

describe("getReadySteps with continueOnFailure", () => {
  it("does NOT mark a step ready when an upstream failed and continueOnFailure is absent", () => {
    const stepsJson = JSON.stringify([
      { id: "a", agentId: "ag", prompt: "A" },
      { id: "b", agentId: "ag", prompt: "B", dependsOn: ["a"] },
    ]);
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const sA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "ag" });
    createStepRun(db, { runId: run.id, stepId: "b", agentId: "ag" });
    updateStepRun(db, sA.id, { status: "failed", error: "boom" });

    const ready = getReadySteps(db, run.id, stepsJson);
    expect(ready.map((s) => s.step_id)).not.toContain("b");
  });

  it("marks a step ready with continueOnFailure=true even when an upstream failed", () => {
    const stepsJson = JSON.stringify([
      { id: "a", agentId: "ag", prompt: "A" },
      {
        id: "notify",
        agentId: "ag",
        prompt: "Notify",
        dependsOn: ["a"],
        continueOnFailure: true,
      },
    ]);
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const sA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "ag" });
    createStepRun(db, { runId: run.id, stepId: "notify", agentId: "ag" });
    updateStepRun(db, sA.id, { status: "failed", error: "boom" });

    const ready = getReadySteps(db, run.id, stepsJson);
    expect(ready.map((s) => s.step_id)).toContain("notify");
  });

  it("marks a step ready with continueOnFailure=true when an upstream was skipped", () => {
    const stepsJson = JSON.stringify([
      { id: "a", agentId: "ag", prompt: "A" },
      {
        id: "notify",
        agentId: "ag",
        prompt: "Notify",
        dependsOn: ["a"],
        continueOnFailure: true,
      },
    ]);
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const sA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "ag" });
    createStepRun(db, { runId: run.id, stepId: "notify", agentId: "ag" });
    updateStepRun(db, sA.id, { status: "skipped" });

    const ready = getReadySteps(db, run.id, stepsJson);
    expect(ready.map((s) => s.step_id)).toContain("notify");
  });
});

// ---------------------------------------------------------------------------
// Flow sessions (countFlowSessions / listFlowSessions)
// ---------------------------------------------------------------------------

describe("flow sessions", () => {
  function seedFlowWithSessions() {
    // Ensure the instance exists for FK on rt_sessions
    db.prepare(
      "INSERT OR IGNORE INTO servers (id, hostname, openclaw_home) VALUES (1, 'localhost', '/opt')",
    ).run();
    db.prepare(
      "INSERT OR IGNORE INTO instances (slug, server_id, port, config_path, state_dir, systemd_unit) VALUES (?, 1, 18789, '/tmp/cfg', '/tmp/state', 'test')",
    ).run("inst-1");

    // Create a flow + run + step runs with sessions
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "SessionFlow",
      stepsJson: STEPS_LINEAR,
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    // Create sessions in rt_sessions with different timestamps for cursor pagination
    db.prepare(
      "INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("sess-a", "inst-1", "agent-1", "web", "2026-01-01 10:00:00");
    db.prepare(
      "INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("sess-b", "inst-1", "agent-2", "web", "2026-01-01 11:00:00");

    // Create step runs linking to sessions
    const sA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "agent-1" });
    updateStepRun(db, sA.id, { sessionId: "sess-a", status: "completed" });
    const sB = createStepRun(db, { runId: run.id, stepId: "b", agentId: "agent-2" });
    updateStepRun(db, sB.id, { sessionId: "sess-b", status: "completed" });
    // Step c has no session (still pending)
    createStepRun(db, { runId: run.id, stepId: "c", agentId: "agent-3" });

    // Add some messages to sess-a
    db.prepare(
      "INSERT INTO rt_messages (id, session_id, role, tokens_in, tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("msg-1", "sess-a", "user", 100, 0, 0);
    db.prepare(
      "INSERT INTO rt_messages (id, session_id, role, tokens_in, tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("msg-2", "sess-a", "assistant", 0, 500, 0.01);

    return { flow, run };
  }

  it("countFlowSessions returns distinct count", () => {
    const { flow } = seedFlowWithSessions();
    expect(countFlowSessions(db, flow.id)).toBe(2);
  });

  it("countFlowSessions returns 0 for flow with no sessions", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "NoSessions",
      stepsJson: STEPS_LINEAR,
    });
    expect(countFlowSessions(db, flow.id)).toBe(0);
  });

  it("listFlowSessions returns sessions with stats", () => {
    const { flow } = seedFlowWithSessions();
    const { sessions, hasMore } = listFlowSessions(db, flow.id);

    expect(sessions).toHaveLength(2);
    expect(hasMore).toBe(false);

    // Sessions are ordered by created_at DESC — most recent first
    // Both were created roughly at the same time, so we check both exist
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("sess-a");
    expect(ids).toContain("sess-b");

    // Check stats for sess-a (has 2 messages)
    const sessA = sessions.find((s) => s.id === "sess-a")!;
    expect(sessA.message_count).toBe(2);
    expect(sessA.total_tokens).toBe(600); // 100+0+0+500
    expect(sessA.total_cost_usd).toBe(0.01);
    expect(sessA.prompt_loops).toBe(1); // 1 assistant message
  });

  it("listFlowSessions respects limit and cursor pagination", () => {
    const { flow } = seedFlowWithSessions();

    // First page: limit 1
    const page1 = listFlowSessions(db, flow.id, { limit: 1 });
    expect(page1.sessions).toHaveLength(1);
    expect(page1.hasMore).toBe(true);

    // Second page using cursor
    const page2 = listFlowSessions(db, flow.id, {
      limit: 1,
      before: page1.sessions[0]!.created_at,
    });
    expect(page2.sessions).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    expect(page2.sessions[0]!.id).not.toBe(page1.sessions[0]!.id);
  });
});
