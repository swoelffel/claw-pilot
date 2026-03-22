// src/dashboard/__tests__/costs-routes.test.ts
//
// Integration tests for the costs API routes.

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
import { registerCostsRoutes } from "../routes/instances/costs.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-costs-token-64chars-hex-0123456789abcdef0123456789abcdef00";

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

function insertSession(id: string, slug: string): void {
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state)
     VALUES (?, ?, 'main', 'web', 'active')`,
  ).run(id, slug);
}

function insertMessage(
  id: string,
  sessionId: string,
  opts: {
    agentId?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    createdAt?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, model, tokens_in, tokens_out, cost_usd, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sessionId,
    opts.agentId ?? "agent-1",
    opts.model ?? "claude-sonnet-4-6",
    opts.tokensIn ?? 100,
    opts.tokensOut ?? 50,
    opts.costUsd ?? 0.001,
    opts.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " "),
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-costs-routes-"));
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
  };

  registerCostsRoutes(app, deps);

  // Seed an instance
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

describe("GET /api/instances/:slug/costs/summary", () => {
  it("returns 200 with summary for valid instance", async () => {
    insertSession("s1", "demo");
    insertMessage("m1", "s1", { tokensIn: 100, tokensOut: 50, costUsd: 0.01 });

    const res = await app.request("/api/instances/demo/costs/summary?period=all", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.messageCount).toBe(1);
    expect(body.totalTokensIn).toBe(100);
    expect(body.totalTokensOut).toBe(50);
    expect(body.totalCostUsd).toBeCloseTo(0.01);
    expect(body.period).toBe("all");
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/unknown/costs/summary", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("defaults to 7d period when invalid", async () => {
    const res = await app.request("/api/instances/demo/costs/summary?period=invalid", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.period).toBe("7d");
  });

  it("returns zeros for empty instance", async () => {
    const res = await app.request("/api/instances/demo/costs/summary?period=all", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.messageCount).toBe(0);
    expect(body.totalCostUsd).toBe(0);
  });
});

describe("GET /api/instances/:slug/costs/daily", () => {
  it("returns daily breakdown", async () => {
    insertSession("s1", "demo");
    insertMessage("m1", "s1", { model: "claude-sonnet-4-6", costUsd: 0.01 });

    const res = await app.request("/api/instances/demo/costs/daily?period=all", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty("day");
    expect(body[0]).toHaveProperty("model");
    expect(body[0]).toHaveProperty("costUsd");
  });
});

describe("GET /api/instances/:slug/costs/by-agent", () => {
  it("returns per-agent breakdown", async () => {
    insertSession("s1", "demo");
    insertMessage("m1", "s1", { agentId: "agent-a", costUsd: 0.05 });
    insertMessage("m2", "s1", { agentId: "agent-b", costUsd: 0.01 });

    const res = await app.request("/api/instances/demo/costs/by-agent?period=all", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(2);
    expect(body[0].agentId).toBe("agent-a");
    expect(body[0].costUsd).toBeCloseTo(0.05);
  });
});

describe("GET /api/instances/:slug/costs/by-model", () => {
  it("returns per-model breakdown", async () => {
    insertSession("s1", "demo");
    insertMessage("m1", "s1", { model: "claude-sonnet-4-6", costUsd: 0.01 });
    insertMessage("m2", "s1", { model: "claude-haiku-4-5", costUsd: 0.002 });

    const res = await app.request("/api/instances/demo/costs/by-model?period=all", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(2);
    expect(body[0].model).toBe("claude-sonnet-4-6");
    expect(body[1].model).toBe("claude-haiku-4-5");
  });
});
