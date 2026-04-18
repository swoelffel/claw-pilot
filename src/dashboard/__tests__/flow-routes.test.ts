// src/dashboard/__tests__/flow-routes.test.ts
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
import { registerFlowRoutes } from "../routes/instances/flows.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";

const TEST_TOKEN = "test-flow-token-64chars-hex-0123456789abcdef0123456789abcdef012";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "application/json",
  };
}

const VALID_STEPS = [
  { id: "a", agentId: "pilot", prompt: "Do A", dependsOn: [] },
  { id: "b", agentId: "pilot", prompt: "Do B", dependsOn: ["a"] },
];

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-flow-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
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
      getModelsForProvider: () => [],
      start: () => {},
      stop: () => {},
    } as unknown as RouteDeps["modelDiscovery"],
  };

  app.use("/api/instances/:slug/*", instanceMiddleware(registry));
  registerFlowRoutes(app, deps);

  // Create test instance with a "pilot" agent
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "demo",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-demo",
  });
  const instance = registry.getInstance("demo")!;
  registry.createAgent(instance.id, {
    agentId: "pilot",
    name: "Pilot",
    model: "claude-sonnet-4-20250514",
    workspacePath: "/tmp/ws/pilot",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/flows", () => {
  it("creates a flow and returns 201", async () => {
    const res = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Test Flow",
        description: "A test",
        steps: VALID_STEPS,
      }),
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.flow.name).toBe("Test Flow");
    expect(body.flow.instance_slug).toBe("demo");
    expect(body.flow.enabled).toBe(1);
  });

  it("rejects empty steps", async () => {
    const res = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Bad", steps: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects cyclic dependencies", async () => {
    const res = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Cyclic",
        steps: [
          { id: "a", agentId: "pilot", prompt: "Do A", dependsOn: ["b"] },
          { id: "b", agentId: "pilot", prompt: "Do B", dependsOn: ["a"] },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_DAG");
  });

  it("rejects unknown agent in step", async () => {
    const res = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Bad Agent",
        steps: [{ id: "a", agentId: "nonexistent", prompt: "Do A", dependsOn: [] }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_AGENT");
  });

  it("rejects unknown dependency reference", async () => {
    const res = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Bad Dep",
        steps: [{ id: "a", agentId: "pilot", prompt: "Do A", dependsOn: ["z"] }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_DAG");
  });
});

describe("GET /api/instances/:slug/flows", () => {
  it("lists flows for an instance", async () => {
    // Create two flows
    await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Flow A", steps: VALID_STEPS }),
    });
    await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Flow B", steps: VALID_STEPS }),
    });

    const res = await app.request("/api/instances/demo/flows", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.flows).toHaveLength(2);
    expect(body.flows[0].lastRun).toBeNull();
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/nope/flows", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/instances/:slug/flows/:id", () => {
  it("returns flow detail with empty runs", async () => {
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Detail", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    const res = await app.request(`/api/instances/demo/flows/${flow.id}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.flow.name).toBe("Detail");
    expect(body.runs).toHaveLength(0);
  });
});

describe("GET /api/instances/:slug/flows/:id/runs", () => {
  it("returns runs with hasMore", async () => {
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "RunsFlow", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    // Create 2 runs directly in DB
    const { createFlowRun } = await import("../../core/repositories/flow-repository.js");
    createFlowRun(db, { flowId: flow.id, instanceSlug: "demo", triggerType: "manual" });
    createFlowRun(db, { flowId: flow.id, instanceSlug: "demo", triggerType: "manual" });

    // Fetch with limit=1 → should have hasMore=true
    const res1 = await app.request(`/api/instances/demo/flows/${flow.id}/runs?limit=1`, {
      headers: authHeaders(),
    });
    expect(res1.status).toBe(200);
    const body1 = await json(res1);
    expect(body1.runs).toHaveLength(1);
    expect(body1.hasMore).toBe(true);

    // Fetch with limit=10 → should have hasMore=false
    const res2 = await app.request(`/api/instances/demo/flows/${flow.id}/runs?limit=10`, {
      headers: authHeaders(),
    });
    const body2 = await json(res2);
    expect(body2.runs).toHaveLength(2);
    expect(body2.hasMore).toBe(false);
  });
});

describe("PATCH /api/instances/:slug/flows/:id", () => {
  it("updates flow name and description", async () => {
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Original", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    const res = await app.request(`/api/instances/demo/flows/${flow.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Renamed", description: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.flow.name).toBe("Renamed");
    expect(body.flow.description).toBe("Updated");
  });
});

describe("DELETE /api/instances/:slug/flows/:id", () => {
  it("deletes a flow", async () => {
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Doomed", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    const res = await app.request(`/api/instances/demo/flows/${flow.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const getRes = await app.request(`/api/instances/demo/flows/${flow.id}`, {
      headers: authHeaders(),
    });
    expect(getRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/flows/:id/sessions", () => {
  it("returns sessions linked to a flow", async () => {
    // 1. Create a flow
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "SessFlow", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    // 2. Create a run + step runs + sessions directly in DB
    const { createFlowRun, createStepRun, updateStepRun } =
      await import("../../core/repositories/flow-repository.js");
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "demo",
      triggerType: "manual",
    });
    db.prepare(
      "INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, label) VALUES (?, ?, ?, ?, ?)",
    ).run("sess-flow-1", "demo", "pilot", "web", "flow:SessFlow:step:a");
    const stepA = createStepRun(db, { runId: run.id, stepId: "a", agentId: "pilot" });
    updateStepRun(db, stepA.id, { sessionId: "sess-flow-1", status: "completed" });

    // 3. Fetch sessions endpoint
    const res = await app.request(`/api/instances/demo/flows/${flow.id}/sessions`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("sess-flow-1");
    expect(body.hasMore).toBe(false);
  });

  it("returns empty when flow has no sessions", async () => {
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "EmptyFlow", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    const res = await app.request(`/api/instances/demo/flows/${flow.id}/sessions`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(0);
  });

  it("returns 404 for unknown flow", async () => {
    const res = await app.request("/api/instances/demo/flows/99999/sessions", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("enriches flow list with sessionCount", async () => {
    // Create flow
    const createRes = await app.request("/api/instances/demo/flows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "CountFlow", steps: VALID_STEPS }),
    });
    const { flow } = await json(createRes);

    // Verify sessionCount is 0 before sessions
    const listRes1 = await app.request("/api/instances/demo/flows", { headers: authHeaders() });
    const body1 = await json(listRes1);
    const found1 = body1.flows.find((f: { id: number }) => f.id === flow.id);
    expect(found1.sessionCount).toBe(0);

    // Add session via run + step
    const { createFlowRun, createStepRun, updateStepRun } =
      await import("../../core/repositories/flow-repository.js");
    const run = createFlowRun(db, {
      flowId: flow.id,
      instanceSlug: "demo",
      triggerType: "manual",
    });
    db.prepare(
      "INSERT INTO rt_sessions (id, instance_slug, agent_id, channel) VALUES (?, ?, ?, ?)",
    ).run("sess-count-1", "demo", "pilot", "web");
    const step = createStepRun(db, { runId: run.id, stepId: "a", agentId: "pilot" });
    updateStepRun(db, step.id, { sessionId: "sess-count-1", status: "completed" });

    // Verify sessionCount is now 1
    const listRes2 = await app.request("/api/instances/demo/flows", { headers: authHeaders() });
    const body2 = await json(listRes2);
    const found2 = body2.flows.find((f: { id: number }) => f.id === flow.id);
    expect(found2.sessionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/instances/demo/flows");
    expect(res.status).toBe(401);
  });
});
