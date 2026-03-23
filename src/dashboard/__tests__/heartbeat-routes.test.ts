// src/dashboard/__tests__/heartbeat-routes.test.ts
//
// Integration tests for the heartbeat heatmap API routes.

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
import { registerHeartbeatRoutes } from "../routes/instances/heartbeat.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-hb-token-64chars-hex-000123456789abcdef0123456789abcdef00";

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

function insertHeartbeatSession(id: string, slug: string, agentId: string): void {
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, peer_id, state)
     VALUES (?, ?, ?, 'internal', ?, 'active')`,
  ).run(id, slug, agentId, `heartbeat:${agentId}`);
}

function insertHeartbeatTick(
  msgId: string,
  sessionId: string,
  opts: { text?: string; createdAt?: string } = {},
): void {
  const createdAt = opts.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, created_at)
     VALUES (?, ?, 'assistant', ?)`,
  ).run(msgId, sessionId, createdAt);
  db.prepare(
    `INSERT INTO rt_parts (id, message_id, type, content, sort_order, created_at, updated_at)
     VALUES (?, ?, 'text', ?, 0, ?, ?)`,
  ).run(`p-${msgId}`, msgId, opts.text ?? "HEARTBEAT_OK", createdAt, createdAt);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-hb-routes-"));
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

  registerHeartbeatRoutes(app, deps);

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
// GET /api/instances/:slug/heartbeat/heatmap
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/heartbeat/heatmap", () => {
  it("returns 200 with empty data when no ticks exist", async () => {
    const res = await app.request("/api/instances/demo/heartbeat/heatmap", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.period).toBe("7d");
    expect(body.buckets).toEqual([]);
    expect(body.stats).toEqual([]);
  });

  it("returns bucketed data with seeded ticks", async () => {
    insertHeartbeatSession("hs1", "demo", "pilot");
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace("T", " ");
    insertHeartbeatTick("t1", "hs1", { createdAt: ts });
    insertHeartbeatTick("t2", "hs1", { createdAt: ts });

    const res = await app.request("/api/instances/demo/heartbeat/heatmap", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.buckets.length).toBeGreaterThan(0);
    expect(body.buckets[0].agentId).toBe("pilot");
    expect(body.buckets[0].tickCount).toBe(2);
    expect(body.buckets[0].okCount).toBe(2);
    expect(body.buckets[0].alertCount).toBe(0);
  });

  it("counts alerts vs ok correctly", async () => {
    insertHeartbeatSession("hs1", "demo", "pilot");
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    insertHeartbeatTick("t1", "hs1", { text: "HEARTBEAT_OK", createdAt: ts });
    insertHeartbeatTick("t2", "hs1", { text: "Alert: disk full", createdAt: ts });
    insertHeartbeatTick("t3", "hs1", {
      text: "HEARTBEAT_ALERT: something wrong",
      createdAt: ts,
    });

    const res = await app.request("/api/instances/demo/heartbeat/heatmap", {
      headers: authHeaders(),
    });
    const body = await json(res);
    expect(body.buckets[0].tickCount).toBe(3);
    expect(body.buckets[0].okCount).toBe(1);
    expect(body.buckets[0].alertCount).toBe(2);
  });

  it("respects the days parameter", async () => {
    insertHeartbeatSession("hs1", "demo", "pilot");
    // Insert a tick 10 days ago — should be excluded from 7d but included in 14d
    const old = new Date();
    old.setDate(old.getDate() - 10);
    const oldTs = old.toISOString().slice(0, 19).replace("T", " ");
    insertHeartbeatTick("t-old", "hs1", { createdAt: oldTs });

    // Recent tick
    const recent = new Date().toISOString().slice(0, 19).replace("T", " ");
    insertHeartbeatTick("t-new", "hs1", { createdAt: recent });

    // 7d — only recent
    const res7 = await app.request("/api/instances/demo/heartbeat/heatmap?days=7", {
      headers: authHeaders(),
    });
    const body7 = await json(res7);
    const total7 = body7.buckets.reduce((s: number, b: Json) => s + b.tickCount, 0);
    expect(total7).toBe(1);

    // 14d — both
    const res14 = await app.request("/api/instances/demo/heartbeat/heatmap?days=14", {
      headers: authHeaders(),
    });
    const body14 = await json(res14);
    const total14 = body14.buckets.reduce((s: number, b: Json) => s + b.tickCount, 0);
    expect(total14).toBe(2);
  });

  it("falls back to 7d for invalid days parameter", async () => {
    const res = await app.request("/api/instances/demo/heartbeat/heatmap?days=999", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.period).toBe("7d");
  });

  it("returns multiple agents separately", async () => {
    insertHeartbeatSession("hs1", "demo", "pilot");
    insertHeartbeatSession("hs2", "demo", "scout");
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    insertHeartbeatTick("t1", "hs1", { createdAt: ts });
    insertHeartbeatTick("t2", "hs2", { createdAt: ts });

    const res = await app.request("/api/instances/demo/heartbeat/heatmap", {
      headers: authHeaders(),
    });
    const body = await json(res);
    expect(body.buckets).toHaveLength(2);
    const agentIds = body.buckets.map((b: Json) => b.agentId);
    expect(agentIds).toContain("pilot");
    expect(agentIds).toContain("scout");
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/xyznonexistent/heartbeat/heatmap", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns correct stats", async () => {
    insertHeartbeatSession("hs1", "demo", "pilot");
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    insertHeartbeatTick("t1", "hs1", { text: "HEARTBEAT_OK", createdAt: ts });
    insertHeartbeatTick("t2", "hs1", { text: "Alert: issue", createdAt: ts });

    const res = await app.request("/api/instances/demo/heartbeat/heatmap", {
      headers: authHeaders(),
    });
    const body = await json(res);
    expect(body.stats).toHaveLength(1);
    expect(body.stats[0].agentId).toBe("pilot");
    expect(body.stats[0].totalTicks).toBe(2);
    expect(body.stats[0].totalAlerts).toBe(1);
    expect(body.stats[0].firstTick).toBeTruthy();
    expect(body.stats[0].lastTick).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/heartbeat/schedule
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/heartbeat/schedule", () => {
  it("returns empty agents when no runtime config exists", async () => {
    const res = await app.request("/api/instances/demo/heartbeat/schedule", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agents).toEqual([]);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/xyznonexistent/heartbeat/schedule", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
