// src/dashboard/__tests__/auth-routes.test.ts
//
// Integration tests for the auth routes (login / logout / me).
// Uses Hono's in-memory request handling — no real HTTP server.
// Real SQLite in-memory DB, real SessionStore, real password hashing.

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { SessionStore } from "../session-store.js";
import { hashPassword } from "../../core/auth.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { constants } from "../../lib/constants.js";
import type { RouteDeps } from "../route-deps.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";
const TEST_PASSWORD = "TestPassword123!";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(res: Response): Promise<Json> {
  return res.json();
}

/** Extract the value of a Set-Cookie header by cookie name. */
function getCookieValue(res: Response, name: string): string | undefined {
  const header = res.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`));
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestCtx {
  app: Hono;
  sessionStore: SessionStore;
  db: ReturnType<typeof initDatabase>;
}

async function createTestApp(): Promise<TestCtx> {
  const db = initDatabase(":memory:");
  const registry = new Registry(db);
  const conn = new MockConnection();
  const sessionStore = new SessionStore(db);

  // Insert admin user with known password
  const hash = await hashPassword(TEST_PASSWORD);
  db.prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
  ).run(constants.ADMIN_USERNAME, hash);

  const deps: RouteDeps = {
    registry,
    conn,
    sessionStore,
    // The following are not used by auth routes — cast to satisfy the type
    tokenCache: null as unknown as RouteDeps["tokenCache"],
    lifecycle: null as unknown as RouteDeps["lifecycle"],
    health: null as unknown as RouteDeps["health"],
    updateChecker: null as unknown as RouteDeps["updateChecker"],
    updater: null as unknown as RouteDeps["updater"],
    selfUpdateChecker: null as unknown as RouteDeps["selfUpdateChecker"],
    selfUpdater: null as unknown as RouteDeps["selfUpdater"],
    xdgRuntimeDir: "",
  };

  const app = new Hono();
  registerAuthRoutes(app, deps, TEST_TOKEN);

  return { app, sessionStore, db };
}

/** Perform a login and return the full Response. */
async function doLogin(
  app: Hono,
  username: string = constants.ADMIN_USERNAME,
  password: string = TEST_PASSWORD,
): Promise<Response> {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/** Extract the session cookie value from a login response. */
function extractSessionCookie(res: Response): string | undefined {
  return getCookieValue(res, constants.SESSION_COOKIE_NAME);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("returns 200 + token on valid credentials", async () => {
    const res = await doLogin(ctx.app);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.token).toBe(TEST_TOKEN);
  });

  it("sets a session cookie on successful login", async () => {
    const res = await doLogin(ctx.app);
    const sid = extractSessionCookie(res);
    expect(sid).toBeTruthy();
    expect(typeof sid).toBe("string");
    expect((sid as string).length).toBeGreaterThan(0);
  });

  it("returns 401 on wrong password", async () => {
    const res = await doLogin(ctx.app, constants.ADMIN_USERNAME, "wrongpassword");
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  it("does not set a cookie on failed login", async () => {
    const res = await doLogin(ctx.app, constants.ADMIN_USERNAME, "wrongpassword");
    const sid = extractSessionCookie(res);
    expect(sid).toBeUndefined();
  });

  it("returns 401 for unknown username", async () => {
    const res = await doLogin(ctx.app, "unknown-user", "anything");
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is missing fields", async () => {
    const res = await ctx.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin" }), // no password
    });
    expect(res.status).toBe(400);
  });

  it("returns 429 after exceeding rate limit", async () => {
    // Exhaust the rate limit (AUTH_RATE_LIMIT_MAX = 5 attempts)
    // All requests come from the same IP (default "127.0.0.1" in rate limiter)
    for (let i = 0; i < constants.AUTH_RATE_LIMIT_MAX; i++) {
      await doLogin(ctx.app, constants.ADMIN_USERNAME, "wrongpassword");
    }
    // The next request should be rate-limited
    const res = await doLogin(ctx.app, constants.ADMIN_USERNAME, "wrongpassword");
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body.code).toBe("RATE_LIMITED");
  });
});

describe("POST /api/auth/logout", () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("returns 200 and clears the session cookie", async () => {
    // Login first
    const loginRes = await doLogin(ctx.app);
    const sid = extractSessionCookie(loginRes)!;
    expect(sid).toBeTruthy();

    // Logout with the session cookie
    const logoutRes = await ctx.app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${constants.SESSION_COOKIE_NAME}=${sid}` },
    });
    expect(logoutRes.status).toBe(200);

    // The Set-Cookie header should clear the cookie (Max-Age=0 or empty value)
    const setCookieHeader = logoutRes.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain(constants.SESSION_COOKIE_NAME);
    // Max-Age=0 or expires in the past signals deletion
    const isCleared =
      setCookieHeader.includes("Max-Age=0") ||
      setCookieHeader.includes("max-age=0") ||
      setCookieHeader.match(new RegExp(`${constants.SESSION_COOKIE_NAME}=;`)) !== null ||
      setCookieHeader.match(new RegExp(`${constants.SESSION_COOKIE_NAME}=(?:;|,|$)`)) !== null;
    expect(isCleared).toBe(true);
  });

  it("invalidates the session in the store after logout", async () => {
    const loginRes = await doLogin(ctx.app);
    const sid = extractSessionCookie(loginRes)!;

    // Verify session is valid before logout
    expect(ctx.sessionStore.validate(sid)).not.toBeNull();

    await ctx.app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${constants.SESSION_COOKIE_NAME}=${sid}` },
    });

    // Session should be gone
    expect(ctx.sessionStore.validate(sid)).toBeNull();
  });

  it("returns 200 even without a session cookie (idempotent)", async () => {
    const res = await ctx.app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/auth/me", () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("returns 401 without any auth", async () => {
    const res = await ctx.app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with authenticated user info via session cookie", async () => {
    const loginRes = await doLogin(ctx.app);
    const sid = extractSessionCookie(loginRes)!;

    const res = await ctx.app.request("/api/auth/me", {
      headers: { Cookie: `${constants.SESSION_COOKIE_NAME}=${sid}` },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.authenticated).toBe(true);
    expect(body.username).toBe(constants.ADMIN_USERNAME);
    expect(body.role).toBe("admin");
    expect(body.token).toBe(TEST_TOKEN);
  });

  it("returns 200 via Bearer token fallback", async () => {
    const res = await ctx.app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.authenticated).toBe(true);
    expect(body.token).toBe(TEST_TOKEN);
  });

  it("returns 401 with an invalid Bearer token", async () => {
    const res = await ctx.app.request("/api/auth/me", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 after session is invalidated (logout)", async () => {
    const loginRes = await doLogin(ctx.app);
    const sid = extractSessionCookie(loginRes)!;

    // Logout
    await ctx.app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${constants.SESSION_COOKIE_NAME}=${sid}` },
    });

    // /me should now return 401
    const res = await ctx.app.request("/api/auth/me", {
      headers: { Cookie: `${constants.SESSION_COOKIE_NAME}=${sid}` },
    });
    expect(res.status).toBe(401);
  });
});
