// src/dashboard/__tests__/mcp-routes.test.ts
//
// Integration tests for MCP server CRUD routes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// --- Mocks ---

vi.mock("../../lib/platform.js", () => ({
  getRuntimeStateDir: vi.fn(() => "/tmp/fake-state"),
}));
vi.mock("../../lib/env-reader.js", () => ({
  readEnvFileSync: vi.fn(() => ({})),
}));
vi.mock("../../runtime/index.js", () => ({
  runtimeConfigExists: vi.fn(() => false),
  loadRuntimeConfig: vi.fn(),
  createDefaultRuntimeConfig: vi.fn(() => minimalRuntimeConfig()),
}));
vi.mock("../../runtime/mcp/registry.js", () => {
  class MockMcpRegistry {
    async init() {}
    async dispose() {}
    getTools() {
      return [];
    }
    getStatus() {
      return {};
    }
    getClient() {
      return null;
    }
  }
  return { McpRegistry: MockMcpRegistry };
});

import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerMcpRoutes } from "../routes/instances/mcp.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { injectAdminUser } from "./_helpers/inject-admin-user.js";
import type { RuntimeConfig } from "../../runtime/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalRuntimeConfig(): RuntimeConfig {
  return {
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    agents: [],
    providers: [],
    mcpEnabled: false,
    mcpServers: [],
    compaction: { auto: true, threshold: 0.85, reservedTokens: 8000 },
    subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 5, retentionHours: 72 },
    telegram: {
      enabled: false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
    },
    artifacts: { suggestionsEnabled: true },
    models: [],
  } as unknown as RuntimeConfig;
}

