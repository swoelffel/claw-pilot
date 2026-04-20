// src/dashboard/__tests__/search-routes.test.ts
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
import { registerSearchRoutes } from "../routes/search.js";
import {
  upsertSearchEntry,
  rebuildSearchIndex,
} from "../../core/repositories/search-repository.js";
import { createTask } from "../../core/repositories/task-repository.js";

const TEST_TOKEN = "test-search-token-64chars-hex-0123456789abcdef0123456789abcdef0";

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-search-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    // Synthetic admin user required by permission() middleware which reads c.get("user").
    // The bare test harness has no server-level auth middleware, so we inject it here.
    c.set("user", { id: "test", username: "admin", role: "admin", source: "session" });
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

  registerSearchRoutes(app, deps);

  // Create test data
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "demo",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-demo",
  });

  // Rebuild index so demo instance is searchable
  rebuildSearchIndex(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/search
// ---------------------------------------------------------------------------

describe("GET /api/search", () => {
  it("returns matching instances", async () => {
    const res = await app.request("/api/search?q=demo", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0].type).toBe("instance");
    expect(body.results[0].id).toBe("demo");
  });

  it("returns 400 for missing query", async () => {
    const res = await app.request("/api/search", { headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/search?q=demo");
    expect(res.status).toBe(401);
  });

  it("includes correct route hashes", async () => {
    const res = await app.request("/api/search?q=demo", { headers: authHeaders() });
    const body = await json(res);
    const inst = body.results.find((r: Json) => r.type === "instance");
    expect(inst.route).toBe("/instances/demo/builder");
  });

  it("respects limit parameter", async () => {
    // Add multiple tasks
    for (let i = 0; i < 10; i++) {
      createTask(db, {
        instanceSlug: "demo",
        title: `Search task ${i}`,
        createdBy: "user",
      });
    }
    rebuildSearchIndex(db);

    const res = await app.request("/api/search?q=Search&limit=3", { headers: authHeaders() });
    const body = await json(res);
    expect(body.results).toHaveLength(3);
  });

  it("returns results from upserted entries", async () => {
    upsertSearchEntry(db, {
      entityType: "blueprint",
      entityId: "1",
      title: "MyBlueprint",
      subtitle: "template",
      routeHash: "/blueprints/1/builder",
    });

    const res = await app.request("/api/search?q=MyBlueprint", { headers: authHeaders() });
    const body = await json(res);
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0].type).toBe("blueprint");
  });

  it("returns empty results for non-matching query", async () => {
    const res = await app.request("/api/search?q=zzzznonexistent", { headers: authHeaders() });
    const body = await json(res);
    expect(body.results).toEqual([]);
  });
});
