// src/e2e/system.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin } from "./helpers/seed.js";

describe("System API", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. GET /health (public) → 200, ok: true, service: "claw-pilot"
  it("GET /health returns 200 with ok:true without auth", async () => {
    const res = await ctx.client.get("/health");
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("claw-pilot");
    expect(typeof body.uptime).toBe("number");
  });

  // 2. Security headers on API responses
  it("sets security headers on API responses", async () => {
    const res = await ctx.client.withBearer().get("/api/instances");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  // 3. GET /api/health (authenticated) → 200, has instances and db.sizeBytes
  it("GET /api/health (authenticated) → 200, has instances and db.sizeBytes", async () => {
    const res = await ctx.client.withBearer().get("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.instances).toBeDefined();
    expect(typeof body.instances.total).toBe("number");
    expect(body.db).toBeDefined();
    expect(typeof body.db.sizeBytes).toBe("number");
  });

  // 4. GET /api/openclaw/update-status → not 401 or 404 (route exists, auth works)
  // The update checker may fail to reach GitHub in test env → may return 500, but not 401/404.
  it("GET /api/openclaw/update-status → route exists and auth works (not 401/404)", async () => {
    const res = await ctx.client.withBearer().get("/api/openclaw/update-status");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
  });

  // 5. GET /api/self/update-status → not 401 or 404 (route exists, auth works)
  // The self-update checker may fail to reach GitHub in test env → may return 500, but not 401/404.
  it("GET /api/self/update-status → route exists and auth works (not 401/404)", async () => {
    const res = await ctx.client.withBearer().get("/api/self/update-status");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
  });
});
