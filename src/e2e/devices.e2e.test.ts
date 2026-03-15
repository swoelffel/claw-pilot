// src/e2e/devices.e2e.test.ts
// Device management tests over real HTTP
//
// Design notes:
// - DeviceManager uses rt_pairing_codes DB table for claw-runtime instances.
// - GET /devices returns { codes: PairingCode[] } from the DB.
// - DELETE /devices/:code revokes a pairing code (404 if not found).
// - POST /devices/approve no longer exists (removed with openclaw support).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

describe("Devices API", () => {
  let ctx: TestContext;
  const INSTANCE_SLUG = "devices-test-inst";
  const INSTANCE_PORT = 18840;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    const serverId = seedLocalServer(ctx.registry);

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

  // 1. GET /api/instances/:slug/devices → 200, has codes array
  it("GET /api/instances/:slug/devices → 200, has codes array", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${INSTANCE_SLUG}/devices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // No pairing codes seeded → empty array
    expect(Array.isArray(body.codes)).toBe(true);
    expect(body.codes.length).toBe(0);
  });

  // 2. DELETE /api/instances/:slug/devices/:code → 404 for non-existent code
  it("DELETE .../devices/nonexistent-code → 404, CODE_NOT_FOUND", async () => {
    const res = await ctx.client
      .withBearer()
      .delete(`/api/instances/${INSTANCE_SLUG}/devices/nonexistent-code`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("CODE_NOT_FOUND");
  });
});
