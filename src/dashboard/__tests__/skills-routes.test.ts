// src/dashboard/__tests__/skills-routes.test.ts
//
// Tests for the skills dashboard routes (GET listing, POST install, DELETE).
// Uses real temp directories for skill files since listAvailableSkills reads the filesystem.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";

// ---------------------------------------------------------------------------
// Mock getRuntimeStateDir BEFORE importing the routes module
// ---------------------------------------------------------------------------

let mockStateDir = "/tmp/mock-state";

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...original,
    getRuntimeStateDir: () => mockStateDir,
  };
});

// Import AFTER mock setup so the route module picks up the mocked function
const { registerAgentSkillsRoutes } = await import("../routes/instances/agents/skills.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(res: Response): Promise<Json> {
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
  stateDir: string;
}

function createTestApp(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-skills-test-"));
  const db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  const stateDir = path.join(tmpDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  // Point the mock to this test's stateDir
  mockStateDir = stateDir;

  const app = new Hono();

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
    health: { check: async () => ({}), checkAll: async () => [] } as unknown as RouteDeps["health"],
    lifecycle: { start: async () => {}, stop: async () => {} } as unknown as RouteDeps["lifecycle"],
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
  };

  registerAgentSkillsRoutes(app, deps);

  return { app, registry, conn, db, tmpDir, stateDir };
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
    stateDir: ctx.stateDir,
    systemdUnit: `claw-runtime-${slug}`,
  });
}

/** Create a skill folder with SKILL.md in the stateDir */
async function createSkill(
  stateDir: string,
  name: string,
  description = "Test skill",
): Promise<void> {
  const skillDir = path.join(stateDir, "skills", name);
  await fsp.mkdir(skillDir, { recursive: true });
  await fsp.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nTest content`,
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

afterEach(() => {
  ctx.db.close();
  fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// GET /api/instances/:slug/skills
// ===========================================================================

describe("GET /api/instances/:slug/skills", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/instances/demo/skills");
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/skills", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty list when no skills exist", async () => {
    seedInstance(ctx, "demo", 18789);
    const res = await ctx.app.request("/api/instances/demo/skills", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.available).toBe(true);
    // Only workspace skills — global/remote dirs may have skills, but stateDir is fresh
    const wsSkills = body.skills.filter((s: Json) => s.source === "workspace");
    expect(wsSkills).toEqual([]);
  });

  it("returns workspace skills with correct metadata", async () => {
    seedInstance(ctx, "demo", 18789);
    await createSkill(ctx.stateDir, "my-skill", "Does cool stuff");
    await createSkill(ctx.stateDir, "another-skill", "Also great");

    const res = await ctx.app.request("/api/instances/demo/skills", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.available).toBe(true);

    const wsSkills = body.skills.filter((s: Json) => s.source === "workspace");
    expect(wsSkills).toHaveLength(2);

    const skill = wsSkills.find((s: Json) => s.name === "my-skill");
    expect(skill).toBeDefined();
    expect(skill.description).toBe("Does cool stuff");
    expect(skill.source).toBe("workspace");
    expect(skill.deletable).toBe(true);
  });
});

// ===========================================================================
// POST /api/instances/:slug/skills/install — GitHub install
// ===========================================================================

describe("POST /api/instances/:slug/skills/install", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/instances/demo/skills/install", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing url", async () => {
    seedInstance(ctx, "demo", 18789);
    const res = await ctx.app.request("/api/instances/demo/skills/install", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("MISSING_URL");
  });

  it("returns 400 for invalid GitHub URL format", async () => {
    seedInstance(ctx, "demo", 18789);
    const res = await ctx.app.request("/api/instances/demo/skills/install", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ url: "https://example.com/not-github" }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_GITHUB_URL");
  });

  it("returns 502 when GitHub API fails", async () => {
    seedInstance(ctx, "demo", 18789);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));

    try {
      const res = await ctx.app.request("/api/instances/demo/skills/install", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          url: "https://github.com/org/repo/tree/main/skills/my-skill",
        }),
      });
      expect(res.status).toBe(502);
      const body = await json(res);
      expect(body.code).toBe("GITHUB_FETCH_FAILED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 400 when SKILL.md is missing from GitHub directory", async () => {
    seedInstance(ctx, "demo", 18789);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: "README.md",
            path: "skills/my-skill/README.md",
            type: "file",
            download_url: "http://raw.example.com/README.md",
          },
        ]),
        { status: 200 },
      ),
    );

    try {
      const res = await ctx.app.request("/api/instances/demo/skills/install", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          url: "https://github.com/org/repo/tree/main/skills/my-skill",
        }),
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.code).toBe("NO_SKILL_MD");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("installs skill from GitHub successfully", async () => {
    seedInstance(ctx, "demo", 18789);

    const skillContent = "---\nname: test-skill\ndescription: From GitHub\n---\n# Test";
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // GitHub Contents API — directory listing
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                name: "SKILL.md",
                path: "skills/test-skill/SKILL.md",
                type: "file",
                download_url: "http://raw.example.com/SKILL.md",
              },
            ]),
            { status: 200 },
          ),
        );
      }
      // Download SKILL.md content
      return Promise.resolve(new Response(skillContent, { status: 200 }));
    });

    try {
      const res = await ctx.app.request("/api/instances/demo/skills/install", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          url: "https://github.com/org/repo/tree/main/skills/test-skill",
        }),
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(body.name).toBe("test-skill");
      expect(body.filesCount).toBe(1);

      // Verify the file was written to disk
      const written = await fsp.readFile(
        path.join(ctx.stateDir, "skills", "test-skill", "SKILL.md"),
        "utf-8",
      );
      expect(written).toBe(skillContent);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ===========================================================================
// DELETE /api/instances/:slug/skills/:name
// ===========================================================================

describe("DELETE /api/instances/:slug/skills/:name", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/instances/demo/skills/my-skill", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await ctx.app.request("/api/instances/nonexistent/skills/my-skill", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent skill", async () => {
    seedInstance(ctx, "demo", 18789);
    const res = await ctx.app.request("/api/instances/demo/skills/does-not-exist", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("deletes a workspace skill successfully", async () => {
    seedInstance(ctx, "demo", 18789);
    await createSkill(ctx.stateDir, "doomed-skill");

    // Verify it exists
    expect(fs.existsSync(path.join(ctx.stateDir, "skills", "doomed-skill", "SKILL.md"))).toBe(true);

    const res = await ctx.app.request("/api/instances/demo/skills/doomed-skill", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify it's gone
    expect(fs.existsSync(path.join(ctx.stateDir, "skills", "doomed-skill"))).toBe(false);
  });
});
