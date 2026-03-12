// src/e2e/blueprints.e2e.test.ts
// Phase D1 — Blueprint CRUD tests over real HTTP
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin } from "./helpers/seed.js";

describe("Blueprints API", () => {
  let ctx: TestContext;
  let blueprintId: number;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. GET /api/blueprints (empty) → 200, []
  it("GET /api/blueprints (empty) → 200, []", async () => {
    const res = await ctx.client.withBearer().get("/api/blueprints");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  // 2. POST /api/blueprints → 201, has id and name
  it("POST /api/blueprints → 201, has id and name", async () => {
    const res = await ctx.client.withBearer().post("/api/blueprints", {
      name: "Test Blueprint",
      description: "A test blueprint",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(typeof body.id).toBe("number");
    expect(body.name).toBe("Test Blueprint");
    // Store the id for subsequent tests
    blueprintId = body.id;
  });

  // 3. GET /api/blueprints/:id → 200, correct name
  it("GET /api/blueprints/:id → 200, correct name", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(blueprintId);
    expect(body.name).toBe("Test Blueprint");
  });

  // 4. GET /api/blueprints/:id/builder → 200, has agents array
  it("GET /api/blueprints/:id/builder → 200, has agents array", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.agents)).toBe(true);
  });

  // 5. DELETE /api/blueprints/:id → 200, { ok: true }
  it("DELETE /api/blueprints/:id → 200, { ok: true }", async () => {
    const res = await ctx.client.withBearer().delete(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  // 6. After delete, GET /api/blueprints/:id → 404
  it("After delete, GET /api/blueprints/:id → 404", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
  });
});
