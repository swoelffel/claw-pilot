// src/dashboard/routes/__tests__/webhooks.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createHmac } from "node:crypto";
import { initDatabase } from "../../../db/schema.js";
import {
  createFlowTrigger,
  listTriggerRuns,
} from "../../../core/repositories/flow-trigger-repository.js";
import { createFlowDefinition } from "../../../core/repositories/flow-repository.js";
import { registerWebhookRoutes } from "../webhooks.js";
import type { RouteDeps } from "../../route-deps.js";
import {
  ENV_PROVIDER_BRAND,
  registerSecretProvider,
  resetSecretProvider,
  type SecretProvider,
} from "../../../core/secrets/index.js";
import {
  DEFAULT_SINK_BRAND,
  flushAudit,
  registerAuditSink,
  resetAuditBus,
  type AuditSink,
} from "../../../core/audit/emitter.js";
import type { AuditEventEnvelope } from "../../../core/audit/events.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let app: Hono;
// Typed as `any` to keep `vi.fn().mock.calls` ergonomic; the actual signature
// matches `WebhookRuntimeStarter` at the registration site below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let starter: any;
let auditEvents: AuditEventEnvelope[];

const SECRET = "shared-secret-very-long-1234567890";
const SECRET_REF = "WH_SECRET_TEST";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function makeStubSecretProvider(): SecretProvider {
  const map = new Map<string, string>([[SECRET_REF, SECRET]]);
  const p: SecretProvider = {
    kind: "stub",
    has: async (n) => map.has(n),
    get: async (n) => {
      const v = map.get(n);
      if (v === undefined) throw new Error("missing secret");
      return v;
    },
  };
  (p as unknown as Record<symbol, unknown>)[ENV_PROVIDER_BRAND] = true;
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-webhook-"));
  db = initDatabase(path.join(tmpDir, "test.db"));

  resetSecretProvider();
  process.env.NODE_ENV = "test";
  registerSecretProvider(makeStubSecretProvider());

  resetAuditBus();
  auditEvents = [];
  const sink: AuditSink = {
    kind: "memory",
    write: async (e) => {
      auditEvents.push(e);
    },
  };
  (sink as unknown as Record<symbol, unknown>)[DEFAULT_SINK_BRAND] = true;
  registerAuditSink(sink);

  app = new Hono();
  // Default: caller can override per test if needed.
  starter = vi.fn(async () => 0);

  const deps = {
    db,
    monitor: {
      setTransitioning: () => {},
      clearTransitioning: () => {},
    },
  } as unknown as RouteDeps;

  registerWebhookRoutes(app, deps, { runtimeStarter: starter });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetAuditBus();
  resetSecretProvider();
});

function makeFlow(slug = "demo"): number {
  const f = createFlowDefinition(db, {
    instanceSlug: slug,
    name: "f-" + Math.random().toString(36).slice(2, 8),
    stepsJson: JSON.stringify([{ id: "a", agentId: "p", prompt: "x" }]),
  });
  return f.id;
}

/** Insert a real flow_runs row to satisfy the trigger_runs FK. */
function makeFlowRun(flowId: number): number {
  const r = db
    .prepare(
      `INSERT INTO rt_flow_runs (flow_id, instance_slug, status) VALUES (?, 'demo', 'pending')`,
    )
    .run(flowId);
  return Number(r.lastInsertRowid);
}

function makeWebhookTrigger(slug: string, opts: { allowConcurrent?: boolean } = {}) {
  const flowId = makeFlow();
  return createFlowTrigger(db, {
    instanceSlug: "demo",
    flowId,
    kind: "webhook",
    name: "test",
    webhookSlug: slug,
    webhookSecretRef: SECRET_REF,
    ...(opts.allowConcurrent !== undefined ? { allowConcurrent: opts.allowConcurrent } : {}),
  });
}

