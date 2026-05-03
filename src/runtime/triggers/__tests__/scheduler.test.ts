// src/runtime/triggers/__tests__/scheduler.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import {
  createFlowTrigger,
  getTriggerRun,
  hasActiveTriggerRun,
  listTriggerRuns,
  updateFlowTrigger,
} from "../../../core/repositories/flow-trigger-repository.js";
import { createFlowDefinition } from "../../../core/repositories/flow-repository.js";
import { TriggerScheduler, type CronFactory, type ScheduledJob } from "../scheduler.js";
import {
  resetAuditBus,
  registerAuditSink,
  DEFAULT_SINK_BRAND,
} from "../../../core/audit/emitter.js";
import type { AuditSink } from "../../../core/audit/emitter.js";
import type { AuditEventEnvelope } from "../../../core/audit/events.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let auditEvents: AuditEventEnvelope[];

const VALID_STEPS = JSON.stringify([{ id: "a", agentId: "pilot", prompt: "do" }]);

function makeCronFactory(): { factory: CronFactory; jobs: ScheduledJob[]; stops: number } {
  const jobs: ScheduledJob[] = [];
  let stops = 0;
  const factory: CronFactory = (_expr, _opts, _cb) => {
    const job: ScheduledJob = {
      stop: () => {
        stops++;
      },
    };
    jobs.push(job);
    return job;
  };
  return {
    factory,
    jobs,
    get stops() {
      return stops;
    },
  } as { factory: CronFactory; jobs: ScheduledJob[]; stops: number };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-trig-scheduler-"));
  db = initDatabase(path.join(tmpDir, "test.db"));

  // Audit sink to inspect emitted events.
  resetAuditBus();
  auditEvents = [];
  const sink: AuditSink = {
    kind: "memory",
    write: async (e) => {
      auditEvents.push(e);
    },
  };
  // Brand as default to bypass capability gate.
  (sink as unknown as Record<symbol, unknown>)[DEFAULT_SINK_BRAND] = true;
  registerAuditSink(sink);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetAuditBus();
});

function makeFlow(slug = "demo"): number {
  const flow = createFlowDefinition(db, {
    instanceSlug: slug,
    name: "f1",
    stepsJson: VALID_STEPS,
  });
  return flow.id;
}

/** Insert a real flow_runs row and return its id (so trigger run FK is valid). */
function makeFlowRun(flowId: number): number {
  const r = db
    .prepare(
      `INSERT INTO rt_flow_runs (flow_id, instance_slug, status) VALUES (?, 'demo', 'pending')`,
    )
    .run(flowId);
  return Number(r.lastInsertRowid);
}

