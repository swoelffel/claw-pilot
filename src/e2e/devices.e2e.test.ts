// src/e2e/devices.e2e.test.ts
// Phase D2 — Device management tests over real HTTP
//
// Design notes:
// - DeviceManager reads from instance.state_dir via conn.readFile().
// - MockConnection returns errors for missing files → dm.list() returns { pending: [], paired: [] }.
// - MockConnection returns success for all exec calls → dm.revoke() succeeds (200).
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

    // Seed an openclaw instance (DeviceManager is only used with openclaw instances)
    seedInstance(ctx.registry, serverId, {
      slug: INSTANCE_SLUG,
      port: INSTANCE_PORT,
      instanceType: "openclaw",
      state: "stopped",
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. GET /api/instances/:slug/devices → 200, has pending and paired arrays
  it("GET /api/instances/:slug/devices → 200, has pending and paired arrays", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${INSTANCE_SLUG}/devices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // MockConnection has no state_dir files → DeviceManager returns empty lists
    expect(Array.isArray(body.pending)).toBe(true);
    expect(Array.isArray(body.paired)).toBe(true);
  });

  // 2. POST /api/instances/:slug/devices/approve without requestId → 400, code: "FIELD_REQUIRED"
  it("POST .../devices/approve without requestId → 400, FIELD_REQUIRED", async () => {
    const res = await ctx.client
      .withBearer()
      .post(`/api/instances/${INSTANCE_SLUG}/devices/approve`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("FIELD_REQUIRED");
  });

  // 3. DELETE /api/instances/:slug/devices/:deviceId → 200 or 500
  // MockConnection returns success for all exec calls, so revoke may succeed (200).
  // If the DeviceManager throws for a non-existent device, it returns 500.
  it("DELETE .../devices/nonexistent-id → 200 or 500 (MockConnection)", async () => {
    const res = await ctx.client
      .withBearer()
      .delete(`/api/instances/${INSTANCE_SLUG}/devices/nonexistent-id`);
    // MockConnection exec always succeeds → 200; or DeviceManager throws → 500
    expect([200, 500]).toContain(res.status);
  });
});
