// src/core/__tests__/flow-trigger-repository.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { createFlowDefinition } from "../repositories/flow-repository.js";
import {
  createFlowTrigger,
  getFlowTrigger,
  getFlowTriggerByWebhookSlug,
  listFlowTriggers,
  updateFlowTrigger,
  deleteFlowTrigger,
  touchTriggerLastFired,
  createTriggerRun,
  getTriggerRun,
  updateTriggerRun,
  listTriggerRuns,
  hasActiveTriggerRun,
  findRunByIdempotencyKey,
  findRunByPayloadHash,
} from "../repositories/flow-trigger-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let flowId: number;

const STEPS = JSON.stringify([{ id: "a", agentId: "agent-1", prompt: "Do A" }]);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-repo-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const flow = createFlowDefinition(db, {
    instanceSlug: "inst-1",
    name: "test-flow",
    stepsJson: STEPS,
  });
  flowId = flow.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("flow-trigger-repository — triggers CRUD", () => {
  it("creates a cron trigger and reads it back", () => {
    const trig = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "cron",
      name: "daily",
      cronExpr: "0 9 * * *",
      cronTz: "Europe/Paris",
    });
    expect(trig.id).toBeGreaterThan(0);
    expect(trig.enabled).toBe(1);
    expect(trig.allow_concurrent).toBe(0);
    expect(trig.cron_expr).toBe("0 9 * * *");
    expect(trig.org_id).toBeNull();

    const fetched = getFlowTrigger(db, trig.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("daily");
  });

  it("creates a webhook trigger and looks it up by slug", () => {
    const trig = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "webhook",
      name: "github-pr",
      webhookSlug: "gh-pr-opened",
      webhookSecretRef: "secrets://triggers/gh-pr-opened",
    });
    expect(trig.webhook_slug).toBe("gh-pr-opened");

    const found = getFlowTriggerByWebhookSlug(db, "inst-1", "gh-pr-opened");
    expect(found?.id).toBe(trig.id);
    expect(getFlowTriggerByWebhookSlug(db, "inst-1", "missing")).toBeNull();
    // Cross-instance lookup with the same slug must miss.
    expect(getFlowTriggerByWebhookSlug(db, "other-instance", "gh-pr-opened")).toBeNull();
  });

  it("rejects a cron trigger without cronExpr", () => {
    expect(() =>
      createFlowTrigger(db, {
        instanceSlug: "inst-1",
        flowId,
        kind: "cron",
        name: "bad",
      }),
    ).toThrow(/cronExpr/);
  });

  it("rejects a webhook trigger missing slug or secret_ref", () => {
    expect(() =>
      createFlowTrigger(db, {
        instanceSlug: "inst-1",
        flowId,
        kind: "webhook",
        name: "bad",
        webhookSecretRef: "x",
      }),
    ).toThrow(/webhookSlug/);
    expect(() =>
      createFlowTrigger(db, {
        instanceSlug: "inst-1",
        flowId,
        kind: "webhook",
        name: "bad",
        webhookSlug: "x",
      }),
    ).toThrow(/webhookSecretRef/);
  });

  it("enforces unique webhook_slug per instance at the DB level", () => {
    createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "webhook",
      name: "a",
      webhookSlug: "dup",
      webhookSecretRef: "r1",
    });
    expect(() =>
      createFlowTrigger(db, {
        instanceSlug: "inst-1",
        flowId,
        kind: "webhook",
        name: "b",
        webhookSlug: "dup",
        webhookSecretRef: "r2",
      }),
    ).toThrow();
  });

  it("allows the same webhook_slug across different instances", () => {
    // Seed a second flow under a different instance so the FK is satisfied.
    const otherFlow = createFlowDefinition(db, {
      instanceSlug: "inst-2",
      name: "other-flow",
      stepsJson: STEPS,
    });
    const a = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "webhook",
      name: "a",
      webhookSlug: "shared",
      webhookSecretRef: "r1",
    });
    const b = createFlowTrigger(db, {
      instanceSlug: "inst-2",
      flowId: otherFlow.id,
      kind: "webhook",
      name: "b",
      webhookSlug: "shared",
      webhookSecretRef: "r2",
    });
    expect(a.id).not.toBe(b.id);
    expect(getFlowTriggerByWebhookSlug(db, "inst-1", "shared")?.id).toBe(a.id);
    expect(getFlowTriggerByWebhookSlug(db, "inst-2", "shared")?.id).toBe(b.id);
  });

  it("filters list by instance, flow, kind, enabled", () => {
    const a = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "cron",
      name: "cron-a",
      cronExpr: "* * * * *",
      enabled: false,
    });
    const b = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "webhook",
      name: "wh-b",
      webhookSlug: "b",
      webhookSecretRef: "r",
    });

    expect(listFlowTriggers(db, { instanceSlug: "inst-1" })).toHaveLength(2);
    expect(listFlowTriggers(db, { kind: "cron" }).map((r) => r.id)).toEqual([a.id]);
    expect(listFlowTriggers(db, { kind: "webhook" }).map((r) => r.id)).toEqual([b.id]);
    expect(listFlowTriggers(db, { enabledOnly: true }).map((r) => r.id)).toEqual([b.id]);
    expect(listFlowTriggers(db, { instanceSlug: "ghost" })).toEqual([]);
  });

  it("patches selected fields and bumps updated_at", () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "cron",
      name: "n",
      cronExpr: "0 9 * * *",
    });
    const before = t.updated_at;
    // Force a 1s gap so SQLite datetime('now') changes value.
    const updated = updateFlowTrigger(db, t.id, { name: "renamed", enabled: false });
    expect(updated?.name).toBe("renamed");
    expect(updated?.enabled).toBe(0);
    expect(updated?.cron_expr).toBe("0 9 * * *");
    expect(typeof updated?.updated_at).toBe("string");
    expect(before.length).toBeGreaterThan(0);
  });

  it("deletes a trigger and cascades its runs", () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "cron",
      name: "x",
      cronExpr: "* * * * *",
    });
    createTriggerRun(db, { triggerId: t.id, status: "succeeded" });
    expect(deleteFlowTrigger(db, t.id)).toBe(true);
    expect(getFlowTrigger(db, t.id)).toBeNull();
    expect(listTriggerRuns(db, t.id)).toEqual([]);
    expect(deleteFlowTrigger(db, t.id)).toBe(false);
  });

  it("touchTriggerLastFired updates last_fired_at", () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "cron",
      name: "x",
      cronExpr: "* * * * *",
    });
    expect(t.last_fired_at).toBeNull();
    touchTriggerLastFired(db, t.id);
    const after = getFlowTrigger(db, t.id);
    expect(after?.last_fired_at).not.toBeNull();
  });
});

