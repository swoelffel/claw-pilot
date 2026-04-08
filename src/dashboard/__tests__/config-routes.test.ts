// src/dashboard/__tests__/config-routes.test.ts
//
// Integration tests for the config API routes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// --- Mocks (must be before imports that use them) ---

vi.mock("../../lib/platform.js", () => ({
  getRuntimeStateDir: vi.fn(() => "/tmp/fake-state"),
}));
vi.mock("../../lib/dotenv.js", () => ({
  writeEnvVar: vi.fn().mockResolvedValue(undefined),
  removeEnvVar: vi.fn().mockResolvedValue(undefined),
  readEnvVar: vi.fn(() => null),
  maskSecret: vi.fn((s: string) => (s ? "sk-***" : "")),
}));
vi.mock("../../runtime/index.js", () => ({
  runtimeConfigExists: vi.fn(() => false),
  loadRuntimeConfig: vi.fn(),
  createDefaultRuntimeConfig: vi.fn(() => minimalRuntimeConfig()),
  exportRuntimeJsonSnapshot: vi.fn(),
}));
vi.mock("../../lib/crypto.js", () => ({
  isCryptoAvailable: vi.fn(() => false),
}));
vi.mock("../../lib/providers.js", () => ({
  PROVIDER_ENV_VARS: {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  } as Record<string, string>,
  PROVIDER_BASE_URLS: {} as Record<string, string>,
}));
vi.mock("../../core/repositories/named-key-repository.js", () => {
  class MockNamedKeyRepository {
    listAll() {
      return [];
    }
    setDefaultKeyForInstance() {}
  }
  return { NamedKeyRepository: MockNamedKeyRepository };
});

import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerConfigRoutes } from "../routes/instances/config.js";
import { writeEnvVar, removeEnvVar } from "../../lib/dotenv.js";
import { isCryptoAvailable } from "../../lib/crypto.js";
import type { RuntimeConfig } from "../../runtime/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalRuntimeConfig(): RuntimeConfig {
  return {
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    agents: [
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-sonnet-4-20250514",
        permissions: [],
        maxSteps: 20,
        allowSubAgents: false,
        toolProfile: "executor",
        isDefault: true,
        inheritWorkspace: true,
      },
    ],
    providers: [],
    mcpEnabled: false,
    mcpServers: [],
    compaction: { auto: true, threshold: 0.85, reservedTokens: 8000 },
    subagents: {
      maxSpawnDepth: 3,
      maxChildrenPerSession: 5,
      retentionHours: 72,
    },
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

const TEST_TOKEN = "test-config-token-64chars-hex-0123456789abcdef0123456789abcdef0";

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

