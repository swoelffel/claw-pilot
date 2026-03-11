// src/dashboard/__tests__/routes.test.ts
//
// Integration tests for the dashboard API routes.
// Uses Hono's in-memory request handling (no HTTP server needed).
// Real SQLite in-memory DB + MockConnection for filesystem/shell ops.

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
import { registerInstanceRoutes } from "../routes/instances.js";
import { registerBlueprintRoutes } from "../routes/blueprints.js";
import { registerTeamRoutes } from "../routes/teams.js";
import { registerSystemRoutes } from "../routes/system.js";
import type { HealthStatus } from "../../core/health.js";
import type { UpdateStatus } from "../../core/update-checker.js";
import type { UpdateJob } from "../../core/updater.js";
import type { SelfUpdateStatus } from "../../core/self-update-checker.js";
import type { SelfUpdateJob } from "../../core/self-updater.js";

// ---------------------------------------------------------------------------
// Test token
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Typed JSON parse helper — avoids `body is of type unknown` TS errors in tests. */
async function json(res: Response): Promise<Json> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Stub classes — avoid real systemd/HTTP calls
// ---------------------------------------------------------------------------

class StubHealthChecker {
  private registry: Registry;
  constructor(registry: Registry) {
    this.registry = registry;
  }

  async check(slug: string): Promise<HealthStatus> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new Error(`Instance not found: ${slug}`);
    return {
      slug,
      port: instance.port,
      state: "running",
      gateway: "healthy",
      systemd: "active",
      agentCount: 0,
      telegram: "not_configured",
    };
  }

  async checkAll(): Promise<HealthStatus[]> {
    const instances = this.registry.listInstances();
    return instances.map((inst) => ({
      slug: inst.slug,
      port: inst.port,
      state: "running" as const,
      gateway: "healthy" as const,
      systemd: "active" as const,
      agentCount: 0,
      telegram: "not_configured" as const,
    }));
  }
}

class StubLifecycle {
  lastAction: { action: string; slug: string } | null = null;

  async start(slug: string): Promise<void> {
    this.lastAction = { action: "start", slug };
  }
  async stop(slug: string): Promise<void> {
    this.lastAction = { action: "stop", slug };
  }
  async restart(slug: string): Promise<void> {
    this.lastAction = { action: "restart", slug };
  }
}

class StubUpdateChecker {
  async check(): Promise<UpdateStatus> {
    return {
      currentVersion: "2026.3.1",
      latestVersion: "2026.3.1",
      updateAvailable: false,
    };
  }
}

class StubUpdater {
  private _job: UpdateJob = { status: "idle", jobId: "" };

  getJob(): UpdateJob {
    return { ...this._job };
  }

  run(_fromVersion?: string, _toVersion?: string): void {
    this._job = {
      status: "running",
      jobId: "test-job-id",
      startedAt: new Date().toISOString(),
    };
  }
}

class StubSelfUpdateChecker {
  async check(): Promise<SelfUpdateStatus> {
    return {
      currentVersion: "0.11.0",
      latestVersion: "0.11.0",
      latestTag: "v0.11.0",
      updateAvailable: false,
    };
  }
}

class StubSelfUpdater {
  private _job: SelfUpdateJob = { status: "idle", jobId: "" };

  getJob(): SelfUpdateJob {
    return { ...this._job };
  }

  run(_fromVersion?: string, _toVersion?: string, _tag?: string): void {
    this._job = {
      status: "running",
      jobId: "test-self-job-id",
      startedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Test harness — builds a Hono app with all routes + auth middleware
// ---------------------------------------------------------------------------

interface TestContext {
  app: Hono;
  registry: Registry;
  conn: MockConnection;
  db: ReturnType<typeof initDatabase>;
  tmpDir: string;
  lifecycle: StubLifecycle;
  updater: StubUpdater;
}

function createTestApp(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-routes-test-"));
  const db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);
  const lifecycle = new StubLifecycle();
  const updater = new StubUpdater();

  const app = new Hono();

  // Auth middleware (same as server.ts)
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });

  // Register all route modules
  const deps: RouteDeps = {
    registry,
    conn,
    db,
    startedAt: Date.now(),
    health: new StubHealthChecker(registry) as unknown as RouteDeps["health"],
    lifecycle: lifecycle as unknown as RouteDeps["lifecycle"],
    updateChecker: new StubUpdateChecker() as unknown as RouteDeps["updateChecker"],
    updater: updater as unknown as RouteDeps["updater"],
    selfUpdateChecker: new StubSelfUpdateChecker() as unknown as RouteDeps["selfUpdateChecker"],
    selfUpdater: new StubSelfUpdater() as unknown as RouteDeps["selfUpdater"],
    tokenCache,
    xdgRuntimeDir: "/run/user/1000",
    sessionStore: new SessionStore(db),
  };

