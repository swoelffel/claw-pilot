// src/dashboard/routes/__tests__/triggers-routes.test.ts
//
// Integration tests for the trigger CRUD routes (TRIGGER-001 — PR 3/3).
//
// Uses a real in-memory SQLite via initDatabase + a real Hono app + a stubbed
// secret provider and a fake TriggerScheduler. Mirrors the harness pattern of
// agent-blueprint-routes.test.ts and webhooks.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { Registry } from "../../../core/registry.js";
import { MockConnection } from "../../../core/__tests__/mock-connection.js";
import { TokenCache } from "../../token-cache.js";
import { SessionStore } from "../../session-store.js";
import { apiError } from "../../route-deps.js";
import type { RouteDeps } from "../../route-deps.js";
import { TEST_ADMIN } from "../../__tests__/_helpers/inject-admin-user.js";
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
import { createFlowDefinition } from "../../../core/repositories/flow-repository.js";
import { createFlowTrigger } from "../../../core/repositories/flow-trigger-repository.js";
import type { TriggerScheduler } from "../../../runtime/triggers/scheduler.js";
import { registerTriggerRoutes } from "../triggers.js";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function jsonOf(res: Response): Promise<Json> {
  return res.json();
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Stub secret provider (in-memory map; supports set/get)
// ---------------------------------------------------------------------------

function makeStubSecretProvider(): {
  provider: SecretProvider;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const provider: SecretProvider = {
    kind: "stub",
    has: async (n) => store.has(n) && (store.get(n) ?? "") !== "",
    get: async (n) => {
      const v = store.get(n);
      if (v === undefined) throw new Error(`missing secret: ${n}`);
      return v;
    },
    set: async (n, v) => {
      store.set(n, v);
    },
  };
  (provider as unknown as Record<symbol, unknown>)[ENV_PROVIDER_BRAND] = true;
  return { provider, store };
}

// ---------------------------------------------------------------------------
// Stub scheduler — records reload/fire calls
// ---------------------------------------------------------------------------

function makeStubScheduler(): {
  scheduler: TriggerScheduler;
  reloadCalls: number[];
  fireCalls: number[];
} {
  const reloadCalls: number[] = [];
  const fireCalls: number[] = [];
  const scheduler = {
    start: () => {},
    stop: () => {},
    reload: (id: number) => {
      reloadCalls.push(id);
    },
    fire: async (id: number) => {
      fireCalls.push(id);
    },
    get size() {
      return 0;
    },
  } as unknown as TriggerScheduler;
  return { scheduler, reloadCalls, fireCalls };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let tmpDir: string;
let secretStore: Map<string, string>;
let auditEvents: AuditEventEnvelope[];
let scheduler: TriggerScheduler;
let reloadCalls: number[];
let fireCalls: number[];
let flowId: number;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-trigger-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  // Reset secret + audit singletons.
  resetSecretProvider();
  process.env.NODE_ENV = "test";
  const { provider, store } = makeStubSecretProvider();
  secretStore = store;
  registerSecretProvider(provider);

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

  // Stubbed scheduler.
  const stub = makeStubScheduler();
  scheduler = stub.scheduler;
  reloadCalls = stub.reloadCalls;
  fireCalls = stub.fireCalls;

  // Seed an instance and a flow definition the triggers will reference.
  // The Instance row is not strictly required (triggers reference it by slug,
  // not via FK) — but we register it so listing-by-instanceSlug looks real.
  void registry; // keep registry creation side-effect (validates DB schema)
  const flow = createFlowDefinition(db, {
    instanceSlug: "demo",
    name: "demo-flow",
    stepsJson: "[]",
  });
  flowId = flow.id;

  app = new Hono();
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    c.set("user", { ...TEST_ADMIN });
    await next();
  });

  const deps: RouteDeps = {
    registry,
    conn,
    db,
    startedAt: Date.now(),
    health: {} as unknown as RouteDeps["health"],
    lifecycle: {} as unknown as RouteDeps["lifecycle"],
    monitor: {
      setTransitioning: () => {},
      clearTransitioning: () => {},
    } as unknown as RouteDeps["monitor"],
    selfUpdateChecker: {} as unknown as RouteDeps["selfUpdateChecker"],
    selfUpdater: {} as unknown as RouteDeps["selfUpdater"],
    tokenCache,
    xdgRuntimeDir: "/run/user/1000",
    sessionStore: new SessionStore(db),
    modelDiscovery: {
      invalidateProvider: () => {},
      getProviders: () => [],
      getModelCatalog: () => [],
      findModel: () => undefined,
      start: () => {},
      stop: () => {},
    } as unknown as RouteDeps["modelDiscovery"],
    triggerScheduler: scheduler,
  };

  registerTriggerRoutes(app, deps);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetSecretProvider();
  resetAuditBus();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("Auth", () => {
  it("returns 401 without token", async () => {
    const res = await app.request(new Request("http://localhost/api/triggers"));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/triggers
// ---------------------------------------------------------------------------

describe("GET /api/triggers", () => {
  it("returns empty list initially", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers", { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual([]);
  });

  it("filters by instanceSlug, kind, enabled", async () => {
    createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t1",
      cronExpr: "0 9 * * *",
    });
    createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "webhook",
      name: "t2",
      webhookSlug: "wh-one",
      webhookSecretRef: "TRIGGER_WEBHOOK_SECRET:wh-one",
      enabled: false,
    });

    const all = await app.request(
      new Request("http://localhost/api/triggers?instanceSlug=demo", { headers: authHeaders() }),
    );
    expect((await jsonOf(all)).length).toBe(2);

    const cron = await app.request(
      new Request("http://localhost/api/triggers?kind=cron", { headers: authHeaders() }),
    );
    expect((await jsonOf(cron)).map((r: Json) => r.name)).toEqual(["t1"]);

    const enabled = await app.request(
      new Request("http://localhost/api/triggers?enabled=true", { headers: authHeaders() }),
    );
    expect((await jsonOf(enabled)).map((r: Json) => r.name)).toEqual(["t1"]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/triggers
// ---------------------------------------------------------------------------

describe("POST /api/triggers", () => {
  it("creates a cron trigger and reloads the scheduler", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "demo",
          flowId,
          name: "daily",
          kind: "cron",
          cronExpr: "0 9 * * *",
          cronTz: "Europe/Paris",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.id).toBeGreaterThan(0);
    expect(body.kind).toBe("cron");
    expect(body.cronExpr).toBe("0 9 * * *");
    expect(reloadCalls).toContain(body.id);
  });

  it("creates a webhook trigger and persists the secret", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "demo",
          flowId,
          name: "wh-1",
          kind: "webhook",
          webhookSlug: "github-pr",
          webhookSecret: "very-strong-shared-secret-256",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.webhookSecretRef).toBe("TRIGGER_WEBHOOK_SECRET:github-pr");
    expect(secretStore.get("TRIGGER_WEBHOOK_SECRET:github-pr")).toBe(
      "very-strong-shared-secret-256",
    );
  });

  it("rejects invalid cron expression", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "demo",
          flowId,
          name: "bad",
          kind: "cron",
          cronExpr: "not a cron",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("INVALID_CRON");
  });

  it("rejects invalid webhook slug", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "demo",
          flowId,
          name: "bad",
          kind: "webhook",
          webhookSlug: "AB",
          webhookSecret: "very-strong-shared-secret-256",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("INVALID_BODY");
  });
});

