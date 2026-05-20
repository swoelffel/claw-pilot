// src/dashboard/__tests__/instances-skills-routes.test.ts
//
// Routes test for the new instance-scoped structured skills API
// (SKILLS-002 Task 5). Mirrors the harness style used by
// skills-routes.test.ts (existing agent-level skills test).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { zipSync, strToU8, unzipSync } from "fflate";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { injectAdminUser } from "./_helpers/inject-admin-user.js";
import { registerInstanceSkillsRoutes } from "../routes/instances/skills.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function readJson(res: Response): Promise<Json> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestContext {
  app: Hono;
  registry: Registry;
  conn: MockConnection;
  db: ReturnType<typeof initDatabase>;
  tmpDir: string;
}

function createTestApp(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-iskills-test-"));
  const db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  const app = new Hono();

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
    health: { check: async () => ({}), checkAll: async () => [] } as unknown as RouteDeps["health"],
    lifecycle: {
      start: async () => {},
      stop: async () => {},
    } as unknown as RouteDeps["lifecycle"],
    monitor: {
      setTransitioning: () => {},
      clearTransitioning: () => {},
    } as unknown as RouteDeps["monitor"],
    selfUpdateChecker: {
      check: async () => ({
        currentVersion: "0.1.0",
        latestVersion: "0.1.0",
        updateAvailable: false,
      }),
      invalidateCache: () => {},
    } as unknown as RouteDeps["selfUpdateChecker"],
    selfUpdater: {
      getJob: () => ({ status: "idle", jobId: "" }),
    } as unknown as RouteDeps["selfUpdater"],
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
  registerInstanceSkillsRoutes(app, deps);

  return { app, registry, conn, db, tmpDir };
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function seedInstance(ctx: TestContext, slug: string, port: number): void {
  const server =
    ctx.registry.getLocalServer() ?? ctx.registry.upsertLocalServer("testhost", "/opt/openclaw");
  ctx.registry.createInstance({
    serverId: server.id,
    slug,
    port,
    configPath: `/opt/${slug}/runtime.json`,
    stateDir: path.join(ctx.tmpDir, slug),
    systemdUnit: `claw-runtime-${slug}`,
  });
}

function buildZip(entries: Record<string, string>): Uint8Array {
  const map: Record<string, Uint8Array> = {};
  for (const [p, content] of Object.entries(entries)) {
    map[p] = strToU8(content);
  }
  return zipSync(map);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
  seedInstance(ctx, "demo", 18790);
});

afterEach(() => {
  ctx.db.close();
  fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
});

describe("GET /api/instances/:slug/skills", () => {
  it("returns empty list when no skills", async () => {
    const res = await ctx.app.request("/api/instances/demo/skills", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await readJson(res);
    expect(data).toEqual({ skills: [] });
  });
});

describe("POST /api/instances/:slug/skills (blank)", () => {
  it("creates a blank skill and persists SKILL.md", async () => {
    const res = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "demo-skill", description: "d" }),
    });
    expect(res.status).toBe(201);
    const data = await readJson(res);
    expect(typeof data.id).toBe("string");

    const row = ctx.db.prepare("SELECT * FROM skills WHERE id = ?").get(data.id) as
      | { id: string; name: string; instance_slug: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toBe("demo-skill");
    expect(row?.instance_slug).toBe("demo");

    const files = ctx.db
      .prepare("SELECT path FROM skill_files WHERE skill_id = ?")
      .all(data.id) as Array<{ path: string }>;
    expect(files.map((f) => f.path)).toContain("SKILL.md");
  });
});

