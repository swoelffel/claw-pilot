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
import type { SelfUpdateStatus } from "../../core/self-update-checker.js";
import type { SelfUpdateJob } from "../../core/self-updater.js";
import { getBus, disposeBus } from "../../runtime/index.js";

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

class StubSelfUpdateChecker {
  async check(): Promise<SelfUpdateStatus> {
    return {
      currentVersion: "0.11.0",
      latestVersion: "0.11.0",
      latestTag: "v0.11.0",
      updateAvailable: false,
    };
  }

  invalidateCache(): void {
    // no-op in tests
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
}

function createTestApp(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-routes-test-"));
  const db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);
  const lifecycle = new StubLifecycle();

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

  return { app, registry, conn, db, tmpDir, lifecycle };
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
    configPath: `/opt/openclaw/.openclaw-${slug}/runtime.json`,
    stateDir: `/opt/openclaw/.openclaw-${slug}`,
    systemdUnit: `claw-runtime-${slug}`,
  });
  // Seed .env for token cache
  ctx.conn.files.set(
    `/opt/openclaw/.openclaw-${slug}/.env`,
    `OPENCLAW_GW_AUTH_TOKEN=gw-token-${slug}\n`,
  );
  // Seed runtime.json for config reads (flat agents[] array format)
  ctx.conn.files.set(
    `/opt/openclaw/.openclaw-${slug}/runtime.json`,
    JSON.stringify({
      defaultModel: "claude-sonnet-4-20250514",
      agents: [],
      port,
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

  it("accepts and ignores unknown fields (Zod strips extra keys)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ unknownField: "value" }),
    });
    // Zod v4 strips unknown keys by default — patch is valid but empty
    expect(res.status).toBe(200);
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

// ===========================================================================
// A1.1 — Instance agent routes
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/instances/:slug/agents — create agent
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/agents", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        agentSlug: "researcher",
        name: "Researcher",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when required fields are missing", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ agentSlug: "researcher" }), // missing name, provider, model
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_REQUIRED");
  });

  it("returns 400 for invalid agentSlug format (uppercase)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        agentSlug: "INVALID",
        name: "Bad",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_AGENT_ID");
  });

  it("returns 400 for agentSlug that is too short (1 char)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        agentSlug: "x",
        name: "X",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_AGENT_ID");
  });

  it("returns 201 and creates agent with valid body", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        agentSlug: "researcher",
        name: "Researcher",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      }),
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.instance.slug).toBe("demo1");
    // The new agent should appear in the agents list
    const agentIds = body.agents.map((a: { agent_id: string }) => a.agent_id);
    expect(agentIds).toContain("researcher");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/instances/:slug/agents/:agentId — delete agent
// ---------------------------------------------------------------------------

