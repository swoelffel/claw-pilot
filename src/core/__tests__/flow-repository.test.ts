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
