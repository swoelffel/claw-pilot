// src/e2e/instances.e2e.test.ts
// Phase B2 — Instance CRUD tests over real HTTP
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

describe("Instances API", () => {
  let ctx: TestContext;
  let serverId: number;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. GET /api/instances (empty) → 200, []
  it("GET /api/instances (empty) → 200, empty array", async () => {
    const res = await ctx.client.withBearer().get("/api/instances");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  // 2. GET /api/instances/:slug for non-existent slug → 404
  it("GET /api/instances/:slug for non-existent slug → 404", async () => {
    const res = await ctx.client.withBearer().get("/api/instances/nonexistent-slug");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    // instanceGuard returns code: "NOT_FOUND"
    expect(body.code).toBe("NOT_FOUND");
  });

  // 3. After seedInstance(), GET /api/instances → array with 1 item
  it("After seedInstance(), GET /api/instances → array with 1 item", async () => {
    seedInstance(ctx.registry, serverId, {
      slug: "test-inst-list",
      port: 18800,

      state: "stopped",
    });

    const res = await ctx.client.withBearer().get("/api/instances");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    const found = body.find((i: any) => i.slug === "test-inst-list");
    expect(found).toBeDefined();
  });

  // 4. After seedInstance(), GET /api/instances/:slug → 200, instance details
  it("GET /api/instances/:slug → 200, instance details", async () => {
    seedInstance(ctx.registry, serverId, {
      slug: "test-inst-detail",
      port: 18801,

      state: "stopped",
      displayName: "Detail Test",
    });

    const res = await ctx.client.withBearer().get("/api/instances/test-inst-detail");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.instance).toBeDefined();
    expect(body.instance.slug).toBe("test-inst-detail");
    expect(body.status).toBeDefined();
  });

  // 5. GET /api/instances/:slug/config for claw-runtime instance → 200, has general.port
  it("GET /api/instances/:slug/config for claw-runtime → 200, has general.port", async () => {
    seedInstance(ctx.registry, serverId, {
      slug: "test-inst-config",
      port: 18802,

      state: "stopped",
    });

    const res = await ctx.client.withBearer().get("/api/instances/test-inst-config/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.general).toBeDefined();
    expect(typeof body.general.port).toBe("number");
    expect(body.general.port).toBe(18802);
  });

  // 6. PATCH /api/instances/:slug/config for claw-runtime → 200, { ok: true }
  it("PATCH /api/instances/:slug/config for claw-runtime → 200, { ok: true }", async () => {
    seedInstance(ctx.registry, serverId, {
      slug: "test-inst-patch",
      port: 18803,

      state: "stopped",
      displayName: "Patch Test",
    });

    const res = await ctx.client
      .withBearer()
      .patch("/api/instances/test-inst-patch/config", { general: { displayName: "Updated Name" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  // 7. DELETE /api/instances/:slug → 200, { ok: true, slug }
  it("DELETE /api/instances/:slug → 200, { ok: true, slug }", async () => {
    seedInstance(ctx.registry, serverId, {
      slug: "test-inst-delete",
      port: 18804,

      state: "stopped",
    });

    const res = await ctx.client.withBearer().delete("/api/instances/test-inst-delete");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("test-inst-delete");
  });

  // 8. After delete, GET /api/instances/:slug → 404
  it("After delete, GET /api/instances/:slug → 404", async () => {
    seedInstance(ctx.registry, serverId, {
      slug: "test-inst-gone",
      port: 18805,

      state: "stopped",
    });

    // Delete it
    await ctx.client.withBearer().delete("/api/instances/test-inst-gone");

    // Now it should be 404
    const res = await ctx.client.withBearer().get("/api/instances/test-inst-gone");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    // instanceGuard returns code: "NOT_FOUND"
    expect(body.code).toBe("NOT_FOUND");
  });
});