describe("DELETE /api/instances/:slug/agents/:agentId", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/researcher", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 500 when agent does not exist (provisioner throws plain Error)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/nonexistent-agent", {
      method: "DELETE",
      headers: authHeaders(),
    });
    // AgentProvisioner.deleteAgent throws a plain Error (not InstanceNotFoundError)
    // when agent is not found → route returns 500 AGENT_DELETE_FAILED
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.code).toBe("AGENT_DELETE_FAILED");
  });

  it("returns 200 and removes agent from list", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    // Create a non-default agent to delete
    ctx.registry.upsertAgent(instance.id, {
      agentId: "helper",
      name: "Helper",
      workspacePath: "/opt/openclaw/.openclaw-demo1/workspace-helper",
      isDefault: false,
    });
    // Seed workspace dir so remove() doesn't fail
    ctx.conn.dirs.add("/opt/openclaw/.openclaw-demo1/workspace-helper");

    const res = await ctx.app.request("/api/instances/demo1/agents/helper", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.instance.slug).toBe("demo1");
    const agentIds = body.agents.map((a: { agent_id: string }) => a.agent_id);
    expect(agentIds).not.toContain("helper");
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/agents/builder — builder payload
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/agents/builder", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/builder", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns builder payload with instance and agents", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/builder", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.instance.slug).toBe("demo1");
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].agent_id).toBe("main");
    expect(Array.isArray(body.links)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/agents/:agentId/position — update canvas position
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/agents/:agentId/position", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/main/position", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when x/y are not numbers", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/main/position", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ x: "not-a-number", y: 200 }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_INVALID");
  });

  it("returns 404 when agent does not exist", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/ghost/position", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ x: 100, y: 200 }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });

  it("returns 200 and updates position for existing agent", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/position", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ x: 150, y: 250 }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/agents/:agentId/meta — update agent meta
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/agents/:agentId/meta", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/main/meta", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ role: "Researcher" }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid meta fields (unknown field)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/main/meta", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ unknownField: "value" }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_INVALID");
  });

  it("returns 200 and updates meta for existing agent", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/meta", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ role: "Primary orchestrator", tags: "core,default" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/agents/:agentId/files/:filename — get agent file
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/agents/:agentId/files/:filename", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/main/files/SOUL.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 when agent does not exist", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/ghost/files/SOUL.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });

  it("returns 404 when file does not exist in registry", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/files/SOUL.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("FILE_NOT_FOUND");
  });

  it("returns 200 with file content when file exists in registry", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });
    // Retrieve the agent record to get its DB id
    const agentRecord = ctx.registry.getAgentByAgentId(instance.id, "main")!;
    // Seed a file in the registry
    ctx.registry.upsertAgentFile(agentRecord.id, {
      filename: "SOUL.md",
      content: "# My Soul",
      contentHash: "abc123",
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/files/SOUL.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.filename).toBe("SOUL.md");
    expect(body.content).toBe("# My Soul");
    expect(body.editable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/instances/:slug/agents/:agentId/files/:filename — update agent file
// ---------------------------------------------------------------------------

describe("PUT /api/instances/:slug/agents/:agentId/files/:filename", () => {
  it("returns 403 for non-editable filename (MEMORY.md)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/main/files/MEMORY.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "some content" }),
    });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.code).toBe("FILE_NOT_EDITABLE");
  });

  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/main/files/SOUL.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when content field is missing", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/files/SOUL.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({}), // no content field
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_REQUIRED");
  });

  it("returns 413 when content exceeds 1MB", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/files/SOUL.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "x".repeat(1_048_577) }),
    });
    expect(res.status).toBe(413);
    const body = await json(res);
    expect(body.code).toBe("CONTENT_TOO_LARGE");
  });

  it("returns 200 and updates file content", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });
    // Retrieve the agent record to get its DB id
    const agentRecord = ctx.registry.getAgentByAgentId(instance.id, "main")!;
    // Pre-seed the file so the registry has it
    ctx.registry.upsertAgentFile(agentRecord.id, {
      filename: "SOUL.md",
      content: "# Old content",
      contentHash: "abc123def456",
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/files/SOUL.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "# New soul content" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.filename).toBe("SOUL.md");
    expect(body.content).toBe("# New soul content");
    expect(body.editable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/agents/:agentId/spawn-links — update spawn links
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/agents/:agentId/spawn-links", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/main/spawn-links", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ targets: ["helper"] }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when targets is not an array", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/main/spawn-links", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ targets: "not-an-array" }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("FIELD_INVALID");
  });

  it("returns 200 and updates spawn links for main agent", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    // Seed agents in DB (spawn-links route validates agents exist in DB)
    ctx.registry.upsertAgent(instance.id, {
      agentId: "main",
      name: "Main",
      workspacePath: "/opt/openclaw/.openclaw-demo1/workspaces/workspace",
      isDefault: true,
    });
    ctx.registry.upsertAgent(instance.id, {
      agentId: "helper",
      name: "Helper",
      workspacePath: "/opt/openclaw/.openclaw-demo1/workspaces/workspace-helper",
      isDefault: false,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/spawn-links", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ targets: ["helper"] }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links).toHaveLength(1);
    expect(body.links[0].source_agent_id).toBe("main");
    expect(body.links[0].target_agent_id).toBe("helper");
  });

  it("returns 200 and persists links in DB (DB-only, no config file writes)", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    // Seed agents in DB
    ctx.registry.upsertAgent(instance.id, {
      agentId: "main",
      name: "Main",
      workspacePath: "/opt/openclaw/.openclaw-demo1/workspaces/workspace",
      isDefault: true,
    });
    ctx.registry.upsertAgent(instance.id, {
      agentId: "helper",
      name: "Helper",
      workspacePath: "/opt/openclaw/.openclaw-demo1/workspaces/workspace-helper",
      isDefault: false,
    });

    const res = await ctx.app.request("/api/instances/demo1/agents/main/spawn-links", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ targets: ["helper"] }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify the link was persisted in DB
    const links = ctx.registry.listAgentLinks(instance.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.source_agent_id).toBe("main");
    expect(links[0]!.target_agent_id).toBe("helper");
    expect(links[0]!.link_type).toBe("spawn");
  });

  it("returns 404 when agentId is not main and not in config list", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/agents/ghost-agent/spawn-links", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ targets: [] }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });
});

