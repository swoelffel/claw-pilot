// src/dashboard/__tests__/session-logs-routes.test.ts
//
// Integration tests for the session logs filtering on GET /runtime/sessions.

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
import { registerRuntimeRoutes } from "../routes/instances/runtime.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { injectAdminUser } from "./_helpers/inject-admin-user.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-session-logs-token-64chars-hex-0123456789abcdef01234567890abc";

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

function insertSession(
  id: string,
  slug: string,
  opts: {
    agentId?: string;
    channel?: string;
    state?: string;
    persistent?: number;
    createdAt?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state, persistent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    slug,
    opts.agentId ?? "pilot",
    opts.channel ?? "web",
    opts.state ?? "active",
    opts.persistent ?? 0,
    opts.createdAt ?? "2026-03-31 12:00:00",
  );
}

function insertMessage(
  id: string,
  sessionId: string,
  opts: { costUsd?: number; createdAt?: string } = {},
): void {
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, model, tokens_in, tokens_out, cost_usd, created_at)
     VALUES (?, ?, 'assistant', 'pilot', 'claude-sonnet-4-6', 100, 50, ?, ?)`,
  ).run(id, sessionId, opts.costUsd ?? 0.001, opts.createdAt ?? "2026-03-31 12:00:00");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-session-logs-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

  // Auth middleware
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
  registerRuntimeRoutes(app, deps);

  // Seed instance
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

describe("GET /api/instances/:slug/runtime/sessions — filtering", () => {
  it("returns all active sessions without filters", async () => {
    insertSession("s1", "demo", { agentId: "pilot" });
    insertSession("s2", "demo", { agentId: "dev" });
    insertMessage("m1", "s1");

    const res = await app.request("/api/instances/demo/runtime/sessions", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(2);
    expect(body).toHaveProperty("hasMore", false);
  });

  it("filters by agentId", async () => {
    insertSession("s1", "demo", { agentId: "pilot" });
    insertSession("s2", "demo", { agentId: "dev" });

    const res = await app.request("/api/instances/demo/runtime/sessions?agentId=pilot", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].agentId).toBe("pilot");
  });

  it("filters by since", async () => {
    insertSession("s1", "demo", { createdAt: "2026-03-29 10:00:00" });
    insertSession("s2", "demo", { createdAt: "2026-03-31 10:00:00" });

    const res = await app.request(
      "/api/instances/demo/runtime/sessions?since=2026-03-30T00:00:00",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("s2");
  });

  it("filters by persistent", async () => {
    insertSession("s1", "demo", { persistent: 1 });
    insertSession("s2", "demo", { persistent: 0 });
    insertSession("s3", "demo", { persistent: 0 });

    const res = await app.request("/api/instances/demo/runtime/sessions?persistent=1", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].persistent).toBe(true);
  });

  it("supports cursor-based pagination with before", async () => {
    insertSession("s1", "demo", { createdAt: "2026-03-30 10:00:00" });
    insertSession("s2", "demo", { createdAt: "2026-03-31 10:00:00" });
    insertSession("s3", "demo", { createdAt: "2026-04-01 10:00:00" });

    const res = await app.request(
      "/api/instances/demo/runtime/sessions?before=2026-03-31T12:00:00",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    // Should return s2 (2026-03-31 10:00:00) and s1 (2026-03-30 10:00:00)
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].id).toBe("s2");
    expect(body.sessions[1].id).toBe("s1");
  });

  it("returns hasMore=true when more results exist", async () => {
    // Insert 3 sessions, request limit=2
    insertSession("s1", "demo", { createdAt: "2026-03-29 10:00:00" });
    insertSession("s2", "demo", { createdAt: "2026-03-30 10:00:00" });
    insertSession("s3", "demo", { createdAt: "2026-03-31 10:00:00" });

    const res = await app.request("/api/instances/demo/runtime/sessions?limit=2", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(2);
    expect(body.hasMore).toBe(true);
  });

  it("returns hasMore=false when no more results", async () => {
    insertSession("s1", "demo");

    const res = await app.request("/api/instances/demo/runtime/sessions?limit=10", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it("combines multiple filters", async () => {
    insertSession("s1", "demo", {
      agentId: "pilot",
      persistent: 1,
      createdAt: "2026-03-31 10:00:00",
    });
    insertSession("s2", "demo", {
      agentId: "pilot",
      persistent: 0,
      createdAt: "2026-03-31 12:00:00",
    });
    insertSession("s3", "demo", {
      agentId: "dev",
      persistent: 1,
      createdAt: "2026-03-31 14:00:00",
    });
    insertSession("s4", "demo", {
      agentId: "pilot",
      persistent: 1,
      createdAt: "2026-03-29 10:00:00",
    });

    const res = await app.request(
      "/api/instances/demo/runtime/sessions?agentId=pilot&persistent=1&since=2026-03-30T00:00:00",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("s1");
  });

  it("excludes internal channel by default", async () => {
    insertSession("s1", "demo", { channel: "web" });
    insertSession("s2", "demo", { channel: "internal" });

    const res = await app.request("/api/instances/demo/runtime/sessions", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].channel).toBe("web");
  });

  it("state=all returns both active and archived sessions", async () => {
    insertSession("s1", "demo", { state: "active" });
    insertSession("s2", "demo", { state: "archived" });

    const res = await app.request("/api/instances/demo/runtime/sessions?state=all", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(2);
  });

  it("defaults to active-only when no state param", async () => {
    insertSession("s1", "demo", { state: "active" });
    insertSession("s2", "demo", { state: "archived" });

    const res = await app.request("/api/instances/demo/runtime/sessions", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].state).toBe("active");
  });
});
