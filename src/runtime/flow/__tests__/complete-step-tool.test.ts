// src/runtime/flow/__tests__/complete-step-tool.test.ts
//
// Unit tests for the factory-created `complete_step` tool.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import {
  createFlowDefinition,
  createFlowRun,
  createStepRun,
  getStepRun,
} from "../../../core/repositories/flow-repository.js";
import { createCompleteStepTool, CompleteStepSchema } from "../complete-step-tool.js";
import type { Tool } from "../../tool/tool.js";

let db: ReturnType<typeof initDatabase>;

beforeEach(() => {
  db = initDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function makeCtx(): Tool.Context {
  return {
    sessionId: "test-session",
    messageId: "test-msg",
    agentId: "test-agent",
    abort: new AbortController().signal,
    metadata: () => {},
  };
}

function seedStepRun(): { runId: number; stepRunId: number } {
  const flow = createFlowDefinition(db, {
    instanceSlug: "inst-1",
    name: "Test",
    stepsJson: JSON.stringify([{ id: "s1", agentId: "a1", prompt: "p" }]),
  });
  const run = createFlowRun(db, {
    flowId: flow.id,
    instanceSlug: "inst-1",
    triggerType: "manual",
  });
  const stepRun = createStepRun(db, { runId: run.id, stepId: "s1", agentId: "a1" });
  return { runId: run.id, stepRunId: stepRun.id };
}

describe("createCompleteStepTool", () => {
  it("writes sitrep_json directly to rt_flow_step_runs when invoked", async () => {
    const { runId, stepRunId } = seedStepRun();
    const tool = createCompleteStepTool(db, stepRunId);
    const def = await tool.init();

    await def.execute(
      {
        outcome: "success",
        summary: "All good.",
        keyFindings: ["finding A", "finding B"],
      },
      makeCtx(),
    );

    const row = getStepRun(db, runId, "s1");
    expect(row?.sitrep_json).toBeDefined();
    const sitrep = JSON.parse(row!.sitrep_json!);
    expect(sitrep).toEqual({
      outcome: "success",
      summary: "All good.",
      keyFindings: ["finding A", "finding B"],
    });
  });

  it("returns a user-visible ack that signals the engine will close the step", async () => {
    const { stepRunId } = seedStepRun();
    const tool = createCompleteStepTool(db, stepRunId);
    const def = await tool.init();

    const result = await def.execute(
      {
        outcome: "failure",
        summary: "Auth failed.",
        keyFindings: [],
      },
      makeCtx(),
    );

    expect(result.title).toContain("failure");
    expect(result.output).toContain("failure");
    expect(result.truncated).toBe(false);
  });

  it("rejects invalid outcome values via Zod validation", async () => {
    const { stepRunId } = seedStepRun();
    const tool = createCompleteStepTool(db, stepRunId);
    const def = await tool.init();

    await expect(
      def.execute(
        // @ts-expect-error — intentionally invalid outcome
        { outcome: "done", summary: "x", keyFindings: [] },
        makeCtx(),
      ),
    ).rejects.toThrow(/invalid arguments/i);
  });

  it("defaults keyFindings to an empty array when omitted", async () => {
    const { runId, stepRunId } = seedStepRun();
    const tool = createCompleteStepTool(db, stepRunId);
    const def = await tool.init();

    // Zod schema has `.default([])` on keyFindings — omitting it is valid.
    await def.execute(
      // @ts-expect-error — keyFindings relies on Zod's default
      { outcome: "partial", summary: "Some done." },
      makeCtx(),
    );

    const row = getStepRun(db, runId, "s1");
    const sitrep = JSON.parse(row!.sitrep_json!);
    expect(sitrep.keyFindings).toEqual([]);
  });

  it("writes only to the bound stepRunId (other rows are untouched)", async () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test",
      stepsJson: JSON.stringify([
        { id: "s1", agentId: "a1", prompt: "p" },
        { id: "s2", agentId: "a2", prompt: "p" },
      ]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    const s1 = createStepRun(db, { runId: run.id, stepId: "s1", agentId: "a1" });
    const s2 = createStepRun(db, { runId: run.id, stepId: "s2", agentId: "a2" });

    const toolForS1 = createCompleteStepTool(db, s1.id);
    const def = await toolForS1.init();
    await def.execute({ outcome: "success", summary: "s1 done", keyFindings: [] }, makeCtx());

    expect(getStepRun(db, run.id, "s1")?.sitrep_json).toBeTruthy();
    expect(getStepRun(db, run.id, "s2")?.sitrep_json).toBeNull();

    // The s2-bound tool writes only to s2
    const toolForS2 = createCompleteStepTool(db, s2.id);
    const def2 = await toolForS2.init();
    await def2.execute(
      { outcome: "failure", summary: "s2 broke", keyFindings: ["err"] },
      makeCtx(),
    );

    const s1After = getStepRun(db, run.id, "s1");
    const s2After = getStepRun(db, run.id, "s2");
    expect(JSON.parse(s1After!.sitrep_json!).outcome).toBe("success");
    expect(JSON.parse(s2After!.sitrep_json!).outcome).toBe("failure");
  });

  it("tool id is exactly `complete_step` (must match hasToolCall() in prompt-loop)", () => {
    const tool = createCompleteStepTool(db, 1);
    expect(tool.id).toBe("complete_step");
  });

  it("accepts a keyFindings item longer than 500 characters", () => {
    const longFinding = "x".repeat(1500);

    const result = CompleteStepSchema.safeParse({
      outcome: "success",
      summary: "Step completed.",
      keyFindings: [longFinding],
    });
    expect(result.success).toBe(true);
  });
});
