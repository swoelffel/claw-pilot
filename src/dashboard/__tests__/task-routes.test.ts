// src/dashboard/__tests__/task-routes.test.ts
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
import { registerTaskRoutes } from "../routes/instances/tasks.js";
import { disposeBus } from "../../runtime/bus/index.js";
import type { InstanceSlug } from "../../runtime/types.js";

const TEST_TOKEN = "test-task-token-64chars-hex-0123456789abcdef0123456789abcdef00";

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
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-task-routes-"));
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

  registerTaskRoutes(app, deps);

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
  disposeBus("demo" as InstanceSlug);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/tasks", () => {
  it("returns empty array", async () => {
    const res = await app.request("/api/instances/demo/tasks", { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/nope/tasks", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/instances/:slug/tasks", () => {
  it("creates a task", async () => {
    const res = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Fix auth", priority: "high" }),
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.id).toBeGreaterThan(0);
    expect(data.title).toBe("Fix auth");
    expect(data.priority).toBe("high");
    expect(data.status).toBe("pending");
    expect(data.createdBy).toBe("user");
  });

  it("rejects missing title", async () => {
    const res = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "low" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/instances/:slug/tasks/:id/status", () => {
  it("changes status for drag & drop", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T1" }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/tasks/${id}/status`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", position: 150 }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.status).toBe("in_progress");
    expect(data.position).toBe(150);
  });
});

describe("DELETE /api/instances/:slug/tasks/:id", () => {
  it("deletes a task", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T1" }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/tasks/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const listRes = await app.request("/api/instances/demo/tasks", { headers: authHeaders() });
    expect(await json(listRes)).toEqual([]);
  });
});

describe("POST /api/instances/:slug/tasks/:id/comments", () => {
  it("adds a comment", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T1" }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/tasks/${id}/comments`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ authorId: "pilot", content: "Working on it" }),
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.content).toBe("Working on it");
    expect(data.authorId).toBe("pilot");
  });
});

describe("GET /api/instances/:slug/tasks/counts", () => {
  it("returns zero counts for empty instance", async () => {
    const res = await app.request("/api/instances/demo/tasks/counts", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.pending).toBe(0);
    expect(data.in_progress).toBe(0);
  });
});

describe("GET /api/instances/:slug/tasks/:id", () => {
  it("returns task with comments", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T1" }),
    });
    const { id } = await json(createRes);

    await app.request(`/api/instances/demo/tasks/${id}/comments`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });

    const res = await app.request(`/api/instances/demo/tasks/${id}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.title).toBe("T1");
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].content).toBe("Hello");
  });
});

// ---------------------------------------------------------------------------
// PATCH assigneeId → message injection
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/tasks/:id (assignee change)", () => {
  it("injects notification message when assigneeId changes to a non-null value", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Assign test" }),
    });
    const { id } = await json(createRes);

    const res = await app.request(`/api/instances/demo/tasks/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: "builder" }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.assigneeId).toBe("builder");

    // Verify a notification message was injected into the agent's session
    const msgs = db
      .prepare(
        `SELECT p.content FROM rt_messages m
         JOIN rt_parts p ON p.message_id = m.id
         JOIN rt_sessions s ON s.id = m.session_id
         WHERE s.agent_id = 'builder' AND m.role = 'user'
         ORDER BY m.created_at DESC LIMIT 1`,
      )
      .get() as { content: string } | undefined;
    expect(msgs).toBeDefined();
    expect(msgs!.content).toContain("[task_assigned:#");
    expect(msgs!.content).toContain("Assign test");
  });

  it("does not inject message when assigneeId stays the same", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Same test", assigneeId: "builder" }),
    });
    const { id } = await json(createRes);

    const msgCountBefore = (
      db.prepare("SELECT COUNT(*) as cnt FROM rt_messages").get() as { cnt: number }
    ).cnt;

    const res = await app.request(`/api/instances/demo/tasks/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: "builder" }),
    });
    expect(res.status).toBe(200);

    const msgCountAfter = (
      db.prepare("SELECT COUNT(*) as cnt FROM rt_messages").get() as { cnt: number }
    ).cnt;
    expect(msgCountAfter).toBe(msgCountBefore);
  });

  it("does not inject message when assigneeId set to null", async () => {
    const createRes = await app.request("/api/instances/demo/tasks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Null test", assigneeId: "builder" }),
    });
    const { id } = await json(createRes);

    const msgCountBefore = (
      db.prepare("SELECT COUNT(*) as cnt FROM rt_messages").get() as { cnt: number }
    ).cnt;

    const res = await app.request(`/api/instances/demo/tasks/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: null }),
    });
    expect(res.status).toBe(200);

    const msgCountAfter = (
      db.prepare("SELECT COUNT(*) as cnt FROM rt_messages").get() as { cnt: number }
    ).cnt;
    expect(msgCountAfter).toBe(msgCountBefore);
  });
});