describe("TriggerScheduler.fire", () => {
  it("fires a happy path: succeeds, links flow run, emits audit", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
    });
    const flowRunId = makeFlowRun(flowId);
    const starter = vi.fn(async () => flowRunId);
    const cron = makeCronFactory();
    const scheduler = new TriggerScheduler({
      db,
      runtimeStarter: starter,
      cronFactory: cron.factory,
    });

    await scheduler.fire(trig.id);

    expect(starter).toHaveBeenCalledWith("demo", flowId, "cron", `trigger:${trig.id}`);
    const runs = listTriggerRuns(db, trig.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.flow_run_id).toBe(flowRunId);

    // Flush audit buffer
    const { flushAudit } = await import("../../../core/audit/emitter.js");
    await flushAudit();
    expect(auditEvents.some((e) => e.kind === "trigger.fired")).toBe(true);
  });

  it("aborts fire with clear error when instance is not running", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "stopped-instance",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
    });

    const starter = vi.fn(async () => 1);
    const scheduler = new TriggerScheduler({
      db,
      runtimeStarter: starter,
      getInstanceState: () => "stopped",
    });

    await scheduler.fire(trig.id);

    expect(starter).not.toHaveBeenCalled();
    const runs = listTriggerRuns(db, trig.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).toContain("not running");
    expect(runs[0]!.error).toContain("stopped-instance");
  });

  it("fires when getInstanceState reports running", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
    });
    const flowRunId = makeFlowRun(flowId);
    const starter = vi.fn(async () => flowRunId);
    const scheduler = new TriggerScheduler({
      db,
      runtimeStarter: starter,
      getInstanceState: () => "running",
    });

    await scheduler.fire(trig.id);

    expect(starter).toHaveBeenCalledOnce();
    expect(listTriggerRuns(db, trig.id)[0]!.status).toBe("succeeded");
  });

  it("skips when concurrent run is active and lock holds", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
    });
    // Plant an active run.
    db.prepare(`INSERT INTO rt_flow_trigger_runs (trigger_id, status) VALUES (?, 'running')`).run(
      trig.id,
    );
    expect(hasActiveTriggerRun(db, trig.id)).toBe(true);

    const starter = vi.fn(async () => 999);
    const scheduler = new TriggerScheduler({ db, runtimeStarter: starter });
    await scheduler.fire(trig.id);

    expect(starter).not.toHaveBeenCalled();
    const runs = listTriggerRuns(db, trig.id);
    expect(runs.some((r) => r.status === "skipped_concurrent")).toBe(true);
  });

  it("allow_concurrent bypasses the lock", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
      allowConcurrent: true,
    });
    db.prepare(`INSERT INTO rt_flow_trigger_runs (trigger_id, status) VALUES (?, 'running')`).run(
      trig.id,
    );
    const flowRunId = makeFlowRun(flowId);
    const starter = vi.fn(async () => flowRunId);
    const scheduler = new TriggerScheduler({ db, runtimeStarter: starter });
    await scheduler.fire(trig.id);
    expect(starter).toHaveBeenCalledOnce();
  });

  it("disabled trigger is skipped silently", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
      enabled: false,
    });
    const starter = vi.fn(async () => 1);
    const scheduler = new TriggerScheduler({ db, runtimeStarter: starter });
    await scheduler.fire(trig.id);
    expect(starter).not.toHaveBeenCalled();
    expect(listTriggerRuns(db, trig.id)).toHaveLength(0);
  });

  it("records failure when starter throws", async () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
    });
    const starter = vi.fn(async () => {
      throw new Error("boom");
    });
    const scheduler = new TriggerScheduler({ db, runtimeStarter: starter });
    await scheduler.fire(trig.id);
    const runs = listTriggerRuns(db, trig.id);
    const last = runs[0]!;
    expect(last.status).toBe("failed");
    expect(last.error).toContain("boom");

    const { flushAudit } = await import("../../../core/audit/emitter.js");
    await flushAudit();
    expect(auditEvents.some((e) => e.kind === "trigger.failed")).toBe(true);
  });
});

describe("TriggerScheduler lifecycle", () => {
  it("schedules existing enabled cron triggers on start()", () => {
    const flowId = makeFlow();
    createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "a",
      cronExpr: "0 9 * * *",
    });
    createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "b",
      cronExpr: "0 10 * * *",
      enabled: false,
    });
    const cron = makeCronFactory();
    const scheduler = new TriggerScheduler({
      db,
      runtimeStarter: async () => 0,
      cronFactory: cron.factory,
    });
    scheduler.start();
    expect(cron.jobs).toHaveLength(1);
    expect(scheduler.size).toBe(1);
    scheduler.stop();
  });

  it("reload() re-schedules an updated trigger", () => {
    const flowId = makeFlow();
    const trig = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "a",
      cronExpr: "0 9 * * *",
      enabled: false,
    });
    const cron = makeCronFactory();
    const scheduler = new TriggerScheduler({
      db,
      runtimeStarter: async () => 0,
      cronFactory: cron.factory,
    });
    scheduler.start();
    expect(scheduler.size).toBe(0);

    updateFlowTrigger(db, trig.id, { enabled: true });
    scheduler.reload(trig.id);
    expect(scheduler.size).toBe(1);

    // Disable + reload removes it.
    updateFlowTrigger(db, trig.id, { enabled: false });
    scheduler.reload(trig.id);
    expect(scheduler.size).toBe(0);
  });
});

// Touch unused getTriggerRun to keep imports honest if added later.
void getTriggerRun;