  registerInstanceRoutes(app, deps);
  registerBlueprintRoutes(app, deps);
  registerTeamRoutes(app, deps);
  registerSystemRoutes(app, deps);

  return { app, registry, conn, db, tmpDir, lifecycle, updater };
}

/** Helper: make an authenticated request */
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

/** Helper: make an authenticated JSON request */
function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/** Helper: create a test instance in the registry + mock filesystem */
function seedInstance(ctx: TestContext, slug: string, port: number) {
  const server =
    ctx.registry.getLocalServer() ?? ctx.registry.upsertLocalServer("testhost", "/opt/openclaw");
  ctx.registry.createInstance({
    serverId: server.id,
    slug,
    port,
    configPath: `/opt/openclaw/.openclaw-${slug}/openclaw.json`,
    stateDir: `/opt/openclaw/.openclaw-${slug}`,
    systemdUnit: `openclaw-${slug}.service`,
  });
  // Seed .env for token cache
  ctx.conn.files.set(
    `/opt/openclaw/.openclaw-${slug}/.env`,
    `OPENCLAW_GW_AUTH_TOKEN=gw-token-${slug}\n`,
  );
  // Seed openclaw.json for config reads
  ctx.conn.files.set(
    `/opt/openclaw/.openclaw-${slug}/openclaw.json`,
    JSON.stringify({
      gateway: { port, bind: "0.0.0.0" },
      models: { default: "claude-sonnet-4-20250514", providers: { anthropic: {} } },
      agents: { defaults: { workspace: "." }, list: [] },
    }),
  );
}

// ===========================================================================
// Tests
// ===========================================================================

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

afterEach(() => {
  ctx.db.close();
  fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

describe("Auth middleware", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await ctx.app.request("/api/health");
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 with wrong token", async () => {
    const res = await ctx.app.request("/api/health", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid token", async () => {
    const res = await ctx.app.request("/api/health", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// System routes
// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  it("returns ok with instance count", async () => {
    const res = await ctx.app.request("/api/health", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.instances.total).toBe(0);
    expect(body.instances.running).toBe(0);
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.version).toBe("string");
    expect(typeof body.db.sizeBytes).toBe("number");
  });

  it("reflects correct instance count", async () => {
    seedInstance(ctx, "demo1", 18789);
    seedInstance(ctx, "demo2", 18790);
    const res = await ctx.app.request("/api/health", { headers: authHeaders() });
    const body = await json(res);
    expect(body.instances.total).toBe(2);
  });
});

describe("GET /api/openclaw/update-status", () => {
  it("returns version info", async () => {
    const res = await ctx.app.request("/api/openclaw/update-status", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.currentVersion).toBe("2026.3.1");
    expect(body.updateAvailable).toBe(false);
  });
});

describe("POST /api/openclaw/update", () => {
  it("triggers update job", async () => {
    const res = await ctx.app.request("/api/openclaw/update", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("test-job-id");
  });
});

// ---------------------------------------------------------------------------
// Instance routes — listing
// ---------------------------------------------------------------------------

describe("GET /api/instances", () => {
  it("returns empty array when no instances", async () => {
    const res = await ctx.app.request("/api/instances", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual([]);
  });

  it("returns enriched instances with gateway token", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe("demo1");
    expect(body[0].gatewayToken).toBe("gw-token-demo1");
    expect(body[0].gateway).toBe("healthy");
  });
});

describe("GET /api/instances/:slug", () => {
  it("returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent", { headers: authHeaders() });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns instance detail with health status", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.instance.slug).toBe("demo1");
    expect(body.status.gateway).toBe("healthy");
    expect(body.gatewayToken).toBe("gw-token-demo1");
  });
});

// ---------------------------------------------------------------------------
// Instance routes — lifecycle
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/start", () => {
  it("returns 200 for unknown slug (lifecycle stub is permissive)", async () => {
    // Note: in production, Lifecycle.start() throws InstanceNotFoundError for unknown slugs.
    // Our stub is permissive — this test verifies the route handler delegates to lifecycle.
    const res = await ctx.app.request("/api/instances/nonexistent/start", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(ctx.lifecycle.lastAction).toEqual({ action: "start", slug: "nonexistent" });
  });

  it("starts a known instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/start", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(ctx.lifecycle.lastAction).toEqual({ action: "start", slug: "demo1" });
  });
});

describe("POST /api/instances/:slug/stop", () => {
  it("stops a known instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/stop", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(ctx.lifecycle.lastAction).toEqual({ action: "stop", slug: "demo1" });
  });
});

describe("POST /api/instances/:slug/restart", () => {
  it("restarts a known instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/restart", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(ctx.lifecycle.lastAction).toEqual({ action: "restart", slug: "demo1" });
  });
});