/** Seed agent rows in the DB so saveRuntimeConfig/getRuntimeConfig round-trips agents correctly. */
function seedAgentsForInstance(
  dbRef: ReturnType<typeof initDatabase>,
  reg: Registry,
  slug: string,
  config: RuntimeConfig,
): void {
  const inst = reg.getInstance(slug);
  if (!inst) throw new Error(`Instance ${slug} not found`);
  for (const agent of config.agents) {
    reg.upsertAgent(inst.id, {
      agentId: agent.id,
      name: agent.name,
      model: agent.model ?? undefined,
      workspacePath: `/tmp/ws/${agent.id}`,
      isDefault: agent.isDefault ?? false,
      configJson: JSON.stringify(agent),
    });
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let tmpDir: string;
let lifecycle: RouteDeps["lifecycle"];

beforeEach(() => {
  vi.clearAllMocks();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-config-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });

  lifecycle = {
    restart: vi.fn().mockResolvedValue(undefined),
  } as unknown as RouteDeps["lifecycle"];

  const deps: RouteDeps = {
    registry,
    conn,
    db,
    startedAt: Date.now(),
    health: {} as unknown as RouteDeps["health"],
    lifecycle,
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
      getProviders: vi.fn(() => [
        { id: "anthropic", name: "Anthropic", isDefault: true, models: [] },
        { id: "openai", name: "OpenAI", isDefault: false, models: [] },
      ]),
      invalidateProvider: () => {},
      getModelCatalog: () => [],
      findModel: () => undefined,
      start: () => {},
      stop: () => {},
    } as unknown as RouteDeps["modelDiscovery"],
  };

  registerConfigRoutes(app, deps);

  // Seed: server + instance
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/config
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/config", () => {
  it("returns config from DB with agents and providers", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.general).toBeDefined();
    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThan(0);
    expect(data.agents[0].id).toBe("main");
  });

  it("returns stub when no config exists anywhere", async () => {
    // No saveRuntimeConfig, runtimeConfigExists returns false (default mock)
    const res = await app.request("/api/instances/test-inst/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    // Stub has general section with port
    expect(data.general).toBeDefined();
    expect(data.general.port).toBe(18789);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/unknown-slug/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("includes namedKeys when crypto is available", async () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(true);
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.namedKeys).toBeDefined();
    expect(Array.isArray(data.namedKeys)).toBe(true);
    expect(data.defaultNamedKeyId).toBeDefined();
  });

  it("returns 500 on internal error", async () => {
    // Force an error by making getRuntimeConfig throw
    const originalGet = registry.getRuntimeConfig.bind(registry);
    vi.spyOn(registry, "getRuntimeConfig").mockImplementation(() => {
      throw new Error("DB corruption");
    });

    const res = await app.request("/api/instances/test-inst/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
    const data = await json(res);
    expect(data.code).toBe("CONFIG_READ_FAILED");

    vi.mocked(registry.getRuntimeConfig).mockImplementation(originalGet);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/config
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config", () => {
  it("updates defaultModel and auto-restarts running instance", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);
    // Mark instance as running
    registry.updateInstanceState("test-inst", "running");

    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        general: { defaultModel: "openai/gpt-4o" },
      }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);
    // Since instance is running and lifecycle.restart succeeds, autoRestarted = true
    // so requiresRestart should be false (already restarted)
    expect(data.requiresRestart).toBe(false);
    expect(lifecycle.restart).toHaveBeenCalledWith("test-inst");
  });

  it("returns 400 INVALID_JSON for invalid JSON", async () => {
    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_JSON");
  });

  it("returns 400 INVALID_BODY for schema validation failure", async () => {
    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ general: { defaultModel: 12345 } }),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_BODY");
  });

  it("adds a provider and calls writeEnvVar", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        providers: {
          add: [{ id: "openai", apiKey: "sk-test-key" }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(writeEnvVar).toHaveBeenCalledWith(
      "/tmp/fake-state/.env",
      "OPENAI_API_KEY",
      "sk-test-key",
    );

    // Verify provider was actually added to the config
    const config = registry.getRuntimeConfig("test-inst");
    expect(config!.providers.some((p: { id: string }) => p.id === "openai")).toBe(true);
  });

  it("removes a provider and calls removeEnvVar", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    cfg.providers = [
      {
        id: "openai",
        authProfiles: [
          {
            id: "openai-default",
            providerId: "openai",
            apiKeyEnvVar: "OPENAI_API_KEY",
            priority: 0,
          },
        ],
      },
    ] as RuntimeConfig["providers"];
    cfg.defaultModel = "anthropic/claude-sonnet-4-20250514"; // not using openai
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        providers: { remove: ["openai"] },
      }),
    });
    expect(res.status).toBe(200);
    expect(removeEnvVar).toHaveBeenCalledWith("/tmp/fake-state/.env", "OPENAI_API_KEY");
  });

  it("rejects provider removal when default model uses that provider", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    cfg.defaultModel = "openai/gpt-4o";
    cfg.providers = [
      {
        id: "openai",
        authProfiles: [
          {
            id: "openai-default",
            providerId: "openai",
            apiKeyEnvVar: "OPENAI_API_KEY",
            priority: 0,
          },
        ],
      },
    ] as RuntimeConfig["providers"];
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        providers: { remove: ["openai"] },
      }),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("PROVIDER_IN_USE");
  });

  it("updates agent model and toolProfile", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        agents: [{ id: "main", model: "openai/gpt-4o", toolProfile: "pilot" }],
      }),
    });
    expect(res.status).toBe(200);

    const config = registry.getRuntimeConfig("test-inst");
    const main = config!.agents.find((a: { id: string }) => a.id === "main");
    expect(main!.model).toBe("openai/gpt-4o");
    expect(main!.toolProfile).toBe("pilot");
  });

  it("updates telegram channel settings", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        channels: {
          telegram: { enabled: true, dmPolicy: "allowlist" },
        },
      }),
    });
    expect(res.status).toBe(200);

    const config = registry.getRuntimeConfig("test-inst");
    expect(config!.telegram.enabled).toBe(true);
    expect(config!.telegram.dmPolicy).toBe("allowlist");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/unknown-slug/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ general: { defaultModel: "openai/gpt-4o" } }),
    });
    expect(res.status).toBe(404);
  });

  it("seeds default config when none exists and applies patch", async () => {
    // No saveRuntimeConfig call — config doesn't exist yet
    const res = await app.request("/api/instances/test-inst/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        general: { defaultModel: "openai/gpt-4o" },
      }),
    });
    expect(res.status).toBe(200);

    // Config should now exist after seeding + patching
    const config = registry.getRuntimeConfig("test-inst");
    expect(config).not.toBeNull();
    expect(config!.defaultModel).toBe("openai/gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/config/telegram/token
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config/telegram/token", () => {
  it("writes token via writeEnvVar", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config/telegram/token", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ token: "123456:ABC-DEF1234ghIkl-zyx57W2v" }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.configured).toBe(true);
    expect(writeEnvVar).toHaveBeenCalledWith(
      "/tmp/fake-state/.env",
      "TELEGRAM_BOT_TOKEN",
      "123456:ABC-DEF1234ghIkl-zyx57W2v",
    );
  });

  it("removes token via removeEnvVar when null", async () => {
    const cfg = minimalRuntimeConfig();
    seedAgentsForInstance(db, registry, "test-inst", cfg);
    registry.saveRuntimeConfig("test-inst", cfg);

    const res = await app.request("/api/instances/test-inst/config/telegram/token", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ token: null }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.configured).toBe(false);
    expect(removeEnvVar).toHaveBeenCalledWith("/tmp/fake-state/.env", "TELEGRAM_BOT_TOKEN");
  });

  it("returns 400 INVALID_BODY when token is not a string", async () => {
    const res = await app.request("/api/instances/test-inst/config/telegram/token", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ token: 12345 }),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_BODY");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/unknown-slug/config/telegram/token", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ token: "abc" }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/providers