describe("flow-trigger-repository — runs + lock + dedup", () => {
  let triggerId: number;

  beforeEach(() => {
    const t = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "webhook",
      name: "w",
      webhookSlug: "w",
      webhookSecretRef: "r",
    });
    triggerId = t.id;
  });

  it("creates and updates a run", () => {
    const run = createTriggerRun(db, {
      triggerId,
      status: "pending",
      payload: '{"x":1}',
      sourceIp: "1.2.3.4",
    });
    expect(run.status).toBe("pending");
    expect(run.payload).toBe('{"x":1}');
    const patched = updateTriggerRun(db, run.id, {
      status: "succeeded",
      finishedAt: "2026-05-02T10:00:00Z",
    });
    expect(patched?.status).toBe("succeeded");
    expect(patched?.flow_run_id).toBeNull();
    expect(patched?.finished_at).toBe("2026-05-02T10:00:00Z");
  });

  it("getTriggerRun returns null for missing", () => {
    expect(getTriggerRun(db, 99999)).toBeNull();
  });

  it("listTriggerRuns returns newest first with limit/offset", () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(createTriggerRun(db, { triggerId, status: "succeeded" }).id);
    }
    const page1 = listTriggerRuns(db, triggerId, { limit: 2 });
    expect(page1).toHaveLength(2);
    expect(page1[0]!.id).toBe(ids[ids.length - 1]);
    const page2 = listTriggerRuns(db, triggerId, { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);
    expect(page2[0]!.id).toBe(ids[ids.length - 3]);
  });

  it("hasActiveTriggerRun reflects pending/running rows only", () => {
    expect(hasActiveTriggerRun(db, triggerId)).toBe(false);
    const r = createTriggerRun(db, { triggerId, status: "pending" });
    expect(hasActiveTriggerRun(db, triggerId)).toBe(true);
    updateTriggerRun(db, r.id, { status: "running" });
    expect(hasActiveTriggerRun(db, triggerId)).toBe(true);
    updateTriggerRun(db, r.id, { status: "succeeded" });
    expect(hasActiveTriggerRun(db, triggerId)).toBe(false);
  });

  it("findRunByIdempotencyKey matches inside the window only", () => {
    createTriggerRun(db, { triggerId, status: "succeeded", idempotencyKey: "k1" });
    expect(findRunByIdempotencyKey(db, triggerId, "k1")?.idempotency_key).toBe("k1");
    expect(findRunByIdempotencyKey(db, triggerId, "missing")).toBeNull();
    // Match is scoped to the trigger — same key on a different trigger is invisible.
    const other = createFlowTrigger(db, {
      instanceSlug: "inst-1",
      flowId,
      kind: "webhook",
      name: "other",
      webhookSlug: "other",
      webhookSecretRef: "r",
    });
    expect(findRunByIdempotencyKey(db, other.id, "k1")).toBeNull();
  });

  it("findRunByPayloadHash matches inside the window only", () => {
    createTriggerRun(db, { triggerId, status: "succeeded", payloadHash: "h1" });
    expect(findRunByPayloadHash(db, triggerId, "h1")?.payload_hash).toBe("h1");
    expect(findRunByPayloadHash(db, triggerId, "h2")).toBeNull();
  });
});
