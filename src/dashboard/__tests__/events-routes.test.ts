// src/dashboard/__tests__/events-routes.test.ts
//
// Integration tests for the events API routes.

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
import { registerEventsRoutes } from "../routes/instances/events.js";
import { insertRtEvent } from "../../core/repositories/rt-event-repository.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-events-token-64chars-hex-0123456789abcdef0123456789abcde00";

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

function seedEvent(opts: {
  slug?: string;
  eventType?: string;
  agentId?: string;
  sessionId?: string;
  level?: "info" | "warn" | "error";
}): void {
  const slug = opts.slug ?? "demo";
  const eventType = opts.eventType ?? "session.created";
  const level = opts.level ?? "info";
  insertRtEvent(db, {
    instanceSlug: slug,
    eventType,
    ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
    level,
    summary: `Test event: ${eventType}`,
    payload: JSON.stringify({ test: true }),
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-events-routes-"));
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

  registerEventsRoutes(app, deps);

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
// GET /api/instances/:slug/events
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/events", () => {
  it("returns 200 with paginated events", async () => {
    seedEvent({ agentId: "pilot", sessionId: "s-1" });
    seedEvent({ eventType: "runtime.error", level: "error" });

    const res = await app.request("/api/instances/demo/events", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].eventType).toBe("runtime.error");
    expect(body.events[1].eventType).toBe("session.created");
    expect(body.events[0].payload).toEqual({ test: true });
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/unknown/events", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty page for instance with no events", async () => {
    const res = await app.request("/api/instances/demo/events", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.events).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });

  it("filters by type", async () => {
    seedEvent({ eventType: "session.created" });
    seedEvent({ eventType: "runtime.error", level: "error" });
    seedEvent({ eventType: "message.created" });

    const res = await app.request(
      "/api/instances/demo/events?type=session.created,message.created",
      {
        headers: authHeaders(),
      },
    );
    const body = await json(res);
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e: Json) => e.eventType !== "runtime.error")).toBe(true);
  });

  it("filters by level", async () => {
    seedEvent({ eventType: "session.created", level: "info" });
    seedEvent({ eventType: "runtime.error", level: "error" });

    const res = await app.request("/api/instances/demo/events?level=error", {
      headers: authHeaders(),
    });
    const body = await json(res);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].level).toBe("error");
  });

  it("supports cursor-based pagination", async () => {
    for (let i = 0; i < 5; i++) {
      seedEvent({ eventType: `session.created` });
    }

    const res1 = await app.request("/api/instances/demo/events?limit=2", {
      headers: authHeaders(),
    });
    const body1 = await json(res1);
    expect(body1.events).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const res2 = await app.request(
      `/api/instances/demo/events?limit=2&cursor=${body1.nextCursor}`,
      {
        headers: authHeaders(),
      },
    );
    const body2 = await json(res2);
    expect(body2.events).toHaveLength(2);

    // No overlap
    const ids1 = body1.events.map((e: Json) => e.id);
    const ids2 = body2.events.map((e: Json) => e.id);
    expect(ids1.every((id: number) => !ids2.includes(id))).toBe(true);
  });

  it("filters by agentId", async () => {
    seedEvent({ agentId: "pilot" });
    seedEvent({ agentId: "build" });

    const res = await app.request("/api/instances/demo/events?agentId=pilot", {
      headers: authHeaders(),
    });
    const body = await json(res);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].agentId).toBe("pilot");
  });
});
