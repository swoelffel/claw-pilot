// src/dashboard/__tests__/named-keys-instance.test.ts
//
// Integration tests for namedKeys support in the instance config routes.
// Tests GET /api/instances/:slug/config (namedKeys field) and
// PATCH /api/instances/:slug/config (namedKeys.assign/remove/setDefault).

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
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
import { NamedKeyRepository } from "../../core/repositories/named-key-repository.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";
const TEST_MASTER_KEY = "a".repeat(64); // valid 64-char hex for AES-256

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(res: Response): Promise<Json> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Stub classes
// ---------------------------------------------------------------------------

class StubLifecycle {
  async start(_slug: string): Promise<void> {}
  async stop(_slug: string): Promise<void> {}
  async restart(_slug: string): Promise<void> {}
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
  namedKeyRepo: NamedKeyRepository;
}

function createTestApp(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-nk-instance-test-"));
  const db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);
  const namedKeyRepo = new NamedKeyRepository(db);

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
    health: {} as unknown as RouteDeps["health"],
    lifecycle: new StubLifecycle() as unknown as RouteDeps["lifecycle"],
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

  registerInstanceRoutes(app, deps);

  return { app, registry, conn, db, tmpDir, namedKeyRepo };
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

/** Create a test instance in the registry + mock filesystem. */
function seedInstance(ctx: TestContext, slug: string, port: number): void {
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
  ctx.conn.files.set(
    `/opt/openclaw/.openclaw-${slug}/.env`,
    `OPENCLAW_GW_AUTH_TOKEN=gw-token-${slug}\n`,
  );
  ctx.conn.files.set(
    `/opt/openclaw/.openclaw-${slug}/runtime.json`,
    JSON.stringify({
      defaultModel: "claude-sonnet-4-20250514",
      agents: [],
      port,
    }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle — set/unset MASTER_ENCRYPTION_KEY
// ---------------------------------------------------------------------------

let ctx: TestContext;

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
});

afterAll(() => {
  delete process.env.MASTER_ENCRYPTION_KEY;
});

beforeEach(() => {
  ctx = createTestApp();
});

afterEach(() => {
  ctx.db.close();
  fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/config — namedKeys.assign
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config — namedKeys.assign", () => {
  it("assigns a named key to an instance", async () => {
    seedInstance(ctx, "alpha", 18800);
    const namedKey = ctx.namedKeyRepo.create({
      name: "My Key",
      providerId: "anthropic",
      apiKey: "sk-ant-test-1234",
      defaultModel: "claude-3-5-sonnet",
    });

    const res = await ctx.app.request("/api/instances/alpha/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        namedKeys: {
          assign: [{ namedKeyId: namedKey.id }],
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify assignment in DB
    const instance = ctx.registry.getInstance("alpha")!;
    const keys = ctx.namedKeyRepo.getInstanceKeys(instance.id);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.namedKeyId).toBe(namedKey.id);
    expect(keys[0]!.name).toBe("My Key");
    expect(keys[0]!.isDefault).toBe(false);
  });

  it("can assign multiple named keys", async () => {
    seedInstance(ctx, "beta", 18801);
    const key1 = ctx.namedKeyRepo.create({
      name: "Key One",
      providerId: "anthropic",
      apiKey: "sk-ant-key1",
      defaultModel: "claude-3-haiku",
    });
    const key2 = ctx.namedKeyRepo.create({
      name: "Key Two",
      providerId: "openai",
      apiKey: "sk-openai-key2",
      defaultModel: "gpt-4o",
    });

    const res = await ctx.app.request("/api/instances/beta/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        namedKeys: {
          assign: [{ namedKeyId: key1.id }, { namedKeyId: key2.id }],
        },
      }),
    });

    expect(res.status).toBe(200);
    const instance = ctx.registry.getInstance("beta")!;
    const keys = ctx.namedKeyRepo.getInstanceKeys(instance.id);
    expect(keys).toHaveLength(2);
  });

  it("returns 503 when MASTER_ENCRYPTION_KEY is not set", async () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      seedInstance(ctx, "gamma", 18802);
      const res = await ctx.app.request("/api/instances/gamma/config", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({
          namedKeys: {
            assign: [{ namedKeyId: 1 }],
          },
        }),
      });

      expect(res.status).toBe(503);
      const body = await json(res);
      expect(body.code).toBe("CRYPTO_UNAVAILABLE");
    } finally {
      process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/config — namedKeys.setDefault
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config — namedKeys.setDefault", () => {
  it("sets the default named key for an instance", async () => {
    seedInstance(ctx, "delta", 18803);
    const key1 = ctx.namedKeyRepo.create({
      name: "Default Candidate",
      providerId: "anthropic",
      apiKey: "sk-ant-default",
      defaultModel: "claude-3-5-sonnet",
    });
    const key2 = ctx.namedKeyRepo.create({
      name: "Secondary Key",
      providerId: "anthropic",
      apiKey: "sk-ant-secondary",
      defaultModel: "claude-3-haiku",
    });
    const instance = ctx.registry.getInstance("delta")!;
    ctx.namedKeyRepo.assignToInstance(instance.id, key1.id, false);
    ctx.namedKeyRepo.assignToInstance(instance.id, key2.id, false);

    const res = await ctx.app.request("/api/instances/delta/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        namedKeys: {
          setDefault: { namedKeyId: key1.id },
        },
      }),
    });

    expect(res.status).toBe(200);
    const keys = ctx.namedKeyRepo.getInstanceKeys(instance.id);
    const defaultKey = keys.find((k) => k.isDefault);
    expect(defaultKey).toBeDefined();
    expect(defaultKey!.namedKeyId).toBe(key1.id);

    // The other key should not be default
    const nonDefault = keys.find((k) => k.namedKeyId === key2.id);
    expect(nonDefault!.isDefault).toBe(false);
  });

  it("changes the default key atomically", async () => {
    seedInstance(ctx, "epsilon", 18804);
    const key1 = ctx.namedKeyRepo.create({
      name: "First Key",
      providerId: "anthropic",
      apiKey: "sk-ant-first",
      defaultModel: "claude-3-5-sonnet",
    });
    const key2 = ctx.namedKeyRepo.create({
      name: "Second Key",
      providerId: "anthropic",
      apiKey: "sk-ant-second",
      defaultModel: "claude-3-haiku",
    });
    const instance = ctx.registry.getInstance("epsilon")!;
    ctx.namedKeyRepo.assignToInstance(instance.id, key1.id, true); // key1 starts as default
    ctx.namedKeyRepo.assignToInstance(instance.id, key2.id, false);

    // Switch default to key2
    const res = await ctx.app.request("/api/instances/epsilon/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        namedKeys: {
          setDefault: { namedKeyId: key2.id },
        },
      }),
    });

    expect(res.status).toBe(200);
    const keys = ctx.namedKeyRepo.getInstanceKeys(instance.id);
    const defaultKey = keys.find((k) => k.isDefault);
    expect(defaultKey!.namedKeyId).toBe(key2.id);

    const formerDefault = keys.find((k) => k.namedKeyId === key1.id);
    expect(formerDefault!.isDefault).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/instances/:slug/config — namedKeys.remove
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config — namedKeys.remove", () => {
  it("removes a named key assignment from an instance", async () => {
    seedInstance(ctx, "zeta", 18805);
    const key = ctx.namedKeyRepo.create({
      name: "To Remove",
      providerId: "openai",
      apiKey: "sk-remove-me",
      defaultModel: "gpt-4o",
    });
    const instance = ctx.registry.getInstance("zeta")!;
    ctx.namedKeyRepo.assignToInstance(instance.id, key.id, false);

    expect(ctx.namedKeyRepo.getInstanceKeys(instance.id)).toHaveLength(1);

    const res = await ctx.app.request("/api/instances/zeta/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        namedKeys: {
          remove: [{ namedKeyId: key.id }],
        },
      }),
    });

    expect(res.status).toBe(200);
    const keys = ctx.namedKeyRepo.getInstanceKeys(instance.id);
    expect(keys).toHaveLength(0);
  });

  it("can combine assign and remove in a single patch", async () => {
    seedInstance(ctx, "eta", 18806);
    const keyToRemove = ctx.namedKeyRepo.create({
      name: "Old Key",
      providerId: "anthropic",
      apiKey: "sk-ant-old",
      defaultModel: "claude-3-haiku",
    });
    const keyToAssign = ctx.namedKeyRepo.create({
      name: "New Key",
      providerId: "anthropic",
      apiKey: "sk-ant-new",
      defaultModel: "claude-3-5-sonnet",
    });
    const instance = ctx.registry.getInstance("eta")!;
    ctx.namedKeyRepo.assignToInstance(instance.id, keyToRemove.id, false);

    const res = await ctx.app.request("/api/instances/eta/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        namedKeys: {
          assign: [{ namedKeyId: keyToAssign.id }],
          remove: [{ namedKeyId: keyToRemove.id }],
        },
      }),
    });

    expect(res.status).toBe(200);
    const keys = ctx.namedKeyRepo.getInstanceKeys(instance.id);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.namedKeyId).toBe(keyToAssign.id);
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/config — namedKeys field
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/config — namedKeys field", () => {
  it("returns namedKeys as empty array when none are assigned", async () => {
    seedInstance(ctx, "theta", 18807);

    const res = await ctx.app.request("/api/instances/theta/config", {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.namedKeys).toBeDefined();
    expect(Array.isArray(body.namedKeys)).toBe(true);
    expect(body.namedKeys).toHaveLength(0);
  });

  it("returns assigned named keys with their metadata", async () => {
    seedInstance(ctx, "iota", 18808);
    const key1 = ctx.namedKeyRepo.create({
      name: "Prod Key",
      providerId: "anthropic",
      apiKey: "sk-ant-prod",
      defaultModel: "claude-3-5-sonnet",
    });
    const key2 = ctx.namedKeyRepo.create({
      name: "Dev Key",
      providerId: "openai",
      apiKey: "sk-openai-dev",
      defaultModel: "gpt-4o",
    });
    const instance = ctx.registry.getInstance("iota")!;
    ctx.namedKeyRepo.assignToInstance(instance.id, key1.id, true); // key1 is default
    ctx.namedKeyRepo.assignToInstance(instance.id, key2.id, false);

    const res = await ctx.app.request("/api/instances/iota/config", {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.namedKeys)).toBe(true);
    expect(body.namedKeys).toHaveLength(2);

    const defaultKey = body.namedKeys.find((k: Json) => k.isDefault === true);
    expect(defaultKey).toBeDefined();
    expect(defaultKey.namedKeyId).toBe(key1.id);
    expect(defaultKey.name).toBe("Prod Key");
    expect(defaultKey.providerId).toBe("anthropic");
    expect(defaultKey.defaultModel).toBe("claude-3-5-sonnet");
  });

  it("returns empty namedKeys when crypto is unavailable", async () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      seedInstance(ctx, "kappa", 18809);

      const res = await ctx.app.request("/api/instances/kappa/config", {
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.namedKeys).toBeDefined();
      expect(body.namedKeys).toHaveLength(0);
    } finally {
      process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
    }
  });
});
