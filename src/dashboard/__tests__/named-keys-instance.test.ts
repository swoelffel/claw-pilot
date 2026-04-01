// src/dashboard/__tests__/named-keys-instance.test.ts
//
// Integration tests for defaultNamedKeyId support in the instance config routes.
// Tests GET /api/instances/:slug/config (namedKeys + defaultNamedKeyId fields) and
// PATCH /api/instances/:slug/config (defaultNamedKeyId).

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
// PATCH /api/instances/:slug/config — defaultNamedKeyId
// ---------------------------------------------------------------------------

describe("PATCH /api/instances/:slug/config — defaultNamedKeyId", () => {
  it("sets the default named key for an instance", async () => {
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
        defaultNamedKeyId: namedKey.id,
      }),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify in DB
    const instance = ctx.registry.getInstance("alpha")!;
    const row = ctx.db
      .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
      .get(instance.id) as { default_named_key_id: number | null };
    expect(row.default_named_key_id).toBe(namedKey.id);
  });

  it("clears the default key when set to null", async () => {
    seedInstance(ctx, "beta", 18801);
    const key = ctx.namedKeyRepo.create({
      name: "Key One",
      providerId: "anthropic",
      apiKey: "sk-ant-key1",
      defaultModel: "claude-3-haiku",
    });
    const instance = ctx.registry.getInstance("beta")!;
    ctx.namedKeyRepo.setDefaultKeyForInstance(instance.id, key.id);

    const res = await ctx.app.request("/api/instances/beta/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        defaultNamedKeyId: null,
      }),
    });

    expect(res.status).toBe(200);
    const row = ctx.db
      .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
      .get(instance.id) as { default_named_key_id: number | null };
    expect(row.default_named_key_id).toBeNull();
  });

  it("returns 503 when MASTER_ENCRYPTION_KEY is not set", async () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      seedInstance(ctx, "gamma", 18802);
      const res = await ctx.app.request("/api/instances/gamma/config", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({
          defaultNamedKeyId: 1,
        }),
      });

      expect(res.status).toBe(503);
      const body = await json(res);
      expect(body.code).toBe("CRYPTO_UNAVAILABLE");
    } finally {
      process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
    }
  });

  it("changes the default key", async () => {
    seedInstance(ctx, "delta", 18803);
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
    const instance = ctx.registry.getInstance("delta")!;
    ctx.namedKeyRepo.setDefaultKeyForInstance(instance.id, key1.id);

    // Switch default to key2
    const res = await ctx.app.request("/api/instances/delta/config", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        defaultNamedKeyId: key2.id,
      }),
    });

    expect(res.status).toBe(200);
    const row = ctx.db
      .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
      .get(instance.id) as { default_named_key_id: number | null };
    expect(row.default_named_key_id).toBe(key2.id);
  });
});

// ---------------------------------------------------------------------------
// GET /api/instances/:slug/config — namedKeys + defaultNamedKeyId
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/config — namedKeys + defaultNamedKeyId", () => {
  it("returns namedKeys as all global keys and defaultNamedKeyId as null when none set", async () => {
    seedInstance(ctx, "theta", 18807);

    const res = await ctx.app.request("/api/instances/theta/config", {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.namedKeys).toBeDefined();
    expect(Array.isArray(body.namedKeys)).toBe(true);
    expect(body.namedKeys).toHaveLength(0);
    expect(body.defaultNamedKeyId).toBeNull();
  });

  it("returns all global named keys and the instance defaultNamedKeyId", async () => {
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
    ctx.namedKeyRepo.setDefaultKeyForInstance(instance.id, key1.id);

    const res = await ctx.app.request("/api/instances/iota/config", {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.namedKeys)).toBe(true);
    // All global keys are returned
    expect(body.namedKeys).toHaveLength(2);
    expect(body.namedKeys.map((k: Json) => k.name)).toContain("Prod Key");
    expect(body.namedKeys.map((k: Json) => k.name)).toContain("Dev Key");
    // defaultNamedKeyId points to key1
    expect(body.defaultNamedKeyId).toBe(key1.id);
  });

  it("returns empty namedKeys and null defaultNamedKeyId when crypto is unavailable", async () => {
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
      expect(body.defaultNamedKeyId).toBeNull();
    } finally {
      process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
    }
  });
});
