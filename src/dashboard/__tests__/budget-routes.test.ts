// src/dashboard/__tests__/budget-routes.test.ts
//
// Integration tests for the budget API routes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerBudgetRoutes } from "../routes/instances/budgets.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { injectAdminUser } from "./_helpers/inject-admin-user.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-budget-token-64chars-hex-0123456789abcdef0123456789abcdef0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-budget-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });
  app.use("/api/*", injectAdminUser());

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
  };

  app.use("/api/instances/:slug/*", instanceMiddleware(registry));
  registerBudgetRoutes(app, deps);

  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "demo",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-demo",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/budgets", () => {
  it("returns empty array when no budgets exist", async () => {
    const res = await app.request("/api/instances/demo/budgets", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data).toEqual([]);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/nope/budgets", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/instances/:slug/budgets", () => {
  it("creates an instance budget", async () => {
    const res = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance", limitUsd: 50 }),
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.id).toBeGreaterThan(0);
    expect(data.scope).toBe("instance");
    expect(data.limitUsd).toBe(50);
    expect(data.spentUsd).toBe(0);
    expect(data.softAlertPct).toBe(0.8);
    expect(data.enabled).toBe(true);
  });

  it("creates an agent budget", async () => {
    const res = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "agent", scopeId: "pilot", limitUsd: 20, period: "lifetime" }),
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.scopeId).toBe("pilot");
    expect(data.period).toBe("lifetime");
  });

  it("rejects missing limitUsd", async () => {
    const res = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects agent scope without scopeId", async () => {
    const res = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "agent", limitUsd: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate", async () => {
    const body = JSON.stringify({ scope: "agent", scopeId: "pilot", limitUsd: 10 });
    const headers = { ...authHeaders(), "Content-Type": "application/json" };
    await app.request("/api/instances/demo/budgets", { method: "POST", headers, body });
    const res = await app.request("/api/instances/demo/budgets", { method: "POST", headers, body });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/instances/:slug/budgets/:id", () => {
  it("updates budget fields", async () => {
    // Create
    const createRes = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance", limitUsd: 50 }),
    });
    const { id } = await json(createRes);

    // Update
    const res = await app.request(`/api/instances/demo/budgets/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ limitUsd: 75, softAlertPct: 0.9 }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.limitUsd).toBe(75);
    expect(data.softAlertPct).toBe(0.9);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/api/instances/demo/budgets/9999", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ limitUsd: 100 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/instances/:slug/budgets/:id", () => {
  it("deletes budget", async () => {
    const createRes = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance", limitUsd: 50 }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/budgets/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);

    // Verify it's gone
    const listRes = await app.request("/api/instances/demo/budgets", { headers: authHeaders() });
    const list = await json(listRes);
    expect(list).toEqual([]);
  });
});

describe("POST /api/instances/:slug/budgets/:id/override", () => {
  it("increases limit by override_pct", async () => {
    const createRes = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance", limitUsd: 50, overridePct: 0.2 }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/budgets/${id}/override`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.limitUsd).toBeCloseTo(60, 4); // 50 * 1.2
  });
});

describe("GET /api/instances/:slug/budgets/:id/events", () => {
  it("returns events after override", async () => {
    const createRes = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance", limitUsd: 50 }),
    });
    const { id } = await json(createRes);

    // Trigger override to create an event
    await app.request(`/api/instances/demo/budgets/${id}/override`, {
      method: "POST",
      headers: authHeaders(),
    });

    const res = await app.request(`/api/instances/demo/budgets/${id}/events`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const events = await json(res);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("override");
  });
});

describe("GET /api/instances/:slug/budgets/events", () => {
  it("returns all events across budgets", async () => {
    // Create two budgets
    const h = { ...authHeaders(), "Content-Type": "application/json" };
    const r1 = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ scope: "instance", limitUsd: 50 }),
    });
    const { id: id1 } = await json(r1);

    const r2 = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ scope: "agent", scopeId: "pilot", limitUsd: 20 }),
    });
    const { id: id2 } = await json(r2);

    // Override both
    await app.request(`/api/instances/demo/budgets/${id1}/override`, {
      method: "POST",
      headers: authHeaders(),
    });
    await app.request(`/api/instances/demo/budgets/${id2}/override`, {
      method: "POST",
      headers: authHeaders(),
    });

    const res = await app.request("/api/instances/demo/budgets/events", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const events = await json(res);
    expect(events).toHaveLength(2);
  });
});

describe("POST /api/instances/:slug/budgets/:id/reconcile", () => {
  it("reconciles with no drift when no messages", async () => {
    const createRes = await app.request("/api/instances/demo/budgets", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "instance", limitUsd: 50 }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/budgets/${id}/reconcile`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.corrected).toBe(false);
    expect(data.drift).toBe(0);
  });
});