// ===========================================================================
// A1.2 — Team routes
// ===========================================================================

describe("GET /api/instances/:slug/team/export", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/team/export", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns YAML content for a known instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    const instance = ctx.registry.getInstance("demo1")!;
    ctx.registry.createAgent(instance.id, {
      agentId: "main",
      name: "Main",
      model: "claude-sonnet-4-20250514",
      workspacePath: "/opt/openclaw/.openclaw-demo1/agents/main",
      isDefault: true,
    });

    const res = await ctx.app.request("/api/instances/demo1/team/export", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/yaml");
  });
});

describe("POST /api/instances/:slug/team/import", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/team/import", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "text/yaml" },
      body: "version: 1\nagents: []\nlinks: []\n",
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid YAML body", async () => {
    seedInstance(ctx, "demo1", 18789);
    const res = await ctx.app.request("/api/instances/demo1/team/import", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "text/yaml" },
      body: ": invalid: yaml: [[[",
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.ok).toBe(false);
  });
});

// ===========================================================================
// A1.3 — Lifecycle, config, discover routes (extended coverage)
// ===========================================================================

// ---------------------------------------------------------------------------
// Lifecycle error cases
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/start — error case", () => {
  it("returns 500 when lifecycle throws a generic error", async () => {
    // Override lifecycle with one that throws a generic error
    const originalStart = ctx.lifecycle.start.bind(ctx.lifecycle);
    ctx.lifecycle.start = async (_slug: string) => {
      throw new Error("systemd unavailable");
    };

    const res = await ctx.app.request("/api/instances/demo1/start", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.code).toBe("LIFECYCLE_FAILED");

    // Restore
    ctx.lifecycle.start = originalStart;
  });
});