describe("POST /api/instances/:slug/skills (zip)", () => {
  it("creates a skill from a ZIP containing SKILL.md", async () => {
    const zipBuf = buildZip({
      "SKILL.md": "---\nname: zipped\n---\nbody",
      "extra.txt": "hi",
    });
    const fd = new FormData();
    fd.append("mode", "zip");
    const ab = new ArrayBuffer(zipBuf.byteLength);
    new Uint8Array(ab).set(zipBuf);
    fd.append("file", new Blob([ab], { type: "application/zip" }), "skill.zip");
    const res = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    expect(res.status).toBe(201);
    const data = await readJson(res);
    expect(typeof data.id).toBe("string");
  });

  it("rejects a ZIP without SKILL.md", async () => {
    const zipBuf = buildZip({ "other.txt": "no manifest here" });
    const fd = new FormData();
    fd.append("mode", "zip");
    const ab = new ArrayBuffer(zipBuf.byteLength);
    new Uint8Array(ab).set(zipBuf);
    fd.append("file", new Blob([ab], { type: "application/zip" }), "skill.zip");
    const res = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/instances/:slug/skills/:id", () => {
  it("updates name and description", async () => {
    const create = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "old", description: "old-d" }),
    });
    const { id } = (await readJson(create)) as { id: string };

    const res = await ctx.app.request(`/api/instances/demo/skills/${id}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "newname", description: "newd" }),
    });
    expect(res.status).toBe(200);
    const row = ctx.db.prepare("SELECT name, description FROM skills WHERE id = ?").get(id) as
      | { name: string; description: string }
      | undefined;
    expect(row?.name).toBe("newname");
    expect(row?.description).toBe("newd");
  });
});

describe("GET /api/instances/:slug/skills/:id (cross-instance)", () => {
  it("returns 404 for a skill from another instance", async () => {
    seedInstance(ctx, "other", 18791);
    const create = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "scoped", description: "d" }),
    });
    const { id } = (await readJson(create)) as { id: string };

    const res = await ctx.app.request(`/api/instances/other/skills/${id}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/instances/:slug/skills/:id/agents/:agentId", () => {
  it("assigns and returns 204", async () => {
    const create = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "assignable", description: "d" }),
    });
    const { id } = (await readJson(create)) as { id: string };

    const res = await ctx.app.request(`/api/instances/demo/skills/${id}/agents/agent-1`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(204);
    const row = ctx.db
      .prepare("SELECT * FROM agent_skills WHERE skill_id = ? AND agent_id = ?")
      .get(id, "agent-1");
    expect(row).toBeDefined();
  });
});

describe("DELETE /api/instances/:slug/skills/:id/agents/:agentId", () => {
  it("unassigns and returns 204", async () => {
    const create = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "unassignable", description: "d" }),
    });
    const { id } = (await readJson(create)) as { id: string };

    await ctx.app.request(`/api/instances/demo/skills/${id}/agents/agent-1`, {
      method: "POST",
      headers: authHeaders(),
    });
    const res = await ctx.app.request(`/api/instances/demo/skills/${id}/agents/agent-1`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(204);
    const row = ctx.db
      .prepare("SELECT * FROM agent_skills WHERE skill_id = ? AND agent_id = ?")
      .get(id, "agent-1");
    expect(row).toBeUndefined();
  });
});

describe("DELETE /api/instances/:slug/skills/:id", () => {
  it("cascades skill_files and agent_skills", async () => {
    const create = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "cascade", description: "d" }),
    });
    const { id } = (await readJson(create)) as { id: string };
    await ctx.app.request(`/api/instances/demo/skills/${id}/agents/agent-x`, {
      method: "POST",
      headers: authHeaders(),
    });

    const res = await ctx.app.request(`/api/instances/demo/skills/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(204);

    const files = ctx.db
      .prepare("SELECT * FROM skill_files WHERE skill_id = ?")
      .all(id) as unknown[];
    expect(files).toHaveLength(0);
    const assigns = ctx.db
      .prepare("SELECT * FROM agent_skills WHERE skill_id = ?")
      .all(id) as unknown[];
    expect(assigns).toHaveLength(0);
  });
});

describe("GET /api/instances/:slug/skills/:id/export", () => {
  it("returns a ZIP file", async () => {
    const create = await ctx.app.request("/api/instances/demo/skills", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mode: "blank", name: "exportable", description: "d" }),
    });
    const { id } = (await readJson(create)) as { id: string };

    const res = await ctx.app.request(`/api/instances/demo/skills/${id}/export`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType.toLowerCase()).toContain("zip");
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    expect(Object.keys(entries)).toContain("SKILL.md");
  });
});
