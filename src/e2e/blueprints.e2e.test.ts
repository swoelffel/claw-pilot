// src/e2e/blueprints.e2e.test.ts
// Full Blueprint CRUD — all routes covered
//
// Routes tested:
//   GET    /api/blueprints
//   POST   /api/blueprints
//   GET    /api/blueprints/:id
//   PUT    /api/blueprints/:id
//   DELETE /api/blueprints/:id
//   GET    /api/blueprints/:id/builder
//   POST   /api/blueprints/:id/agents
//   PATCH  /api/blueprints/:id/agents/:agentId/meta
//   DELETE /api/blueprints/:id/agents/:agentId
//   PATCH  /api/blueprints/:id/agents/:agentId/position
//   GET    /api/blueprints/:id/agents/:agentId/files/:filename
//   PUT    /api/blueprints/:id/agents/:agentId/files/:filename
//   PATCH  /api/blueprints/:id/agents/:agentId/spawn-links
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin } from "./helpers/seed.js";

describe("Blueprints API — full CRUD", () => {
  let ctx: TestContext;
  let blueprintId: number;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ─── Blueprint CRUD ────────────────────────────────────────────────────────

  it("GET /api/blueprints (empty) → 200, []", async () => {
    const res = await ctx.client.withBearer().get("/api/blueprints");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("POST /api/blueprints → 201, has id and name", async () => {
    const res = await ctx.client.withBearer().post("/api/blueprints", {
      name: "Test Blueprint",
      description: "A test blueprint",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(typeof body.id).toBe("number");
    expect(body.name).toBe("Test Blueprint");
    blueprintId = body.id;
  });

  it("POST /api/blueprints with duplicate name → 409 BLUEPRINT_NAME_TAKEN", async () => {
    const res = await ctx.client.withBearer().post("/api/blueprints", {
      name: "Test Blueprint",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe("BLUEPRINT_NAME_TAKEN");
  });

  it("POST /api/blueprints without name → 400 BLUEPRINT_NAME_REQUIRED", async () => {
    const res = await ctx.client.withBearer().post("/api/blueprints", {
      description: "no name",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("BLUEPRINT_NAME_REQUIRED");
  });

  it("GET /api/blueprints/:id → 200, correct name", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(blueprintId);
    expect(body.name).toBe("Test Blueprint");
  });

  it("GET /api/blueprints/:id with unknown id → 404 NOT_FOUND", async () => {
    const res = await ctx.client.withBearer().get("/api/blueprints/99999");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("PUT /api/blueprints/:id → 200, updated name returned", async () => {
    const res = await ctx.client.withBearer().put(`/api/blueprints/${blueprintId}`, {
      name: "Updated Blueprint",
      description: "Updated description",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Updated Blueprint");
    expect(body.description).toBe("Updated description");
  });

  it("GET /api/blueprints/:id after PUT → reflects updated name", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Updated Blueprint");
  });

  // ─── Builder payload ───────────────────────────────────────────────────────

  it("GET /api/blueprints/:id/builder → 200, has blueprint + agents[] + links[]", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.blueprint).toBeDefined();
    expect(body.blueprint.id).toBe(blueprintId);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.links)).toBe(true);
    // Default "main" agent is seeded on creation
    const main = body.agents.find((a: any) => a.agent_id === "main");
    expect(main).toBeDefined();
  });

  it("GET /api/blueprints/:id/builder with unknown id → 404 NOT_FOUND", async () => {
    const res = await ctx.client.withBearer().get("/api/blueprints/99999/builder");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
  });

  // ─── Blueprint agents CRUD ─────────────────────────────────────────────────

  it("POST /api/blueprints/:id/agents → 201, agent added to builder payload", async () => {
    const res = await ctx.client.withBearer().post(`/api/blueprints/${blueprintId}/agents`, {
      agent_id: "helper",
      name: "Helper Agent",
      model: "anthropic/claude-3-5-haiku-20241022",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.agents)).toBe(true);
    const helper = body.agents.find((a: any) => a.agent_id === "helper");
    expect(helper).toBeDefined();
    expect(helper.name).toBe("Helper Agent");
  });

  it("POST /api/blueprints/:id/agents with duplicate agent_id → 409 AGENT_ID_TAKEN", async () => {
    const res = await ctx.client.withBearer().post(`/api/blueprints/${blueprintId}/agents`, {
      agent_id: "helper",
      name: "Duplicate",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe("AGENT_ID_TAKEN");
  });

  it("POST /api/blueprints/:id/agents with invalid agent_id → 400 INVALID_AGENT_ID", async () => {
    const res = await ctx.client.withBearer().post(`/api/blueprints/${blueprintId}/agents`, {
      agent_id: "INVALID ID",
      name: "Bad",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("INVALID_AGENT_ID");
  });

  it("POST /api/blueprints/:id/agents missing required fields → 400 FIELD_REQUIRED", async () => {
    const res = await ctx.client.withBearer().post(`/api/blueprints/${blueprintId}/agents`, {
      name: "No ID",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("FIELD_REQUIRED");
  });

  // ─── Agent meta ────────────────────────────────────────────────────────────

  it("PATCH /api/blueprints/:id/agents/:agentId/meta → 200, updated role in payload", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/blueprints/${blueprintId}/agents/helper/meta`, {
        role: "Support specialist",
        notes: "Handles edge cases",
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.agents)).toBe(true);
    const helper = body.agents.find((a: any) => a.agent_id === "helper");
    expect(helper).toBeDefined();
    expect(helper.role).toBe("Support specialist");
  });

  it("PATCH /api/blueprints/:id/agents/:agentId/meta with unknown agent → 404 AGENT_NOT_FOUND", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/blueprints/${blueprintId}/agents/nonexistent/meta`, { role: "x" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });

  // ─── Agent position ────────────────────────────────────────────────────────

  it("PATCH /api/blueprints/:id/agents/:agentId/position → 200, { ok: true }", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/blueprints/${blueprintId}/agents/helper/position`, { x: 200, y: 150 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("PATCH /api/blueprints/:id/agents/:agentId/position with unknown agent → 404 AGENT_NOT_FOUND", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/blueprints/${blueprintId}/agents/ghost/position`, { x: 0, y: 0 });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });

  // ─── Agent files ───────────────────────────────────────────────────────────

  it("GET /api/blueprints/:id/agents/:agentId/files/:filename → 200, has content", async () => {
    // The "main" agent is seeded with workspace files on blueprint creation
    const res = await ctx.client
      .withBearer()
      .get(`/api/blueprints/${blueprintId}/agents/main/files/AGENTS.md`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.filename).toBe("AGENTS.md");
    expect(typeof body.content).toBe("string");
    expect(typeof body.content_hash).toBe("string");
    expect(body.editable).toBe(true);
  });

  it("GET /api/blueprints/:id/agents/:agentId/files/:filename with unknown file → 404 FILE_NOT_FOUND", async () => {
    const res = await ctx.client
      .withBearer()
      .get(`/api/blueprints/${blueprintId}/agents/main/files/NONEXISTENT.md`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("FILE_NOT_FOUND");
  });

  it("PUT /api/blueprints/:id/agents/:agentId/files/:filename → 200, content saved", async () => {
    const newContent = "# AGENTS.md\n\nUpdated by e2e test.\n";
    const res = await ctx.client
      .withBearer()
      .put(`/api/blueprints/${blueprintId}/agents/main/files/AGENTS.md`, {
        content: newContent,
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.filename).toBe("AGENTS.md");
    expect(body.content).toBe(newContent);
    expect(typeof body.content_hash).toBe("string");
  });

  it("GET /api/blueprints/:id/agents/:agentId/files/:filename after PUT → reflects new content", async () => {
    const res = await ctx.client
      .withBearer()
      .get(`/api/blueprints/${blueprintId}/agents/main/files/AGENTS.md`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.content).toBe("# AGENTS.md\n\nUpdated by e2e test.\n");
  });

  // ─── Spawn links ───────────────────────────────────────────────────────────

  it("PATCH /api/blueprints/:id/agents/:agentId/spawn-links → 200, links updated", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/blueprints/${blueprintId}/agents/main/spawn-links`, {
        targets: ["helper"],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.links)).toBe(true);
    const link = body.links.find(
      (l: any) => l.source_agent_id === "main" && l.target_agent_id === "helper",
    );
    expect(link).toBeDefined();
    expect(link.link_type).toBe("spawn");
  });

  it("PATCH spawn-links with empty targets → 200, spawn links cleared", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/blueprints/${blueprintId}/agents/main/spawn-links`, {
        targets: [],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    const spawnLinks = body.links.filter(
      (l: any) => l.source_agent_id === "main" && l.link_type === "spawn",
    );
    expect(spawnLinks.length).toBe(0);
  });

  it("PATCH spawn-links with unknown blueprint → 404 NOT_FOUND", async () => {
    const res = await ctx.client
      .withBearer()
      .patch("/api/blueprints/99999/agents/main/spawn-links", { targets: [] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
  });

  // ─── Agent delete ──────────────────────────────────────────────────────────

  it("DELETE /api/blueprints/:id/agents/:agentId → 200, agent removed from payload", async () => {
    const res = await ctx.client
      .withBearer()
      .delete(`/api/blueprints/${blueprintId}/agents/helper`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.agents)).toBe(true);
    const stillPresent = body.agents.find((a: any) => a.agent_id === "helper");
    expect(stillPresent).toBeUndefined();
  });

  it("DELETE /api/blueprints/:id/agents/:agentId with unknown agent → 404 AGENT_NOT_FOUND", async () => {
    const res = await ctx.client.withBearer().delete(`/api/blueprints/${blueprintId}/agents/ghost`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });

  // ─── Blueprint delete ──────────────────────────────────────────────────────

  it("DELETE /api/blueprints/:id → 200, { ok: true }", async () => {
    const res = await ctx.client.withBearer().delete(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("GET /api/blueprints/:id after delete → 404 NOT_FOUND", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("DELETE /api/blueprints/:id already deleted → 404 NOT_FOUND", async () => {
    const res = await ctx.client.withBearer().delete(`/api/blueprints/${blueprintId}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
  });
});
