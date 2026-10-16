import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import {
  recoverInterruptedTriggerFlows,
  createFlowDefinition,
  getFlowRun,
  updateFlowRunStatus,
} from "../../../core/repositories/flow-repository.js";
import {
  createFlowTrigger,
  createTriggerRun,
  getTriggerRun,
  hasActiveTriggerRun,
} from "../../../core/repositories/flow-trigger-repository.js";
import { _resetFlowContextProvidersForTests } from "../../flow/context-providers.js";
import type { FlowEngineContext } from "../../flow/types.js";
import { Registry } from "../../../core/registry.js";

const captured = vi.hoisted(() => ({ briefing: "", release: () => {} }));
vi.mock("../../channel/router.js", () => ({
  ChannelRouter: {
    route: async (input: { message: { text: string }; sessionId: string }) => {
      captured.briefing = input.message.text;
      await new Promise<void>((resolve) => {
        captured.release = resolve;
      });
      return {
        response: { text: "OUTCOME: success\nSUMMARY: done\nKEY FINDINGS:\n- verified" },
        sessionId: input.sessionId,
        tokens: { input: 1, output: 1 },
        costUsd: 0,
      };
    },
  },
}));
const { startFlowRun } = await import("../../flow/engine.js");
let db: ReturnType<typeof initDatabase>;
beforeEach(() => {
  db = initDatabase(":memory:");
  _resetFlowContextProvidersForTests();
  captured.briefing = "";
});
afterEach(async () => {
  captured.release();
  await new Promise((resolve) => setTimeout(resolve, 15));
  db.close();
});

function fixture(
  stepsJson = JSON.stringify([
    {
      id: "first",
      agentId: "pilot",
      prompt: "Value {{trigger.payload.value}} mapped {{trigger.mapped.answer}}",
    },
  ]),
) {
  const registry = new Registry(db),
    server = registry.upsertLocalServer("test", "/tmp/test");
  registry.createInstance({
    serverId: server.id,
    slug: "demo",
    port: 18789,
    configPath: "/tmp/test",
    stateDir: "/tmp/test",
    systemdUnit: "test",
  });
  const flow = createFlowDefinition(db, { instanceSlug: "demo", name: "f", stepsJson });
  const trigger = createFlowTrigger(db, {
    instanceSlug: "demo",
    flowId: flow.id,
    kind: "webhook",
    name: "hook",
    webhookSlug: "hook",
    webhookSecretRef: "fixture",
    inputMapping: '[{"from":"$.value","to":"answer"}]',
  });
  const admission = createTriggerRun(db, {
    triggerId: trigger.id,
    status: "pending",
    payload: '{"value":42}',
  });
  const ctx = {
    db,
    registry,
    instanceSlug: "demo",
    config: { agents: [], models: [], defaultModel: "test" },
    workDir: undefined,
  } as unknown as FlowEngineContext;
  return { ctx, flow, trigger, admission };
}

describe("trigger to flow lifecycle", () => {
  it("links before the first briefing and holds the lock until real completion", async () => {
    const { ctx, flow, trigger, admission } = fixture();
    const runId = startFlowRun(ctx, flow.id, "webhook", "fixture", undefined, admission.id);
    await vi.waitFor(() => expect(captured.briefing).toContain("Value 42 mapped 42"));
    expect(getTriggerRun(db, admission.id)).toMatchObject({
      flow_run_id: runId,
      status: "running",
    });
    expect(hasActiveTriggerRun(db, trigger.id)).toBe(true);
    captured.release();
    await vi.waitFor(() => expect(getFlowRun(db, runId)?.status).toBe("completed"));
    expect(getTriggerRun(db, admission.id)?.status).toBe("succeeded");
    expect(hasActiveTriggerRun(db, trigger.id)).toBe(false);
  });
  it("returns the same flow run on repeated daemon admission", () => {
    const { ctx, flow, admission } = fixture("[]");
    const first = startFlowRun(ctx, flow.id, "webhook", "fixture", undefined, admission.id);
    const second = startFlowRun(ctx, flow.id, "webhook", "fixture", undefined, admission.id);
    expect(second).toBe(first);
    expect((db.prepare("SELECT count(*) AS n FROM rt_flow_runs").get() as { n: number }).n).toBe(1);
  });
  it("rejects a trigger admission targeting another flow", () => {
    const { ctx, admission } = fixture("[]");
    const other = createFlowDefinition(db, {
      instanceSlug: "demo",
      name: "other",
      stepsJson: "[]",
    });
    expect(() =>
      startFlowRun(ctx, other.id, "webhook", "fixture", undefined, admission.id),
    ).toThrow();
    expect((db.prepare("SELECT count(*) AS n FROM rt_flow_runs").get() as { n: number }).n).toBe(0);
  });
  it("releases a lock after the linked flow fails", () => {
    const { ctx, flow, trigger, admission } = fixture("[]");
    const runId = startFlowRun(ctx, flow.id, "webhook", "fixture", undefined, admission.id);
    db.prepare("UPDATE rt_flow_trigger_runs SET status = 'running' WHERE id = ?").run(admission.id);
    updateFlowRunStatus(db, runId, "failed", "failed after restart");
    expect(hasActiveTriggerRun(db, trigger.id)).toBe(false);
    expect(getTriggerRun(db, admission.id)?.status).toBe("failed");
  });
});

it("fails interrupted linked flows on daemon restart and releases their locks", () => {
  const { flow, trigger, admission } = fixture("[]");
  const result = db
    .prepare(
      "INSERT INTO rt_flow_runs (flow_id, instance_slug, status) VALUES (?, 'demo', 'running')",
    )
    .run(flow.id);
  db.prepare(
    "UPDATE rt_flow_trigger_runs SET flow_run_id = ?, status = 'running' WHERE id = ?",
  ).run(result.lastInsertRowid, admission.id);
  recoverInterruptedTriggerFlows(db, "unrelated-instance");
  expect(hasActiveTriggerRun(db, trigger.id)).toBe(true);
  recoverInterruptedTriggerFlows(db, "demo");
  expect(getFlowRun(db, Number(result.lastInsertRowid))?.status).toBe("failed");
  expect(getTriggerRun(db, admission.id)?.status).toBe("failed");
  expect(hasActiveTriggerRun(db, trigger.id)).toBe(false);
});