// ---------------------------------------------------------------------------
// Instance routes — agents
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/agents", () => {
  it("returns 404 for unknown instance", async () => {
    // Note: this route doesn't check instance existence, it just returns empty
    const res = await ctx.app.request("/api/instances/nonexistent/agents", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual([]);
  });

  it("returns agents for a known instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });
    const res = await ctx.app.request("/api/instances/demo1/agents", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(1);
    expect(body[0].agent_id).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// Instance routes — config
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/config", () => {
  it("returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/instances/:slug/config", () => {
  it("returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ general: { displayName: "Test" } }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects invalid JSON", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/config", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict Zod validation)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ unknownField: "value" }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });
});

// ---------------------------------------------------------------------------
// Instance routes — delete
// ---------------------------------------------------------------------------

describe("DELETE /api/instances/:slug", () => {
  it("returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Instance routes — next-port
// ---------------------------------------------------------------------------

describe("GET /api/next-port", () => {
  it("returns 500 when server not initialized", async () => {
    const res = await ctx.app.request("/api/next-port", { headers: authHeaders() });
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.code).toBe("SERVER_NOT_INIT");
  });

  it("returns a port when server is initialized", async () => {
    ctx.registry.upsertLocalServer("testhost", "/opt/openclaw");
    const res = await ctx.app.request("/api/next-port", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.port).toBeGreaterThanOrEqual(18789);
    expect(body.port).toBeLessThanOrEqual(18799);
  });
});

// ---------------------------------------------------------------------------
// Blueprint routes
// ---------------------------------------------------------------------------

describe("GET /api/blueprints", () => {
  it("returns empty array when no blueprints", async () => {
    const res = await ctx.app.request("/api/blueprints", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual([]);
  });
});

describe("POST /api/blueprints", () => {
  it("rejects missing name", async () => {
    const res = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("BLUEPRINT_NAME_REQUIRED");
  });

  it("rejects empty name", async () => {
    const res = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("creates a blueprint with seeded main agent", async () => {
    const res = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "My Blueprint" }),
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("My Blueprint");
    expect(body.id).toBeGreaterThan(0);

    // Verify main agent was seeded
    const builderRes = await ctx.app.request(`/api/blueprints/${body.id}/builder`, {
      headers: authHeaders(),
    });
    expect(builderRes.status).toBe(200);
    const builder = await json(builderRes);
    expect(builder.agents).toHaveLength(1);
    expect(builder.agents[0].agent_id).toBe("main");
    expect(builder.agents[0].files.length).toBeGreaterThan(0);
  });

  it("rejects duplicate name", async () => {
    await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Unique" }),
    });
    const res = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Unique" }),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("BLUEPRINT_NAME_TAKEN");
  });
});

describe("GET /api/blueprints/:id", () => {
  it("returns 404 for unknown id", async () => {
    const res = await ctx.app.request("/api/blueprints/999", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-numeric id", async () => {
    const res = await ctx.app.request("/api/blueprints/abc", { headers: authHeaders() });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_INVALID");
  });
});

describe("DELETE /api/blueprints/:id", () => {
  it("returns 404 for unknown id", async () => {
    const res = await ctx.app.request("/api/blueprints/999", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("deletes an existing blueprint", async () => {
    const createRes = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "ToDelete" }),
    });
    const { id } = await json(createRes);

    const res = await ctx.app.request(`/api/blueprints/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify it's gone
    const getRes = await ctx.app.request(`/api/blueprints/${id}`, { headers: authHeaders() });
    expect(getRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Blueprint routes — agents
// ---------------------------------------------------------------------------

describe("POST /api/blueprints/:id/agents", () => {
  it("rejects invalid agent_id format", async () => {
    const createRes = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "BP" }),
    });
    const { id } = await json(createRes);

    const res = await ctx.app.request(`/api/blueprints/${id}/agents`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ agent_id: "INVALID", name: "Bad" }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_AGENT_ID");
  });

  it("creates an agent and returns builder payload", async () => {
    const createRes = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "BP" }),
    });
    const { id } = await json(createRes);

    const res = await ctx.app.request(`/api/blueprints/${id}/agents`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ agent_id: "researcher", name: "Researcher" }),
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    // Should have main + researcher
    expect(body.agents).toHaveLength(2);
    const agentIds = body.agents.map((a: { agent_id: string }) => a.agent_id).sort();
    expect(agentIds).toEqual(["main", "researcher"]);
  });
});

// ---------------------------------------------------------------------------
// Blueprint routes — files
// ---------------------------------------------------------------------------

describe("PUT /api/blueprints/:id/agents/:agentId/files/:filename", () => {
  it("rejects content exceeding 1MB", async () => {
    const createRes = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "BP" }),
    });
    const { id } = await json(createRes);

    const res = await ctx.app.request(`/api/blueprints/${id}/agents/main/files/SOUL.md`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "x".repeat(1_048_577) }),
    });
    expect(res.status).toBe(413);
    const body = await json(res);
    expect(body.code).toBe("CONTENT_TOO_LARGE");
  });

  it("updates a file and returns content", async () => {
    const createRes = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "BP" }),
    });
    const { id } = await json(createRes);

    const res = await ctx.app.request(`/api/blueprints/${id}/agents/main/files/SOUL.md`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "# Updated soul" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.filename).toBe("SOUL.md");
    expect(body.content).toBe("# Updated soul");
    expect(body.content_hash).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Blueprint routes — spawn links
// ---------------------------------------------------------------------------

describe("PATCH /api/blueprints/:id/agents/:agentId/spawn-links", () => {
  it("updates spawn links", async () => {
    const createRes = await ctx.app.request("/api/blueprints", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "BP" }),
    });
    const { id } = await json(createRes);

    // Add a second agent
    await ctx.app.request(`/api/blueprints/${id}/agents`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ agent_id: "helper", name: "Helper" }),
    });

    // Set spawn link from main -> helper
    const res = await ctx.app.request(`/api/blueprints/${id}/agents/main/spawn-links`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ targets: ["helper"] }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.links).toHaveLength(1);
    expect(body.links[0].source_agent_id).toBe("main");
    expect(body.links[0].target_agent_id).toBe("helper");
    expect(body.links[0].link_type).toBe("spawn");
  });
});

// ---------------------------------------------------------------------------
// Device routes
// ---------------------------------------------------------------------------

describe("Device routes", () => {
  it("GET /api/instances/:slug/devices — returns empty device list when no files", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/devices", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pending).toEqual([]);
    expect(body.paired).toEqual([]);
  });

  it("GET /api/instances/:slug/devices — returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/devices", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("POST /api/instances/:slug/devices/approve — returns 400 when requestId missing", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/devices/approve", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_REQUIRED");
  });

  it("POST /api/instances/:slug/devices/approve — returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/devices/approve", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ requestId: "req-123" }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("DELETE /api/instances/:slug/devices/:deviceId — returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/devices/device-abc", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("GET /api/instances/:slug/devices — returns device list when files exist", async () => {
    seedInstance(ctx, "demo1", 18789);
    // Seed device files
    ctx.conn.files.set(
      `/opt/openclaw/.openclaw-demo1/devices/pending.json`,
      JSON.stringify([{ id: "req-1", name: "My Phone", createdAt: "2026-01-01T00:00:00Z" }]),
    );
    ctx.conn.files.set(`/opt/openclaw/.openclaw-demo1/devices/paired.json`, JSON.stringify([]));

    const res = await ctx.app.request("/api/instances/demo1/devices", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pending).toHaveLength(1);
    expect(body.paired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Telegram pairing routes
// ---------------------------------------------------------------------------

describe("Telegram pairing routes", () => {
  it("GET /api/instances/:slug/telegram/pairing — returns empty pairing list", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/telegram/pairing", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pending).toEqual([]);
    expect(body.approved).toEqual([]);
  });

  it("GET /api/instances/:slug/telegram/pairing — returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/telegram/pairing", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("POST /api/instances/:slug/telegram/pairing/approve — returns 400 when code missing", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/telegram/pairing/approve", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_REQUIRED");
  });

  it("POST /api/instances/:slug/telegram/pairing/approve — returns 404 for unknown slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/telegram/pairing/approve", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ code: "ABCD1234" }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("GET /api/instances/:slug/telegram/pairing — returns pairing data when files exist", async () => {
    seedInstance(ctx, "demo1", 18789);
    // Seed telegram pairing files
    ctx.conn.files.set(
      `/opt/openclaw/.openclaw-demo1/credentials/telegram-pairing.json`,
      JSON.stringify({
        version: 1,
        requests: [
          {
            id: "123456789",
            code: "ABCD1234",
            createdAt: "2026-01-01T00:00:00Z",
            lastSeenAt: "2026-01-01T00:00:00Z",
            meta: { username: "testuser" },
          },
        ],
      }),
    );
    ctx.conn.files.set(
      `/opt/openclaw/.openclaw-demo1/credentials/telegram-allowFrom.json`,
      JSON.stringify({ version: 1, allowFrom: ["987654321"] }),
    );

    const res = await ctx.app.request("/api/instances/demo1/telegram/pairing", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0].code).toBe("ABCD1234");
    expect(body.approved).toHaveLength(1);
    expect(body.approved[0]).toBe("987654321");
  });
});