// ---------------------------------------------------------------------------

describe("GET /api/providers", () => {
  it("returns providers list from modelDiscovery", async () => {
    const res = await app.request("/api/providers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.providers).toBeDefined();
    expect(data.providers).toHaveLength(2);
    expect(data.providers[0].id).toBe("anthropic");
    expect(data.providers[1].id).toBe("openai");
    expect(data.canReuseCredentials).toBe(false);
  });

  it("sets isDefault on first provider if none is default", async () => {
    // Override getProviders to return providers with no default
    const _deps = app as unknown as { routes: unknown };
    // Re-create app with providers that have no default
    const app2 = new Hono();
    const expectedBearer = `Bearer ${TEST_TOKEN}`;
    app2.use("/api/*", async (c, next) => {
      const auth = c.req.header("Authorization") ?? "";
      if (auth !== expectedBearer) {
        return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
      }
      await next();
    });

    const deps2: RouteDeps = {
      registry,
      conn: new MockConnection(),
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
      tokenCache: new TokenCache(new MockConnection()),
      xdgRuntimeDir: "/run/user/1000",
      sessionStore: new SessionStore(db),
      modelDiscovery: {
        getProviders: vi.fn(() => [
          { id: "anthropic", name: "Anthropic", isDefault: false, models: [] },
          { id: "openai", name: "OpenAI", isDefault: false, models: [] },
        ]),
        invalidateProvider: () => {},
        getModelCatalog: () => [],
        findModel: () => undefined,
        start: () => {},
        stop: () => {},
      } as unknown as RouteDeps["modelDiscovery"],
    };

    registerConfigRoutes(app2, deps2);

    const res = await app2.request("/api/providers", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await json(res);
    // First provider should have isDefault set to true
    expect(data.providers[0].isDefault).toBe(true);
  });
});