async function post(
  slug: string,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhooks/triggers/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

describe("POST /webhooks/triggers/:slug", () => {
  it("returns 404 when slug does not exist", async () => {
    const res = await post("nope", "{}", { "x-clawpilot-signature": sign("{}") });
    expect(res.status).toBe(404);
  });

  it("returns 401 on missing signature and audits failure", async () => {
    makeWebhookTrigger("hook1");
    const res = await post("hook1", "{}", {});
    expect(res.status).toBe(401);
    await flushAudit();
    expect(auditEvents.some((e) => e.kind === "trigger.failed")).toBe(true);
  });

  it("returns 401 on bad HMAC", async () => {
    makeWebhookTrigger("hook2");
    const res = await post("hook2", '{"x":1}', {
      "x-clawpilot-signature": "sha256=" + "0".repeat(64),
    });
    expect(res.status).toBe(401);
    await flushAudit();
    expect(auditEvents.some((e) => e.kind === "trigger.failed")).toBe(true);
  });

  it("happy path: 202 + flowRunId + trigger.fired audit", async () => {
    const trig = makeWebhookTrigger("hook3");
    const flowRunId = makeFlowRun(trig.flow_id);
    starter.mockResolvedValue(flowRunId);
    const body = '{"hello":"world"}';
    const res = await post("hook3", body, { "x-clawpilot-signature": sign(body) });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { runId: number; flowRunId: number };
    expect(json.flowRunId).toBe(flowRunId);
    expect(starter).toHaveBeenCalledOnce();
    const calls = starter.mock.calls[0]!;
    expect(calls[0]).toBe("demo");
    expect(calls[1]).toBe(trig.flow_id);
    const runs = listTriggerRuns(db, trig.id);
    expect(runs[0]!.status).toBe("succeeded");
    await flushAudit();
    expect(auditEvents.some((e) => e.kind === "trigger.fired")).toBe(true);
  });

  it("dedupes by Idempotency-Key", async () => {
    const trig = makeWebhookTrigger("hook4");
    starter.mockResolvedValue(makeFlowRun(trig.flow_id));
    const body = '{"a":1}';
    const headers = {
      "x-clawpilot-signature": sign(body),
      "idempotency-key": "abc-123",
    };
    const res1 = await post("hook4", body, headers);
    expect(res1.status).toBe(202);
    const res2 = await post("hook4", body, headers);
    expect(res2.status).toBe(200);
    const j2 = (await res2.json()) as { deduped: boolean };
    expect(j2.deduped).toBe(true);

    await flushAudit();
    expect(
      auditEvents.some(
        (e) =>
          e.kind === "trigger.deduped" && (e as { method: string }).method === "idempotency_key",
      ),
    ).toBe(true);

    // Only one starter call (the first one); the second was deduped.
    expect(starter).toHaveBeenCalledOnce();
    const runs = listTriggerRuns(db, trig.id);
    expect(runs.some((r) => r.status === "deduped")).toBe(true);
  });

  it("dedupes by payload hash within window when no Idempotency-Key", async () => {
    const trig = makeWebhookTrigger("hook5");
    starter.mockResolvedValue(makeFlowRun(trig.flow_id));
    const body = '{"x":2}';
    const headers = { "x-clawpilot-signature": sign(body) };
    const r1 = await post("hook5", body, headers);
    expect(r1.status).toBe(202);
    const r2 = await post("hook5", body, headers);
    expect(r2.status).toBe(200);
    const j = (await r2.json()) as { deduped: boolean };
    expect(j.deduped).toBe(true);
  });

  it("returns 503 when trigger is disabled", async () => {
    const trig = makeWebhookTrigger("hook6");
    db.prepare("UPDATE rt_flow_triggers SET enabled = 0 WHERE id = ?").run(trig.id);
    const body = "{}";
    const res = await post("hook6", body, { "x-clawpilot-signature": sign(body) });
    expect(res.status).toBe(503);
  });

  it("rejects when not allow_concurrent and a run is active", async () => {
    const trig = makeWebhookTrigger("hook7");
    db.prepare("INSERT INTO rt_flow_trigger_runs (trigger_id, status) VALUES (?, 'running')").run(
      trig.id,
    );
    const body = '{"y":3}';
    const res = await post("hook7", body, { "x-clawpilot-signature": sign(body) });
    expect(res.status).toBe(202);
    const j = (await res.json()) as { skipped?: boolean };
    expect(j.skipped).toBe(true);
    expect(starter).not.toHaveBeenCalled();
  });
});
