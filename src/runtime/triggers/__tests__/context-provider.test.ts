// src/runtime/triggers/__tests__/context-provider.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { createFlowDefinition } from "../../../core/repositories/flow-repository.js";
import {
  createFlowTrigger,
  createTriggerRun,
  updateTriggerRun,
} from "../../../core/repositories/flow-trigger-repository.js";
import { registerTriggerContextProvider } from "../context-provider.js";
import {
  collectFlowContext,
  _resetFlowContextProvidersForTests,
} from "../../flow/context-providers.js";
import type { FlowStepDef } from "../../flow/types.js";
import type { InstanceSlug, AgentId } from "../../types.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;

const baseStep: FlowStepDef = { id: "s1", agentId: "pilot", prompt: "do" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-trig-ctx-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  _resetFlowContextProvidersForTests();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildArgs(runId: number) {
  return {
    instanceSlug: "demo" as InstanceSlug,
    agentId: "pilot" as AgentId,
    flowName: "f1",
    step: baseStep,
    runId,
  };
}

function makeFlowRun(): number {
  // Create a flow definition first.
  const flow = createFlowDefinition(db, {
    instanceSlug: "demo",
    name: "f1",
    stepsJson: JSON.stringify([baseStep]),
  });
  // Insert a flow run row directly.
  const result = db
    .prepare(`INSERT INTO rt_flow_runs (flow_id, instance_slug, status) VALUES (?, ?, 'running')`)
    .run(flow.id, "demo");
  return Number(result.lastInsertRowid);
}

describe("registerTriggerContextProvider", () => {
  it("returns {} when no trigger run matches the runId", () => {
    registerTriggerContextProvider(db);
    const ctx = collectFlowContext(buildArgs(99999));
    expect(ctx.trigger).toEqual({});
  });

  it("exposes parsed payload + mapped vars when a trigger run matches", () => {
    const flowRunId = makeFlowRun();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId: 1,
      kind: "webhook",
      name: "wh",
      webhookSlug: "abc",
      webhookSecretRef: "WH_SECRET",
      inputMapping: JSON.stringify([
        { from: "$.action", to: "action" },
        { from: "$.pull_request.number", to: "pr" },
      ]),
    });
    const payload = JSON.stringify({ action: "opened", pull_request: { number: 42 } });
    const run = createTriggerRun(db, {
      triggerId: trig.id,
      status: "running",
      payload,
    });
    updateTriggerRun(db, run.id, { flowRunId });

    registerTriggerContextProvider(db);
    const ctx = collectFlowContext(buildArgs(flowRunId));
    expect(ctx.trigger).toMatchObject({
      kind: "webhook",
      payload: { action: "opened", pull_request: { number: 42 } },
      mapped: { action: "opened", pr: 42 },
    });
  });

  it("returns raw string payload when JSON parse fails", () => {
    const flowRunId = makeFlowRun();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId: 1,
      kind: "cron",
      name: "c",
      cronExpr: "0 9 * * *",
    });
    const run = createTriggerRun(db, {
      triggerId: trig.id,
      status: "running",
      payload: "not json",
    });
    updateTriggerRun(db, run.id, { flowRunId });

    registerTriggerContextProvider(db);
    const ctx = collectFlowContext(buildArgs(flowRunId));
    expect((ctx.trigger as { payload: unknown }).payload).toBe("not json");
  });
});