// ---------------------------------------------------------------------------
// GET /api/triggers/:id  — detail with last 10 runs
// ---------------------------------------------------------------------------

describe("GET /api/triggers/:id", () => {
  it("returns 404 on missing id", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers/9999", { headers: authHeaders() }),
    );
    expect(res.status).toBe(404);
  });

  it("returns the trigger plus its last 10 runs", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t",
      cronExpr: "0 9 * * *",
    });
    // seed 12 runs — only 10 should come back
    for (let i = 0; i < 12; i++) {
      db.prepare(
        "INSERT INTO rt_flow_trigger_runs (trigger_id, status, fired_at) VALUES (?, 'succeeded', datetime('now', '-' || ? || ' minutes'))",
      ).run(t.id, i);
    }
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}`, { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.id).toBe(t.id);
    expect(body.runs.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/triggers/:id
// ---------------------------------------------------------------------------

describe("PUT /api/triggers/:id", () => {
  it("updates fields and reloads the scheduler when cron changes", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t",
      cronExpr: "0 9 * * *",
    });
    reloadCalls.length = 0;
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "renamed", cronExpr: "*/5 * * * *", enabled: false }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.name).toBe("renamed");
    expect(body.cronExpr).toBe("*/5 * * * *");
    expect(body.enabled).toBe(false);
    expect(reloadCalls).toContain(t.id);
  });

  it("rejects an invalid cron on update", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t",
      cronExpr: "0 9 * * *",
    });
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ cronExpr: "garbage" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/triggers/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/triggers/:id", () => {
  it("returns 204 and clears the secret for webhook triggers", async () => {
    secretStore.set("TRIGGER_WEBHOOK_SECRET:wh-del", "secret-value");
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "webhook",
      name: "wh-del",
      webhookSlug: "wh-del",
      webhookSecretRef: "TRIGGER_WEBHOOK_SECRET:wh-del",
    });
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(204);
    expect(secretStore.get("TRIGGER_WEBHOOK_SECRET:wh-del")).toBe("");
    expect(reloadCalls).toContain(t.id);
  });

  it("returns 404 on missing id", async () => {
    const res = await app.request(
      new Request("http://localhost/api/triggers/9999", {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/triggers/:id/rotate-secret
// ---------------------------------------------------------------------------

describe("POST /api/triggers/:id/rotate-secret", () => {
  it("returns a fresh secret each call", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "webhook",
      name: "wh",
      webhookSlug: "wh-rot",
      webhookSecretRef: "TRIGGER_WEBHOOK_SECRET:wh-rot",
    });
    const r1 = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}/rotate-secret`, {
        method: "POST",
        headers: authHeaders(),
      }),
    );
    expect(r1.status).toBe(200);
    const b1 = await jsonOf(r1);
    expect(b1.secret).toMatch(/^[0-9a-f]{64}$/);

    const r2 = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}/rotate-secret`, {
        method: "POST",
        headers: authHeaders(),
      }),
    );
    const b2 = await jsonOf(r2);
    expect(b2.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(b2.secret).not.toBe(b1.secret);
    expect(secretStore.get("TRIGGER_WEBHOOK_SECRET:wh-rot")).toBe(b2.secret);
  });

  it("rejects rotation on cron triggers", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t",
      cronExpr: "0 9 * * *",
    });
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}/rotate-secret`, {
        method: "POST",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/triggers/:id/secret-reveal
// ---------------------------------------------------------------------------

describe("GET /api/triggers/:id/secret-reveal", () => {
  it("returns the plaintext secret and emits a secret.access audit event", async () => {
    secretStore.set("TRIGGER_WEBHOOK_SECRET:wh-rev", "actual-secret-value");
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "webhook",
      name: "wh",
      webhookSlug: "wh-rev",
      webhookSecretRef: "TRIGGER_WEBHOOK_SECRET:wh-rev",
    });
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}/secret-reveal`, {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.secret).toBe("actual-secret-value");
    // Audit emission is observable (flush async buffer).
    await flushAudit();
    expect(auditEvents.some((e) => e.kind === "secret.access")).toBe(true);
  });

  it("rate-limits at 3 reveals per IP per minute", async () => {
    secretStore.set("TRIGGER_WEBHOOK_SECRET:wh-rev2", "a-secret");
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "webhook",
      name: "wh",
      webhookSlug: "wh-rev2",
      webhookSecretRef: "TRIGGER_WEBHOOK_SECRET:wh-rev2",
    });
    const url = `http://localhost/api/triggers/${t.id}/secret-reveal`;
    for (let i = 0; i < 3; i++) {
      const ok = await app.request(new Request(url, { headers: authHeaders() }));
      expect(ok.status).toBe(200);
    }
    const limited = await app.request(new Request(url, { headers: authHeaders() }));
    expect(limited.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST /api/triggers/:id/fire
// ---------------------------------------------------------------------------

describe("POST /api/triggers/:id/fire", () => {
  it("returns 202 and asks the scheduler to fire", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t",
      cronExpr: "0 9 * * *",
    });
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}/fire`, {
        method: "POST",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(202);
    // fire is fire-and-forget; allow microtasks to drain
    await new Promise((r) => setImmediate(r));
    expect(fireCalls).toContain(t.id);
  });
});

// ---------------------------------------------------------------------------
// GET /api/triggers/:id/runs
// ---------------------------------------------------------------------------

describe("GET /api/triggers/:id/runs", () => {
  it("returns paginated runs", async () => {
    const t = createFlowTrigger(db, {
      instanceSlug: "demo",
      flowId,
      kind: "cron",
      name: "t",
      cronExpr: "0 9 * * *",
    });
    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO rt_flow_trigger_runs (trigger_id, status, fired_at) VALUES (?, 'succeeded', datetime('now', '-' || ? || ' minutes'))",
      ).run(t.id, i);
    }
    const res = await app.request(
      new Request(`http://localhost/api/triggers/${t.id}/runs?limit=2&offset=0`, {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.runs.length).toBe(2);
    expect(body.limit).toBe(2);
  });
});
