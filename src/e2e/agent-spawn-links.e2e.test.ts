// src/e2e/agent-spawn-links.e2e.test.ts
// Spawn-link tests: create agent → link to main → save → verify link persists in DB
//
// All instances are claw-runtime. Links are stored DB-only — runtime.json is never touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

// Minimal runtime.json for claw-runtime instances
const MINIMAL_RUNTIME_JSON = JSON.stringify(
  {
    defaultModel: "anthropic/claude-3-5-haiku-20241022",
    agents: [
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-3-5-haiku-20241022",
        permissions: [],
      },
    ],
    providers: [],
  },
  null,
  2,
);

describe("Agent spawn-links — links stored DB-only", () => {
  let ctx: TestContext;
  let serverId: number;
  let instanceId: number;

  const SLUG = "spawn-link-test";
  const PORT = 18830;
  const CONFIG_PATH = `/home/test/.openclaw-${SLUG}/runtime.json`;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);

    // Seed a claw-runtime instance with runtime.json
    ctx.registry.allocatePort(serverId, PORT, SLUG);
    ctx.registry.createInstance({
      serverId,
      slug: SLUG,
      port: PORT,
      configPath: CONFIG_PATH,
      stateDir: `/home/test/.openclaw-${SLUG}`,
      systemdUnit: `claw-runtime-${SLUG}.service`,
    });
    ctx.registry.updateInstanceState(SLUG, "stopped");

    // Populate runtime.json in MockConnection
    ctx.conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);
    ctx.conn.files.set(
      `/home/test/.openclaw-${SLUG}/.env`,
      `OPENCLAW_GW_AUTH_TOKEN=gw-token-${SLUG}\n`,
    );

    // Get instance ID for direct DB seeding
    const inst = ctx.registry.getInstance(SLUG)!;
    instanceId = inst.id;

    // Seed agents directly in DB (claw-runtime agents are managed via DB)
    ctx.registry.upsertAgent(instanceId, {
      agentId: "main",
      name: "Main",
      model: "anthropic/claude-3-5-haiku-20241022",
      workspacePath: `/home/test/.openclaw-${SLUG}`,
      isDefault: true,
    });
    ctx.registry.upsertAgent(instanceId, {
      agentId: "delegate",
      name: "Delegate",
      model: "anthropic/claude-3-5-haiku-20241022",
      workspacePath: `/home/test/.openclaw-${SLUG}`,
      isDefault: false,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Create and persist spawn link ────────────────────────────────────────

  it("PATCH main spawn-links → 200, link persisted in DB", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG}/agents/main/spawn-links`, {
        targets: ["delegate"],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);

    // Verify link is in DB
    const links = ctx.registry.listAgentLinks(instanceId);
    const spawnLink = links.find(
      (l) =>
        l.source_agent_id === "main" && l.target_agent_id === "delegate" && l.link_type === "spawn",
    );
    expect(spawnLink).toBeDefined();
  });

  it("After PATCH, runtime.json is NOT modified (links are DB-only)", async () => {
    // runtime.json should be unchanged — no spawn concept in runtime format
    const runtimeRaw = ctx.conn.files.get(CONFIG_PATH);
    expect(runtimeRaw).toBeDefined();
    const runtime = JSON.parse(runtimeRaw!) as Record<string, unknown>;
    // agents array should still be the original minimal config (no allowAgents injected)
    const agents = runtime["agents"] as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBe(1); // only "main" from MINIMAL_RUNTIME_JSON
    const mainAgent = agents[0]!;
    expect(mainAgent["subagents"]).toBeUndefined();
  });

  it("After PATCH, GET builder → link still present (no AgentSync wipe)", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG}/agents/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const links = body["links"] as Array<Record<string, unknown>>;
    expect(Array.isArray(links)).toBe(true);
    const spawnLink = links.find(
      (l) =>
        l["source_agent_id"] === "main" &&
        l["target_agent_id"] === "delegate" &&
        l["link_type"] === "spawn",
    );
    expect(spawnLink).toBeDefined();
  });

  it("After PATCH, GET builder → delegate agent still present (no AgentSync wipe)", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG}/agents/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const agents = body["agents"] as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBe(true);
    const delegate = agents.find((a) => a["agent_id"] === "delegate");
    expect(delegate).toBeDefined();
  });

  // ── Error cases ──────────────────────────────────────────────────────────

  it("PATCH spawn-links for unknown agent → 404", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG}/agents/ghost/spawn-links`, {
        targets: ["delegate"],
      });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("AGENT_NOT_FOUND");
  });

  it("PATCH spawn-links with unknown target → 404", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG}/agents/main/spawn-links`, {
        targets: ["nonexistent"],
      });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("AGENT_NOT_FOUND");
  });

  // ── Clear links ──────────────────────────────────────────────────────────

  it("PATCH spawn-links with [] → link removed from DB", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG}/agents/main/spawn-links`, {
        targets: [],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);

    // Verify no spawn links remain for main
    const links = ctx.registry.listAgentLinks(instanceId);
    const spawnLinks = links.filter((l) => l.source_agent_id === "main" && l.link_type === "spawn");
    expect(spawnLinks.length).toBe(0);
  });
});