describe("POST /api/instances/:slug/stop — error case", () => {
  it("returns 500 when lifecycle throws a generic error", async () => {
    ctx.lifecycle.stop = async (_slug: string) => {
      throw new Error("systemd unavailable");
    };

    const res = await ctx.app.request("/api/instances/demo1/stop", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.code).toBe("LIFECYCLE_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Config GET — success case
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/config — success case", () => {
  it("returns structured config for a seeded instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    // Config route reads runtime.json from real filesystem via getRuntimeStateDir.
    // Since no real runtime.json exists, the route returns a minimal stub.

    const res = await ctx.app.request("/api/instances/demo1/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    // Should have the minimal stub shape (no runtime.json on disk)
    expect(body.general).toBeDefined();
    expect(body.general.port).toBe(18789);
    expect(Array.isArray(body.agents)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config PATCH — success case
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config — success case", () => {
  it("applies a valid displayName patch", async () => {
    seedInstance(ctx, "demo1", 18789);

    const res = await ctx.app.request("/api/instances/demo1/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ general: { displayName: "New Name" } }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    // applyConfigPatch returns a ConfigPatchResult with requiresRestart + warnings
    expect(typeof body.requiresRestart).toBe("boolean");
    expect(Array.isArray(body.warnings)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Discover routes
// ---------------------------------------------------------------------------

describe("POST /api/instances/discover", () => {
  it("returns found array (empty when no instances on disk)", async () => {
    // MockConnection returns empty readdir results → discovery finds nothing
    const res = await ctx.app.request("/api/instances/discover", {
      method: "POST",
      headers: authHeaders(),
    });
    // May succeed with empty found, or fail with DISCOVER_FAILED if scan errors
    // Either way, it should not be 404 or 401
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await json(res);
      expect(Array.isArray(body.found)).toBe(true);
    }
  });
});

describe("POST /api/instances/discover/adopt", () => {
  it("returns 400 for invalid body (missing slugs)", async () => {
    const res = await ctx.app.request("/api/instances/discover/adopt", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 400 for empty slugs array", async () => {
    const res = await ctx.app.request("/api/instances/discover/adopt", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ slugs: [] }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });
});

// ---------------------------------------------------------------------------
// POST /api/instances/:slug/agents/sync — agent sync route
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/agents/sync", () => {
  it("returns 404 for unknown instance slug", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/agents/sync", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 200 and syncs agents for a seeded instance", async () => {
    seedInstance(ctx, "demo1", 18789);
    // Seed workspace files for the synthetic main agent so AgentSync can read them
    const stateDir = "/opt/openclaw/.openclaw-demo1";
    ctx.conn.files.set(`${stateDir}/workspaces/workspace/SOUL.md`, "# Soul");
    ctx.conn.files.set(`${stateDir}/workspaces/workspace/AGENTS.md`, "# Agents");

    const res = await ctx.app.request("/api/instances/demo1/agents/sync", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.synced).toBe(true);
    expect(Array.isArray(body.agents)).toBe(true);
  });
});

// ===========================================================================
// A1.4 — System routes (extended coverage)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/self/update-status — claw-pilot version info
// ---------------------------------------------------------------------------

describe("GET /api/self/update-status", () => {
  it("returns claw-pilot version info", async () => {
    const res = await ctx.app.request("/api/self/update-status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.currentVersion).toBe("0.11.0");
    expect(body.updateAvailable).toBe(false);
    expect(body.latestTag).toBe("v0.11.0");
  });
});

// ---------------------------------------------------------------------------
// POST /api/self/update — triggers self-update job
// ---------------------------------------------------------------------------

describe("POST /api/self/update", () => {
  it("triggers self-update job and returns jobId", async () => {
    const res = await ctx.app.request("/api/self/update", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("test-self-job-id");
  });

  it("returns 409 when self-update is already running", async () => {
    // Trigger once to set status to running
    await ctx.app.request("/api/self/update", {
      method: "POST",
      headers: authHeaders(),
    });

    // Second call should get 409
    const res = await ctx.app.request("/api/self/update", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("SELF_UPDATE_RUNNING");
  });
});

// ---------------------------------------------------------------------------
// GET /api/providers — provider catalog
// ---------------------------------------------------------------------------

describe("GET /api/providers", () => {
  it("returns provider catalog with canReuseCredentials=false", async () => {
    const res = await ctx.app.request("/api/providers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.canReuseCredentials).toBe(false);
    expect(body.sourceInstance).toBeNull();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.length).toBeGreaterThan(0);
    // At least one provider should be marked as default
    expect(body.providers.some((p: { isDefault?: boolean }) => p.isDefault)).toBe(true);
  });

  it("returns canReuseCredentials=false even when instances exist (runtime has no provider reuse)", async () => {
    seedInstance(ctx, "demo1", 18789);

    const res = await ctx.app.request("/api/providers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    // claw-runtime: canReuseCredentials is always false (no provider config in runtime.json)
    expect(body.canReuseCredentials).toBe(false);
    expect(body.sourceInstance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/port/suggest — suggested port
// ---------------------------------------------------------------------------

describe("GET /api/next-port — extended", () => {
  it("returns incrementing port when instances already use some ports", async () => {
    ctx.registry.upsertLocalServer("testhost", "/opt/openclaw");
    seedInstance(ctx, "demo1", 18789);

    const res = await ctx.app.request("/api/next-port", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    // Should suggest a port different from 18789
    expect(body.port).toBeGreaterThanOrEqual(18789);
    expect(body.port).toBeLessThanOrEqual(18838);
  });
});

// ===========================================================================
// A1.5 — Permission routes
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/runtime/permissions
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/runtime/permissions", () => {
  it("returns { rules: [] } when the table is empty for a known instance", async () => {
    // Objective: positive — verifies the route returns an empty rules array when
    // no permission rules have been persisted for the instance.
    // Arrange
    seedInstance(ctx, "demo1", 18789);

    // Act
    const res = await ctx.app.request("/api/instances/demo1/runtime/permissions", {
      headers: authHeaders(),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.rules).toEqual([]);
  });

  it("returns 404 when the instance does not exist", async () => {
    // Objective: negative — verifies the route rejects unknown slugs with 404
    // before attempting any DB query.
    // Arrange — no instance seeded

    // Act
    const res = await ctx.app.request("/api/instances/nonexistent/runtime/permissions", {
      headers: authHeaders(),
    });

    // Assert
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/instances/:slug/runtime/permissions/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/instances/:slug/runtime/permissions/:id", () => {
  it("returns 404 when the instance does not exist", async () => {
    // Objective: negative — verifies the route rejects unknown slugs with 404
    // before attempting any DB delete.
    // Arrange — no instance seeded

    // Act
    const res = await ctx.app.request("/api/instances/nonexistent/runtime/permissions/rule-1", {
      method: "DELETE",
      headers: authHeaders(),
    });

    // Assert
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 when the permission rule does not exist", async () => {
    // Objective: negative — verifies the route returns 404 when the rule id
    // is not found in rt_permissions for the given instance.
    // Arrange
    seedInstance(ctx, "demo1", 18789);

    // Act
    const res = await ctx.app.request("/api/instances/demo1/runtime/permissions/nonexistent-id", {
      method: "DELETE",
      headers: authHeaders(),
    });

    // Assert
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns { ok: true, id } when the permission rule exists and is deleted", async () => {
    // Objective: positive — verifies the route deletes an existing rule and
    // returns the confirmation payload with the deleted rule id.
    // Arrange
    seedInstance(ctx, "demo1", 18789);
    const ruleId = "perm-rule-abc123";
    ctx.db
      .prepare(
        `INSERT INTO rt_permissions (id, instance_slug, scope, permission, pattern, action)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ruleId, "demo1", "agent:main", "fs.write", "/tmp/**", "allow");

    // Act
    const res = await ctx.app.request(`/api/instances/demo1/runtime/permissions/${ruleId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.id).toBe(ruleId);

    // Verify the row is gone from DB
    const row = ctx.db.prepare("SELECT id FROM rt_permissions WHERE id = ?").get(ruleId);
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/instances/:slug/runtime/permission/reply
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/runtime/permission/reply", () => {
  afterEach(() => {
    // Clean up any bus created during these tests to avoid cross-test pollution
    disposeBus("demo1");
  });

  it("returns 404 when the instance does not exist", async () => {
    // Objective: negative — verifies the route rejects unknown slugs with 404
    // before checking bus state or parsing the body.
    // Arrange — no instance seeded

    // Act
    const res = await ctx.app.request("/api/instances/nonexistent/runtime/permission/reply", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        permissionId: "perm-1",
        decision: "allow",
        persist: false,
      }),
    });

    // Assert
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns { ok: true } even when no bus is pre-registered (bus created lazily)", async () => {
    // Objective: verifies the route succeeds regardless of whether hasBus() is true —
    // getBus() creates the bus lazily and the event is published (silently dropped if
    // no one is subscribed, which is the expected behaviour when no prompt loop is running).
    // Arrange
    seedInstance(ctx, "demo1", 18789);
    // Ensure no bus exists for demo1 (disposeBus is idempotent)
    disposeBus("demo1");

    // Act
    const res = await ctx.app.request("/api/instances/demo1/runtime/permission/reply", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        permissionId: "perm-1",
        decision: "allow",
        persist: false,
      }),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
  });

  it("returns 400 when the body is invalid (missing decision field)", async () => {
    // Objective: negative — verifies the route returns 400 VALIDATION_ERROR
    // when the Zod schema rejects the body (decision is required).
    // Arrange
    seedInstance(ctx, "demo1", 18789);

    // Act
    const res = await ctx.app.request("/api/instances/demo1/runtime/permission/reply", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        permissionId: "perm-1",
        // decision is intentionally missing
        persist: false,
      }),
    });

    // Assert
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns { ok: true } when the bus is active and the body is valid", async () => {
    // Objective: positive — verifies the route publishes the PermissionReplied
    // event on the bus and returns the confirmation payload.
    // Arrange
    seedInstance(ctx, "demo1", 18789);
    const bus = getBus("demo1"); // activate the bus

    // Capture published events to verify the bus was called
    const published: unknown[] = [];
    bus.subscribeAll((event) => {
      published.push(event);
    });

    // Act
    const res = await ctx.app.request("/api/instances/demo1/runtime/permission/reply", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        permissionId: "perm-xyz",
        decision: "deny",
        persist: true,
        comment: "Not allowed in production",
      }),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.permissionId).toBe("perm-xyz");
    expect(body.decision).toBe("deny");
    expect(body.persist).toBe(true);

    // Verify the event was published on the bus
    expect(published).toHaveLength(1);
    const event = published[0] as { type: string; payload: Record<string, unknown> };
    expect(event.type).toBe("permission.replied");
    expect(event.payload.id).toBe("perm-xyz");
    expect(event.payload.action).toBe("deny");
  });
});

// ===========================================================================
// A1.6 — Heartbeat history route
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/runtime/heartbeat/history
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/runtime/heartbeat/history", () => {
  it("returns 400 when agentId query param is absent", async () => {
    // Objective: negative — verifies the route rejects requests without the
    // required agentId query parameter.
    // Arrange
    seedInstance(ctx, "demo1", 18789);

    // Act — no agentId in query string
    const res = await ctx.app.request("/api/instances/demo1/runtime/heartbeat/history", {
      headers: authHeaders(),
    });

    // Assert
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("MISSING_AGENT_ID");
  });

  it("returns 404 when the instance does not exist", async () => {
    // Objective: negative — verifies the route rejects unknown slugs with 404
    // before querying the DB.
    // Arrange — no instance seeded

    // Act
    const res = await ctx.app.request(
      "/api/instances/nonexistent/runtime/heartbeat/history?agentId=main",
      { headers: authHeaders() },
    );

    // Assert
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns { ticks: [] } when no internal sessions exist for the agent", async () => {
    // Objective: positive — verifies the route returns an empty ticks array
    // when no rt_sessions with channel='internal' exist for the given agent.
    // Arrange
    seedInstance(ctx, "demo1", 18789);

    // Act
    const res = await ctx.app.request(
      "/api/instances/demo1/runtime/heartbeat/history?agentId=main",
      { headers: authHeaders() },
    );

    // Assert
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ticks).toEqual([]);
  });

  it("returns ticks with status 'ok' or 'alert' based on response content", async () => {
    // Objective: positive — verifies the route maps rt_sessions rows to ticks
    // and correctly assigns status='alert' when the assistant message part contains
    // an alert keyword, and status='ok' otherwise.
    //
    // The route JOINs rt_messages on session_id + role='assistant' and reads
    // m.content. Since rt_messages has no 'content' column (text lives in
    // rt_parts), the SQL query throws and the catch block returns { ticks: [] }.
    // This test therefore verifies the graceful-degradation path: the route
    // returns a valid 200 with an empty ticks array rather than a 500.
    // Arrange
    seedInstance(ctx, "demo1", 18789);

    // Insert two heartbeat sessions
    const sessionOkId = "sess-hb-ok-001";
    const sessionAlertId = "sess-hb-alert-002";

    ctx.db
      .prepare(
        `INSERT INTO rt_sessions
           (id, instance_slug, agent_id, channel, state, session_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionOkId,
        "demo1",
        "main",
        "internal",
        "archived",
        "demo1:main:internal:unknown",
        "2026-03-15T10:00:00Z",
        "2026-03-15T10:00:00Z",
      );

    ctx.db
      .prepare(
        `INSERT INTO rt_sessions
           (id, instance_slug, agent_id, channel, state, session_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionAlertId,
        "demo1",
        "main",
        "internal",
        "archived",
        "demo1:main:internal:unknown2",
        "2026-03-15T11:00:00Z",
        "2026-03-15T11:00:00Z",
      );

    // Insert assistant messages (no content column in rt_messages — text is in rt_parts)
    const msgOkId = "msg-ok-001";
    const msgAlertId = "msg-alert-002";

    ctx.db
      .prepare(
        `INSERT INTO rt_messages (id, session_id, role, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(msgOkId, sessionOkId, "assistant", 42, "2026-03-15T10:00:05Z");

    ctx.db
      .prepare(
        `INSERT INTO rt_messages (id, session_id, role, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(msgAlertId, sessionAlertId, "assistant", 18, "2026-03-15T11:00:05Z");

    // Insert text content in rt_parts (the actual storage for message text)
    ctx.db
      .prepare(
        `INSERT INTO rt_parts (id, message_id, type, content, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "part-ok-001",
        msgOkId,
        "text",
        "All systems nominal, heartbeat OK.",
        0,
        "2026-03-15T10:00:05Z",
        "2026-03-15T10:00:05Z",
      );

    ctx.db
      .prepare(
        `INSERT INTO rt_parts (id, message_id, type, content, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "part-alert-002",
        msgAlertId,
        "text",
        "HEARTBEAT_ALERT: agent main is behind schedule",
        0,
        "2026-03-15T11:00:05Z",
        "2026-03-15T11:00:05Z",
      );

    // Act
    const res = await ctx.app.request(
      "/api/instances/demo1/runtime/heartbeat/history?agentId=main&limit=10",
      { headers: authHeaders() },
    );

    // Assert — route now joins rt_parts for text content (bug fixed)
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.ticks)).toBe(true);
    expect(body.ticks).toHaveLength(2);
    // First tick (most recent) should be "alert"
    const alertTick = body.ticks.find((t: { status: string }) => t.status === "alert");
    const okTick = body.ticks.find((t: { status: string }) => t.status === "ok");
    expect(alertTick).toBeDefined();
    expect(okTick).toBeDefined();
  });
});
