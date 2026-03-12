// src/e2e/agents.e2e.test.ts
// Phase C2 — Agent CRUD tests over real HTTP
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

// Minimal openclaw.json content for the MockConnection
const MINIMAL_OPENCLAW_JSON = JSON.stringify(
  {
    version: "2026.3.0",
    agents: {
      list: [],
    },
    models: {
      default: "anthropic/claude-3-5-haiku-20241022",
      providers: {},
    },
  },
  null,
  2,
);

describe("Agents API", () => {
  let ctx: TestContext;
  let serverId: number;
  const INSTANCE_SLUG = "agents-test-inst";
  const INSTANCE_PORT = 18820;
  const CONFIG_PATH = `/home/test/.openclaw-${INSTANCE_SLUG}/openclaw.json`;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);

    // Seed an openclaw instance (AgentProvisioner reads openclaw.json)
    seedInstance(ctx.registry, serverId, {
      slug: INSTANCE_SLUG,
      port: INSTANCE_PORT,
      instanceType: "openclaw",
      state: "stopped",
    });

    // Pre-populate the MockConnection with a valid openclaw.json
    ctx.conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // 1. GET /api/instances/:slug/agents (empty) → 200, []
  it("GET /api/instances/:slug/agents (empty) → 200, []", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${INSTANCE_SLUG}/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  // 2. POST /api/instances/:slug/agents → 201, agent created
  it("POST /api/instances/:slug/agents → 201, agent created", async () => {
    const res = await ctx.client.withBearer().post(`/api/instances/${INSTANCE_SLUG}/agents`, {
      agentSlug: "test-agent",
      name: "Test Agent",
      role: "assistant",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.agents).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBeGreaterThan(0);
    const created = body.agents.find((a: any) => a.agent_id === "test-agent");
    expect(created).toBeDefined();
    expect(created.name).toBe("Test Agent");
  });

  // 3. GET /api/instances/:slug/agents → array with 1 agent
  it("GET /api/instances/:slug/agents → array with 1 agent", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${INSTANCE_SLUG}/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    const found = body.find((a: any) => a.agent_id === "test-agent");
    expect(found).toBeDefined();
  });

  // 4. PATCH /api/instances/:slug/agents/:agentId/position with { x: 100, y: 200 } → 200, { ok: true }
  it("PATCH .../agents/:agentId/position → 200, { ok: true }", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${INSTANCE_SLUG}/agents/test-agent/position`, { x: 100, y: 200 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  // 5. PATCH /api/instances/:slug/agents/:agentId/meta with { role: "Updated" } → 200, { ok: true }
  it("PATCH .../agents/:agentId/meta → 200, { ok: true }", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${INSTANCE_SLUG}/agents/test-agent/meta`, { role: "Updated Role" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  // 6. DELETE /api/instances/:slug/agents/:agentId → 200, { ok: true } (via agents array)
  it("DELETE .../agents/:agentId → 200, agents array returned", async () => {
    // First create a second agent to delete (can't delete default agent)
    // Re-read the current openclaw.json from MockConnection (it was updated by create)
    const res = await ctx.client.withBearer().post(`/api/instances/${INSTANCE_SLUG}/agents`, {
      agentSlug: "agent-to-delete",
      name: "Agent To Delete",
      role: "helper",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    expect(res.status).toBe(201);

    // Now delete it
    const deleteRes = await ctx.client
      .withBearer()
      .delete(`/api/instances/${INSTANCE_SLUG}/agents/agent-to-delete`);
    expect(deleteRes.status).toBe(200);
    const body = (await deleteRes.json()) as any;
    // Response contains instance + agents + links
    expect(body.instance).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    // The deleted agent should not be in the list
    const stillPresent = body.agents.find((a: any) => a.agent_id === "agent-to-delete");
    expect(stillPresent).toBeUndefined();
  });

  // 7. After delete, GET /api/instances/:slug/agents → deleted agent not present
  it("After delete, GET .../agents → deleted agent not present", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${INSTANCE_SLUG}/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    const deleted = body.find((a: any) => a.agent_id === "agent-to-delete");
    expect(deleted).toBeUndefined();
  });
});