const TEST_TOKEN = "test-mcp-token-64chars-hex-0123456789abcdef0123456789abcdef0000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-mcp-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    await next();
  });
  app.use("/api/*", injectAdminUser());

  const deps: RouteDeps = {
    registry,
    conn,
    db,
    startedAt: Date.now(),
    health: {} as unknown as RouteDeps["health"],
    lifecycle: {
      restart: vi.fn().mockResolvedValue(undefined),
    } as unknown as RouteDeps["lifecycle"],
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
      getProviders: vi.fn(() => []),
      invalidateProvider: () => {},
      getModelCatalog: () => [],
      findModel: () => undefined,
      start: () => {},
      stop: () => {},
    } as unknown as RouteDeps["modelDiscovery"],
  };

  app.use("/api/instances/:slug/*", instanceMiddleware(registry));
  registerMcpRoutes(app, deps);

  // Seed: server + instance with a config
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
  registry.saveRuntimeConfig("test-inst", minimalRuntimeConfig());
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/mcp/servers
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/mcp/servers", () => {
  it("returns empty list when no servers configured", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.mcpEnabled).toBe(false);
    expect(data.servers).toEqual([]);
  });

  it("returns configured servers with env values masked", async () => {
    registry.patchRuntimeConfig("test-inst", (c) => ({
      ...c,
      mcpEnabled: true,
      mcpServers: [
        {
          type: "local",
          id: "jira",
          command: "npx",
          args: ["@mcp/jira"],
          env: { JIRA_TOKEN: "secret123" },
          timeout: 30_000,
          enabled: true,
        },
      ],
    }));

    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.mcpEnabled).toBe(true);
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0].env.JIRA_TOKEN).toBe("••••••");
    expect(data.servers[0].command).toBe("npx");
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/api/instances/nope/mcp/servers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/instances/:slug/mcp/servers
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/mcp/servers", () => {
  it("adds a local MCP server", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        type: "local",
        id: "jira",
        command: "npx",
        args: ["@mcp/jira"],
        env: { JIRA_TOKEN: "secret123" },
      }),
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.server.id).toBe("jira");
    expect(data.server.command).toBe("npx");
    expect(data.server.env.JIRA_TOKEN).toBe("••••••");
    expect(data.restartRequired).toBe(true);

    // Verify persisted
    const config = registry.getRuntimeConfig("test-inst")!;
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0]!.id).toBe("jira");
    expect((config.mcpServers[0] as { env?: Record<string, string> }).env?.JIRA_TOKEN).toBe(
      "secret123",
    );
  });

  it("adds a remote MCP server", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        type: "remote",
        id: "myserver",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer tok" },
      }),
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.server.url).toBe("https://mcp.example.com");
    expect(data.server.headers.Authorization).toBe("••••••");
  });

  it("rejects duplicate server id", async () => {
    registry.patchRuntimeConfig("test-inst", (c) => ({
      ...c,
      mcpServers: [
        { type: "local", id: "jira", command: "npx", args: [], timeout: 30_000, enabled: true },
      ],
    }));

    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "local", id: "jira", command: "npx" }),
    });
    expect(res.status).toBe(409);
    const data = await json(res);
    expect(data.code).toBe("MCP_SERVER_DUPLICATE_ID");
  });

  it("rejects invalid id characters", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "local", id: "bad id!", command: "npx" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers", {
      method: "POST",
      headers: jsonHeaders(),
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/mcp/servers/:serverId
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/mcp/servers/:serverId", () => {
  beforeEach(() => {
    registry.patchRuntimeConfig("test-inst", (c) => ({
      ...c,
      mcpServers: [
        {
          type: "local",
          id: "jira",
          command: "npx",
          args: ["@mcp/jira"],
          env: { TOKEN: "abc", KEEP: "xyz" },
          timeout: 30_000,
          enabled: true,
        },
      ],
    }));
  });

  it("updates command and args", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/jira", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "local", command: "node", args: ["./jira.js"] }),
    });
    expect(res.status).toBe(200);
    const config = registry.getRuntimeConfig("test-inst")!;
    const srv = config.mcpServers.find((s) => s.id === "jira")!;
    expect((srv as { command: string }).command).toBe("node");
    expect((srv as { args: string[] }).args).toEqual(["./jira.js"]);
  });

  it("merges env — updates existing key, removes null key", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/jira", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "local", env: { TOKEN: "newtoken", KEEP: null } }),
    });
    expect(res.status).toBe(200);
    const config = registry.getRuntimeConfig("test-inst")!;
    const srv = config.mcpServers.find((s) => s.id === "jira")! as { env?: Record<string, string> };
    expect(srv.env?.TOKEN).toBe("newtoken");
    expect(srv.env?.KEEP).toBeUndefined();
  });

  it("toggles enabled", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/jira", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "local", enabled: false }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.restartRequired).toBe(true);
    const config = registry.getRuntimeConfig("test-inst")!;
    expect(config.mcpServers[0]!.enabled).toBe(false);
  });

  it("returns 404 for unknown server id", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/nope", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "local" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when type mismatches", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/jira", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "remote", url: "https://example.com" }),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("MCP_SERVER_TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/instances/:slug/mcp/servers/:serverId
// ---------------------------------------------------------------------------

describe("DELETE /api/instances/:slug/mcp/servers/:serverId", () => {
  beforeEach(() => {
    registry.patchRuntimeConfig("test-inst", (c) => ({
      ...c,
      mcpServers: [
        { type: "local", id: "jira", command: "npx", args: [], timeout: 30_000, enabled: true },
      ],
    }));
  });

  it("removes the server from config", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/jira", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.restartRequired).toBe(true);

    const config = registry.getRuntimeConfig("test-inst")!;
    expect(config.mcpServers).toHaveLength(0);
  });

  it("returns 404 for unknown server id", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/servers/nope", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/mcp/enabled
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/mcp/enabled", () => {
  it("enables MCP", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/enabled", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.mcpEnabled).toBe(true);
    expect(data.restartRequired).toBe(true);

    const config = registry.getRuntimeConfig("test-inst")!;
    expect(config.mcpEnabled).toBe(true);
  });

  it("disables MCP", async () => {
    registry.patchRuntimeConfig("test-inst", (c) => ({ ...c, mcpEnabled: true }));
    const res = await app.request("/api/instances/test-inst/mcp/enabled", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.mcpEnabled).toBe(false);
  });

  it("rejects invalid body", async () => {
    const res = await app.request("/api/instances/test-inst/mcp/enabled", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});
