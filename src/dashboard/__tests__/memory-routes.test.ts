// src/dashboard/__tests__/memory-routes.test.ts
//
// Integration tests for the memory browser API routes.

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
import { registerMemoryRoutes } from "../routes/instances/memory.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-memory-token-64chars-hex-0123456789abcdef0123456789abcde00";

const STATE_DIR = "/tmp/state";
const WS_DIR = `${STATE_DIR}/workspaces/pilot`;

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
let conn: MockConnection;
let tmpDir: string;

function seedMemoryFiles(): void {
  // Mark workspace directory as existing
  conn.dirs.add(WS_DIR);
  conn.dirs.add(`${WS_DIR}/memory`);

  // MEMORY.md
  conn.files.set(
    `${WS_DIR}/MEMORY.md`,
    "# Memory Index\n\n- [facts](memory/facts.md)\n- [decisions](memory/decisions.md)\n",
  );

  // memory/facts.md
  conn.files.set(
    `${WS_DIR}/memory/facts.md`,
    "## 2026-03-22\n- [0.9] Project uses TypeScript with strict mode\n- [0.5] Old fact about legacy code\n",
  );

  // memory/decisions.md
  conn.files.set(
    `${WS_DIR}/memory/decisions.md`,
    "## 2026-03-22\n- [0.8] Chose SQLite over PostgreSQL for simplicity\n",
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-memory-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  // Mock stat command for lastModified
  conn.mockExec("stat", {
    stdout: `${Math.floor(Date.now() / 1000)} /tmp`,
    stderr: "",
    exitCode: 0,
  });

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

  registerMemoryRoutes(app, deps);

  // Seed an instance with an agent
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  const instance = registry.createInstance({
    serverId: server.id,
    slug: "demo",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: STATE_DIR,
    systemdUnit: "claw-demo",
  });
  registry.createAgent(instance.id, {
    agentId: "pilot",
    name: "Pilot",
    model: "claude-sonnet-4-6",
    workspacePath: "pilot",
    isDefault: true,
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/memory/agents
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/memory/agents", () => {
  it("returns agents with memory files", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/agents", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].agentId).toBe("pilot");
    expect(body.agents[0].name).toBe("Pilot");
    expect(body.agents[0].fileCount).toBe(3);
    expect(body.agents[0].totalSize).toBeGreaterThan(0);
  });

  it("returns empty array when no workspace exists", async () => {
    const res = await app.request("/api/instances/demo/memory/agents", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agents).toHaveLength(0);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/unknown/memory/agents", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/memory/agents/:agentId/files
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/memory/agents/:agentId/files", () => {
  it("returns file list for agent", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/agents/pilot/files", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agentId).toBe("pilot");
    expect(body.files).toHaveLength(3);
    expect(body.files[0].path).toBe("MEMORY.md");
    expect(body.files[0].size).toBeGreaterThan(0);
    expect(body.files[1].path).toBe("memory/decisions.md");
    expect(body.files[2].path).toBe("memory/facts.md");
  });

  it("returns 404 for unknown agent", async () => {
    const res = await app.request("/api/instances/demo/memory/agents/unknown/files", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty files when no workspace", async () => {
    const res = await app.request("/api/instances/demo/memory/agents/pilot/files", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/memory/agents/:agentId/files/:filename
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/memory/agents/:agentId/files/:filename", () => {
  it("returns file content", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/agents/pilot/files/memory/facts.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agentId).toBe("pilot");
    expect(body.path).toBe("memory/facts.md");
    expect(body.content).toContain("[0.9] Project uses TypeScript");
    expect(body.size).toBeGreaterThan(0);
  });

  it("returns MEMORY.md content", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/agents/pilot/files/MEMORY.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.path).toBe("MEMORY.md");
    expect(body.content).toContain("# Memory Index");
  });

  it("returns 404 for nonexistent file", async () => {
    seedMemoryFiles();

    const res = await app.request(
      "/api/instances/demo/memory/agents/pilot/files/memory/nonexistent.md",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(404);
  });

  it("rejects path traversal", async () => {
    seedMemoryFiles();

    // URL-encoded path traversal attempt
    const res = await app.request(
      "/api/instances/demo/memory/agents/pilot/files/..%2F..%2Fetc%2Fpasswd",
      { headers: authHeaders() },
    );
    // Hono resolves `../` in the URL path, so the route may not match at all (404)
    // or the regex validation catches it (400). Either way, content must not be returned.
    expect(res.status === 400 || res.status === 404).toBe(true);
  });

  it("rejects non-memory paths", async () => {
    const res = await app.request("/api/instances/demo/memory/agents/pilot/files/SOUL.md", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/memory/search
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/memory/search", () => {
  it("returns matching results", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/search?q=TypeScript", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.query).toBe("TypeScript");
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].agentId).toBe("pilot");
    expect(body.results[0].source).toBe("memory/facts.md");
    expect(body.results[0].snippet).toContain("TypeScript");
    expect(body.results[0].line).toBeGreaterThan(0);
  });

  it("returns 400 when query is missing", async () => {
    const res = await app.request("/api/instances/demo/memory/search", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("MISSING_QUERY");
  });

  it("returns empty results for no matches", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/search?q=xyznonexistent", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.results).toHaveLength(0);
  });

  it("is case-insensitive", async () => {
    seedMemoryFiles();

    const res = await app.request("/api/instances/demo/memory/search?q=typescript", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.results.length).toBeGreaterThan(0);
  });
});
