// src/e2e/auth.e2e.test.ts
// Phase B1 — Full auth flow tests over real HTTP
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, SEED_PASSWORD } from "./helpers/seed.js";
import { constants } from "../lib/constants.js";

// ---------------------------------------------------------------------------
// Main auth suite
// ---------------------------------------------------------------------------

describe("Auth API", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. POST /api/auth/login with correct credentials → 200, ok: true, token present
  it("POST /api/auth/login with correct credentials → 200, ok: true, token present", async () => {
    const res = await ctx.client.post("/api/auth/login", {
      username: constants.ADMIN_USERNAME,
      password: SEED_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  // 2. POST /api/auth/login → response has Set-Cookie header with __cp_sid
  it("POST /api/auth/login → response has Set-Cookie header with session cookie", async () => {
    const res = await ctx.client.post("/api/auth/login", {
      username: constants.ADMIN_USERNAME,
      password: SEED_PASSWORD,
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(constants.SESSION_COOKIE_NAME);
  });

  // 3. POST /api/auth/login with wrong password → 401, code: "INVALID_CREDENTIALS"
  it("POST /api/auth/login with wrong password → 401 INVALID_CREDENTIALS", async () => {
    const res = await ctx.client.post("/api/auth/login", {
      username: constants.ADMIN_USERNAME,
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  // 4. GET /api/instances without auth → 401
  it("GET /api/instances without auth → 401", async () => {
    // Use a fresh client with no auth
    const res = await fetch(`${ctx.baseUrl}/api/instances`);
    expect(res.status).toBe(401);
  });

  // 5. GET /api/instances with session cookie (after login) → 200
  it("GET /api/instances with session cookie → 200", async () => {
    // Login to get a session cookie
    const cookieClient = ctx.client;
    await cookieClient.login();
    const res = await cookieClient.get("/api/instances");
    expect(res.status).toBe(200);
  });

  // 6. GET /api/instances with Bearer token → 200
  it("GET /api/instances with Bearer token → 200", async () => {
    const res = await ctx.client.withBearer().get("/api/instances");
    expect(res.status).toBe(200);
  });

  // 7. GET /api/auth/me with session cookie → 200, authenticated: true, username: "admin"
  it("GET /api/auth/me with session cookie → 200, authenticated: true, username: admin", async () => {
    const cookieClient = ctx.client;
    await cookieClient.login();
    const res = await cookieClient.get("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.authenticated).toBe(true);
    expect(body.username).toBe(constants.ADMIN_USERNAME);
  });

  // 8. GET /api/auth/me with Bearer token → 200, authenticated: true
  it("GET /api/auth/me with Bearer token → 200, authenticated: true", async () => {
    const res = await ctx.client.withBearer().get("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.authenticated).toBe(true);
  });

  // 9. GET /api/auth/me with invalid Bearer → 401
  it("GET /api/auth/me with invalid Bearer → 401", async () => {
    const res = await ctx.client.withBearer("invalid-token-that-is-wrong").get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  // 10. POST /api/auth/logout → 200, cookie cleared
  // Uses the session cookie already stored in ctx.client from previous tests (no re-login needed)
  it("POST /api/auth/logout → 200, cookie cleared", async () => {
    // ctx.client already has a session cookie from tests 4/5/7 — use it directly
    const res = await ctx.client.post("/api/auth/logout");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    // The Set-Cookie header should clear the session cookie (empty value or Max-Age=0)
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      // Cookie cleared: either empty value or Max-Age=0 or expires in the past
      const isCleared =
        setCookie.includes(`${constants.SESSION_COOKIE_NAME}=;`) ||
        setCookie.includes("Max-Age=0") ||
        setCookie.includes("max-age=0") ||
        setCookie.includes("Expires=Thu, 01 Jan 1970");
      expect(isCleared).toBe(true);
    }
  });

  // 11. After logout, session cookie no longer works → 401
  it("After logout, session cookie no longer works → 401", async () => {
    // Create a fresh client, login, then logout
    const freshCtx = await startTestServer();
    await seedAdmin(freshCtx.db);
    try {
      await freshCtx.client.login();
      // Verify it works before logout
      const beforeLogout = await freshCtx.client.get("/api/instances");
      expect(beforeLogout.status).toBe(200);
      // Logout
      await freshCtx.client.post("/api/auth/logout");
      // Now the same client (with stale cookie) should get 401
      const afterLogout = await freshCtx.client.get("/api/instances");
      expect(afterLogout.status).toBe(401);
    } finally {
      await freshCtx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limiting suite — isolated server to avoid interference
// ---------------------------------------------------------------------------

describe("Auth rate limiting", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 12. Rate limiting: 5 failed logins → 6th returns 429
  it("5 failed logins → 6th attempt returns 429 RATE_LIMITED", async () => {
    const badCreds = { username: constants.ADMIN_USERNAME, password: "wrong-password" };

    // Send AUTH_RATE_LIMIT_MAX (5) failed attempts
    for (let i = 0; i < constants.AUTH_RATE_LIMIT_MAX; i++) {
      const res = await ctx.client.post("/api/auth/login", badCreds);
      // Each should be 401 (not yet rate limited)
      expect(res.status).toBe(401);
    }

    // 6th attempt should be rate limited
    const res = await ctx.client.post("/api/auth/login", badCreds);
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.code).toBe("RATE_LIMITED");
  });
});
