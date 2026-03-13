// src/e2e/agent-spawn-links.e2e.test.ts
// Regression test: create agent → link to main → save → verify link persists
//
// Bug (openclaw): when agents.defaults was absent from openclaw.json, PATCH spawn-links
// silently skipped writing the link, causing the agent and link to disappear
// after save (the subsequent sync found no links and returned links: []).
//
// Bug (claw-runtime): PATCH spawn-links was calling AgentSync.sync() which reads
// agents.list (openclaw format) → found nothing → wiped all agents from DB.
// Fix: for claw-runtime, links are stored DB-only, runtime.json is never touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

// Minimal runtime.json for claw-runtime instances
const MINIMAL_RUNTIME_JSON = JSON.stringify(
  {
    version: "1",
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

// openclaw.json with NO agents.defaults — only agents.list (the bug scenario)
const CONFIG_NO_DEFAULTS = JSON.stringify(
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

// openclaw.json with agents.defaults present (normal scenario)
const CONFIG_WITH_DEFAULTS = JSON.stringify(
  {
    version: "2026.3.0",
    agents: {
      defaults: {
        workspace: ".",
      },
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

describe("Agent spawn-links — regression: link disappears after save", () => {
  let ctx: TestContext;
  let serverId: number;

  const SLUG_NO_DEF = "spawn-no-defaults";
  const SLUG_WITH_DEF = "spawn-with-defaults";
  const PORT_NO_DEF = 18830;
  const PORT_WITH_DEF = 18831;
  const CONFIG_PATH_NO_DEF = `/home/test/.openclaw-${SLUG_NO_DEF}/openclaw.json`;
  const CONFIG_PATH_WITH_DEF = `/home/test/.openclaw-${SLUG_WITH_DEF}/openclaw.json`;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);

    // Instance without agents.defaults (bug scenario)
    seedInstance(ctx.registry, serverId, {
      slug: SLUG_NO_DEF,
      port: PORT_NO_DEF,
      instanceType: "openclaw",
      state: "stopped",
    });
    ctx.conn.files.set(CONFIG_PATH_NO_DEF, CONFIG_NO_DEFAULTS);
    ctx.conn.files.set(
      `/home/test/.openclaw-${SLUG_NO_DEF}/.env`,
      `OPENCLAW_GW_AUTH_TOKEN=gw-token-${SLUG_NO_DEF}\n`,
    );

    // Instance with agents.defaults (normal scenario — should still work)
    seedInstance(ctx.registry, serverId, {
      slug: SLUG_WITH_DEF,
      port: PORT_WITH_DEF,
      instanceType: "openclaw",
      state: "stopped",
    });
    ctx.conn.files.set(CONFIG_PATH_WITH_DEF, CONFIG_WITH_DEFAULTS);
    ctx.conn.files.set(
      `/home/test/.openclaw-${SLUG_WITH_DEF}/.env`,
      `OPENCLAW_GW_AUTH_TOKEN=gw-token-${SLUG_WITH_DEF}\n`,
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Bug scenario: no agents.defaults ──────────────────────────────────────

  it("[no-defaults] POST agent → 201, agent appears in builder", async () => {
    const res = await ctx.client.withBearer().post(`/api/instances/${SLUG_NO_DEF}/agents`, {
      agentSlug: "delegate",
      name: "Delegate",
      role: "helper",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const agents = body["agents"] as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBe(true);
    const created = agents.find((a) => a["agent_id"] === "delegate");
    expect(created).toBeDefined();
  });

  it("[no-defaults] PATCH main spawn-links → 200, link persisted in config", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_NO_DEF}/agents/main/spawn-links`, {
        targets: ["delegate"],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);

    // Verify the link was written into openclaw.json
    const savedRaw = ctx.conn.files.get(CONFIG_PATH_NO_DEF);
    expect(savedRaw).toBeDefined();
    const saved = JSON.parse(savedRaw!) as Record<string, unknown>;
    const agentsConf = saved["agents"] as Record<string, unknown>;
    const defaults = agentsConf?.["defaults"] as Record<string, unknown>;
    const subagents = defaults?.["subagents"] as Record<string, unknown>;
    expect(Array.isArray(subagents?.["allowAgents"])).toBe(true);
    expect((subagents?.["allowAgents"] as string[]).includes("delegate")).toBe(true);
  });

  it("[no-defaults] After save, GET builder → link still present (regression check)", async () => {
    // Simulate what the UI does after save: re-fetch builder data
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG_NO_DEF}/agents/builder`);
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

  it("[no-defaults] After save, GET builder → delegate agent still present (regression check)", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG_NO_DEF}/agents/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const agents = body["agents"] as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBe(true);
    const delegate = agents.find((a) => a["agent_id"] === "delegate");
    expect(delegate).toBeDefined();
  });

  // ── Normal scenario: agents.defaults present ─────────────────────────────

  it("[with-defaults] POST agent → 201, agent appears in builder", async () => {
    const res = await ctx.client.withBearer().post(`/api/instances/${SLUG_WITH_DEF}/agents`, {
      agentSlug: "delegate",
      name: "Delegate",
      role: "helper",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const agents = body["agents"] as Array<Record<string, unknown>>;
    const created = agents.find((a) => a["agent_id"] === "delegate");
    expect(created).toBeDefined();
  });

  it("[with-defaults] PATCH main spawn-links → 200, link persisted", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_WITH_DEF}/agents/main/spawn-links`, {
        targets: ["delegate"],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
  });

  it("[with-defaults] After save, GET builder → link still present", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG_WITH_DEF}/agents/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const links = body["links"] as Array<Record<string, unknown>>;
    const spawnLink = links.find(
      (l) =>
        l["source_agent_id"] === "main" &&
        l["target_agent_id"] === "delegate" &&
        l["link_type"] === "spawn",
    );
    expect(spawnLink).toBeDefined();
  });

  // ── Edge case: save with empty targets clears the link ───────────────────

  it("[no-defaults] PATCH main spawn-links with [] → link removed", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_NO_DEF}/agents/main/spawn-links`, {
        targets: [],
      });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);

    // Verify allowAgents is now empty in config
    const savedRaw = ctx.conn.files.get(CONFIG_PATH_NO_DEF);
    const saved = JSON.parse(savedRaw!) as Record<string, unknown>;
    const agentsConf = saved["agents"] as Record<string, unknown>;
    const defaults = agentsConf?.["defaults"] as Record<string, unknown>;
    const subagents = defaults?.["subagents"] as Record<string, unknown>;
    expect((subagents?.["allowAgents"] as string[]).length).toBe(0);
  });
});

// ── claw-runtime: spawn links are DB-only, runtime.json must not be touched ──

describe("Agent spawn-links — claw-runtime: links stored DB-only", () => {
  let ctx: TestContext;
  let serverId: number;
  let instanceId: number;

  const SLUG_RT = "spawn-rt-test";
  const PORT_RT = 18832;
  const CONFIG_PATH_RT = `/home/test/.openclaw-${SLUG_RT}/runtime.json`;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);

    // Seed a claw-runtime instance with runtime.json
    ctx.registry.allocatePort(serverId, PORT_RT, SLUG_RT);
    ctx.registry.createInstance({
      serverId,
      slug: SLUG_RT,
      port: PORT_RT,
      configPath: CONFIG_PATH_RT,
      stateDir: `/home/test/.openclaw-${SLUG_RT}`,
      systemdUnit: `claw-runtime-${SLUG_RT}.service`,
      instanceType: "claw-runtime",
    });
    ctx.registry.updateInstanceState(SLUG_RT, "stopped");

    // Populate runtime.json in MockConnection
    ctx.conn.files.set(CONFIG_PATH_RT, MINIMAL_RUNTIME_JSON);
    ctx.conn.files.set(
      `/home/test/.openclaw-${SLUG_RT}/.env`,
      `OPENCLAW_GW_AUTH_TOKEN=gw-token-${SLUG_RT}\n`,
    );

    // Get instance ID for direct DB seeding
    const inst = ctx.registry.getInstance(SLUG_RT)!;
    instanceId = inst.id;

    // Seed agents directly in DB (claw-runtime agents are managed via DB, not openclaw.json)
    ctx.registry.upsertAgent(instanceId, {
      agentId: "main",
      name: "Main",
      model: "anthropic/claude-3-5-haiku-20241022",
      workspacePath: `/home/test/.openclaw-${SLUG_RT}`,
      isDefault: true,
    });
    ctx.registry.upsertAgent(instanceId, {
      agentId: "delegate",
      name: "Delegate",
      model: "anthropic/claude-3-5-haiku-20241022",
      workspacePath: `/home/test/.openclaw-${SLUG_RT}`,
      isDefault: false,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("[rt] PATCH main spawn-links → 200, link persisted in DB", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_RT}/agents/main/spawn-links`, {
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

  it("[rt] After PATCH, runtime.json is NOT modified (links are DB-only)", async () => {
    // runtime.json should be unchanged — no spawn concept in runtime format
    const runtimeRaw = ctx.conn.files.get(CONFIG_PATH_RT);
    expect(runtimeRaw).toBeDefined();
    const runtime = JSON.parse(runtimeRaw!) as Record<string, unknown>;
    // agents array should still be the original minimal config (no allowAgents injected)
    const agents = runtime["agents"] as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBe(1); // only "main" from MINIMAL_RUNTIME_JSON
    const mainAgent = agents[0]!;
    expect(mainAgent["subagents"]).toBeUndefined();
  });

  it("[rt] After PATCH, GET builder → link still present (no AgentSync wipe)", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG_RT}/agents/builder`);
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

  it("[rt] After PATCH, GET builder → delegate agent still present (no AgentSync wipe)", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG_RT}/agents/builder`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const agents = body["agents"] as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBe(true);
    const delegate = agents.find((a) => a["agent_id"] === "delegate");
    expect(delegate).toBeDefined();
  });

  it("[rt] PATCH spawn-links for unknown agent → 404", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_RT}/agents/ghost/spawn-links`, {
        targets: ["delegate"],
      });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("AGENT_NOT_FOUND");
  });

  it("[rt] PATCH spawn-links with unknown target → 404", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_RT}/agents/main/spawn-links`, {
        targets: ["nonexistent"],
      });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("AGENT_NOT_FOUND");
  });

  it("[rt] PATCH spawn-links with [] → link removed from DB", async () => {
    const res = await ctx.client
      .withBearer()
      .patch(`/api/instances/${SLUG_RT}/agents/main/spawn-links`, {
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
