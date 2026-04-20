// src/dashboard/__tests__/named-keys-routes.test.ts
//
// Integration tests for the named-keys API routes.
// Uses Hono's in-memory request handling (no HTTP server needed).
// Real SQLite in-memory DB + minimal RouteDeps stub.

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerNamedKeyRoutes } from "../routes/named-keys.js";
import { TEST_ADMIN } from "./_helpers/inject-admin-user.js";

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
// Test harness
// ---------------------------------------------------------------------------

interface TestContext {
  app: Hono;
  db: ReturnType<typeof initDatabase>;
  tmpDir: string;
}

function createTestApp(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-named-keys-test-"));
  const db = initDatabase(path.join(tmpDir, "test.db"));
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  const app = new Hono();

  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    c.set("user", { ...TEST_ADMIN });
    await next();
  });

  const deps: RouteDeps = {
    db,
    conn,
    startedAt: Date.now(),
    registry: {} as unknown as RouteDeps["registry"],
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
      getModelCatalog: () => [],
      findModel: () => undefined,
      start: () => {},
      stop: () => {},
    } as unknown as RouteDeps["modelDiscovery"],
  };

  registerNamedKeyRoutes(app, deps);

  return { app, db, tmpDir };
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
// GET /api/named-keys
// ---------------------------------------------------------------------------

describe("GET /api/named-keys", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/named-keys");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no keys exist", async () => {
    const res = await ctx.app.request("/api/named-keys", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.keys).toEqual([]);
    expect(body.cryptoAvailable).toBe(true);
  });

  it("returns cryptoAvailable: false when MASTER_ENCRYPTION_KEY not set", async () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      const res = await ctx.app.request("/api/named-keys", { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.keys).toEqual([]);
      expect(body.cryptoAvailable).toBe(false);
    } finally {
      process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
    }
  });

  it("lists all keys after creation", async () => {
    // Create a key first
    await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "My Key",
        providerId: "anthropic",
        apiKey: "sk-ant-test-1234",
        defaultModel: "claude-3-5-sonnet",
      }),
    });

    const res = await ctx.app.request("/api/named-keys", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].name).toBe("My Key");
    expect(body.keys[0].providerId).toBe("anthropic");
    expect(body.keys[0].defaultModel).toBe("claude-3-5-sonnet");
    // apiKey must be masked, not the raw value
    expect(body.keys[0].apiKeyMasked).toBeDefined();
    expect(body.keys[0].apiKeyMasked).not.toBe("sk-ant-test-1234");
  });
});

// ---------------------------------------------------------------------------
// POST /api/named-keys
// ---------------------------------------------------------------------------

describe("POST /api/named-keys", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/named-keys", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("creates a key and returns it with masked apiKey", async () => {
    const res = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "Production Key",
        providerId: "openai",
        apiKey: "sk-prod-xxxxxxxxxxxx",
        defaultModel: "gpt-4o",
        baseUrl: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.key.name).toBe("Production Key");
    expect(body.key.providerId).toBe("openai");
    expect(body.key.defaultModel).toBe("gpt-4o");
    expect(body.key.apiKeyMasked).toBeDefined();
    expect(body.key.apiKeyMasked).not.toBe("sk-prod-xxxxxxxxxxxx");
    expect(body.key.id).toBeTypeOf("number");
    expect(body.key.createdAt).toBeDefined();
  });

  it("returns 400 for missing required fields", async () => {
    const res = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Incomplete" }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 503 when crypto is not available", async () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      const res = await ctx.app.request("/api/named-keys", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: "Key",
          providerId: "openai",
          apiKey: "sk-test",
          defaultModel: "gpt-4",
        }),
      });
      expect(res.status).toBe(503);
      const body = await json(res);
      expect(body.code).toBe("CRYPTO_UNAVAILABLE");
    } finally {
      process.env.MASTER_ENCRYPTION_KEY = TEST_MASTER_KEY;
    }
  });

  it("returns 409 on duplicate name", async () => {
    const payload = {
      name: "Duplicate",
      providerId: "openai",
      apiKey: "sk-first",
      defaultModel: "gpt-4",
    };

    await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });

    const res = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ...payload, apiKey: "sk-second" }),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("DUPLICATE_NAME");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/named-keys/:id
// ---------------------------------------------------------------------------

describe("PUT /api/named-keys/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/named-keys/1", { method: "PUT" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent key", async () => {
    const res = await ctx.app.request("/api/named-keys/9999", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("updates name and defaultModel", async () => {
    // Create a key first
    const createRes = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "Original",
        providerId: "anthropic",
        apiKey: "sk-ant-original",
        defaultModel: "claude-3-haiku",
      }),
    });
    const createBody = await json(createRes);
    const id = createBody.key.id;

    const res = await ctx.app.request(`/api/named-keys/${id}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Updated Name", defaultModel: "claude-3-5-sonnet" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.key.name).toBe("Updated Name");
    expect(body.key.defaultModel).toBe("claude-3-5-sonnet");
  });

  it("returns 409 on duplicate name", async () => {
    // Create two keys
    await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "Key A",
        providerId: "openai",
        apiKey: "sk-a",
        defaultModel: "gpt-4",
      }),
    });
    const createResB = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "Key B",
        providerId: "openai",
        apiKey: "sk-b",
        defaultModel: "gpt-4",
      }),
    });
    const createBodyB = await json(createResB);
    const idB = createBodyB.key.id;

    // Try to rename B to A (duplicate)
    const res = await ctx.app.request(`/api/named-keys/${idB}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Key A" }),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("DUPLICATE_NAME");
  });

  it("returns 400 for invalid body", async () => {
    const res = await ctx.app.request("/api/named-keys/1", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "bad json",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/named-keys/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/named-keys/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await ctx.app.request("/api/named-keys/1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent key", async () => {
    const res = await ctx.app.request("/api/named-keys/9999", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("deletes an unassigned key successfully", async () => {
    const createRes = await ctx.app.request("/api/named-keys", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "To Delete",
        providerId: "openai",
        apiKey: "sk-delete-me",
        defaultModel: "gpt-4",
      }),
    });
    const createBody = await json(createRes);
    const id = createBody.key.id;

    const res = await ctx.app.request(`/api/named-keys/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify it's gone
    const listRes = await ctx.app.request("/api/named-keys", { headers: authHeaders() });
    const listBody = await json(listRes);
    expect(listBody.keys).toHaveLength(0);
  });
});
