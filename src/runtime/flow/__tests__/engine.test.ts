// src/runtime/flow/__tests__/engine.test.ts
//
// Regression tests for the flow engine internals.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import {
  _buildStepTemplateContext,
  _collectDepSitreps,
  propagateSkipDownstream,
} from "../engine.js";
import type { SitrepResult } from "../types.js";
import type { FlowStepDef } from "../types.js";
import {
  createFlowDefinition,
  createFlowRun,
  createStepRun,
  getStepRun,
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

// ---------------------------------------------------------------------------
// propagateSkipDownstream
// ---------------------------------------------------------------------------

describe("propagateSkipDownstream", () => {
  const setup = (stepDefs: FlowStepDef[]): { runId: number; stepDefs: FlowStepDef[] } => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "Test flow",
      stepsJson: JSON.stringify(stepDefs),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });
    for (const def of stepDefs) {
      createStepRun(db, { runId: run.id, stepId: def.id, agentId: def.agentId });
    }
    return { runId: run.id, stepDefs };
  };

  // Regression: real-world scenario from web-maintenance run #2 —
  // write-content returned outcome=partial, but open-pr was still executed
  // because the old code only looked at step status (completed) not outcome.
  it("marks pending dependent steps as skipped when a step fails upstream", () => {
    const defs: FlowStepDef[] = [
      { id: "a", agentId: "ag-a", prompt: "A" },
      { id: "b", agentId: "ag-b", prompt: "B", dependsOn: ["a"] },
    ];
    const { runId, stepDefs } = setup(defs);

    propagateSkipDownstream(db, runId, stepDefs, "a");

    const b = getStepRun(db, runId, "b");
    expect(b?.status).toBe("skipped");
    expect(b?.error).toContain('dependency "a"');
  });

  it("does not skip a step with continueOnFailure=true", () => {
    const defs: FlowStepDef[] = [
      { id: "a", agentId: "ag-a", prompt: "A" },
      {
        id: "notify",
        agentId: "ag-notify",
        prompt: "Notify",
        dependsOn: ["a"],
        continueOnFailure: true,
      },
    ];
    const { runId, stepDefs } = setup(defs);

    propagateSkipDownstream(db, runId, stepDefs, "a");

    const notify = getStepRun(db, runId, "notify");
    expect(notify?.status).toBe("pending");
  });

  it("propagates skip transitively through a dependency chain", () => {
    const defs: FlowStepDef[] = [
      { id: "a", agentId: "ag", prompt: "A" },
      { id: "b", agentId: "ag", prompt: "B", dependsOn: ["a"] },
      { id: "c", agentId: "ag", prompt: "C", dependsOn: ["b"] },
    ];
    const { runId, stepDefs } = setup(defs);

    propagateSkipDownstream(db, runId, stepDefs, "a");

    expect(getStepRun(db, runId, "b")?.status).toBe("skipped");
    expect(getStepRun(db, runId, "c")?.status).toBe("skipped");
  });

  it("stops propagation at a continueOnFailure step (does not skip its descendants)", () => {
    // a → notify (continueOnFailure) → report
    // When `a` fails: notify stays pending (will run), and report also stays
    // pending because its parent (notify) has not yet produced a non-success
    // outcome. It only becomes a candidate for skip once notify itself fails.
    const defs: FlowStepDef[] = [
      { id: "a", agentId: "ag", prompt: "A" },
      {
        id: "notify",
        agentId: "ag",
        prompt: "Notify",
        dependsOn: ["a"],
        continueOnFailure: true,
      },
      { id: "report", agentId: "ag", prompt: "Report", dependsOn: ["notify"] },
    ];
    const { runId, stepDefs } = setup(defs);

    propagateSkipDownstream(db, runId, stepDefs, "a");

    expect(getStepRun(db, runId, "notify")?.status).toBe("pending");
    expect(getStepRun(db, runId, "report")?.status).toBe("pending");
  });

  it("leaves sibling steps alone (only marks direct/transitive dependents)", () => {
    // a → b, c is an independent root
    const defs: FlowStepDef[] = [
      { id: "a", agentId: "ag", prompt: "A" },
      { id: "b", agentId: "ag", prompt: "B", dependsOn: ["a"] },
      { id: "c", agentId: "ag", prompt: "C" },
    ];
    const { runId, stepDefs } = setup(defs);

    propagateSkipDownstream(db, runId, stepDefs, "a");

    expect(getStepRun(db, runId, "b")?.status).toBe("skipped");
    expect(getStepRun(db, runId, "c")?.status).toBe("pending");
  });

  it("does not overwrite a step that is already running/completed/failed", () => {
    const defs: FlowStepDef[] = [
      { id: "a", agentId: "ag", prompt: "A" },
      { id: "b", agentId: "ag", prompt: "B", dependsOn: ["a"] },
    ];
    const { runId, stepDefs } = setup(defs);

    const bRow = getStepRun(db, runId, "b");
    if (!bRow) throw new Error("setup failed");
    updateStepRun(db, bRow.id, { status: "running" });

    propagateSkipDownstream(db, runId, stepDefs, "a");

    expect(getStepRun(db, runId, "b")?.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// _buildStepTemplateContext — vars + steps templating context
// ---------------------------------------------------------------------------

describe("_buildStepTemplateContext", () => {
  const makeSitrep = (summary: string): SitrepResult => ({
    outcome: "success",
    summary,
    keyFindings: [],
  });

  it("exposes input vars at top-level and under `vars`", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "f",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go" }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
      inputVarsJson: JSON.stringify({ ticket_id: "T-42", "ticket-id": "T-42" }),
    });

    const ctx = _buildStepTemplateContext(db, run.id, [], {});
    expect(ctx.ticket_id).toBe("T-42");
    expect((ctx.vars as Record<string, unknown>).ticket_id).toBe("T-42");
    expect(ctx["ticket-id"]).toBe("T-42");
  });

  it("returns empty vars when input_vars_json is null", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "f",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go" }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    const ctx = _buildStepTemplateContext(db, run.id, [], {});
    expect(ctx.vars).toEqual({});
  });

  it("exposes dep sitreps at top-level by stepId and under `steps`", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "f",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go" }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
    });

    const deps = [
      { stepId: "step-investigate", sitrep: makeSitrep("found root cause") },
      { stepId: "step-fix", sitrep: makeSitrep("patch applied") },
    ];
    const ctx = _buildStepTemplateContext(db, run.id, deps, {});

    expect((ctx["step-investigate"] as SitrepResult).summary).toBe("found root cause");
    expect((ctx["step-fix"] as SitrepResult).summary).toBe("patch applied");
    const steps = ctx.steps as Record<string, SitrepResult>;
    expect(steps["step-investigate"]?.summary).toBe("found root cause");
  });

  it("preserves provider context (e.g. trigger.*) alongside vars/steps", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "f",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go" }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
      inputVarsJson: JSON.stringify({ ticket_id: "T-1" }),
    });

    const providerContext = { trigger: { event: "cron" } };
    const ctx = _buildStepTemplateContext(db, run.id, [], providerContext);
    expect(ctx.trigger).toEqual({ event: "cron" });
    expect(ctx.ticket_id).toBe("T-1");
  });

  it("survives malformed input_vars_json (logs warn, returns {})", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "inst-1",
      name: "f",
      stepsJson: JSON.stringify([{ id: "root", agentId: "a1", prompt: "go" }]),
    });
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "inst-1",
      triggerType: "manual",
      inputVarsJson: "{not json",
    });

    const ctx = _buildStepTemplateContext(db, run.id, [], {});
    expect(ctx.vars).toEqual({});
  });
});
