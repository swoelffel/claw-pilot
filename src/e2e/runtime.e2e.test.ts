// src/e2e/runtime.e2e.test.ts
// Phase C3 — Runtime API (sessions, messages) tests over real HTTP
// Note: POST /api/instances/:slug/runtime/chat is skipped (requires running runtime engine)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

describe("Runtime API", () => {
  let ctx: TestContext;
  let serverId: number;
  const INSTANCE_SLUG = "runtime-test-inst";
  const INSTANCE_PORT = 18830;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);

    // Seed a claw-runtime instance
    seedInstance(ctx.registry, serverId, {
      slug: INSTANCE_SLUG,
      port: INSTANCE_PORT,

      state: "stopped",
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. GET /api/instances/:slug/runtime/sessions → 200, { sessions: [] } (empty)
  it("GET .../runtime/sessions → 200, empty sessions array", async () => {
    const res = await ctx.client
      .withBearer()
      .get(`/api/instances/${INSTANCE_SLUG}/runtime/sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.sessions).toBeDefined();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.length).toBe(0);
  });

  // 2. GET /api/instances/:slug/runtime/sessions/:sessionId for non-existent → instance guard passes, messages empty
  it("GET .../runtime/sessions/:sessionId/messages for non-existent session → 200, empty messages", async () => {
    const res = await ctx.client
      .withBearer()
      .get(`/api/instances/${INSTANCE_SLUG}/runtime/sessions/nonexistent-session-id/messages`);
    // The route returns 200 with empty messages (no session existence check)
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.messages).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(0);
  });

  // 3. GET .../runtime/sessions for non-existent instance → 404
  it("GET .../runtime/sessions for non-existent instance → 404", async () => {
    const res = await ctx.client
      .withBearer()
      .get("/api/instances/nonexistent-runtime-inst/runtime/sessions");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    // instanceGuard returns code: "NOT_FOUND"
    expect(body.code).toBe("NOT_FOUND");
  });
});
