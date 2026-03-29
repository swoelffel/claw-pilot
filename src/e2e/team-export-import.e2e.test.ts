// src/e2e/team-export-import.e2e.test.ts
// E2E round-trip test: export instance → import into blueprint → export blueprint → compare.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parse as parseYaml } from "yaml";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ctx: TestContext;
const SLUG = "cpteam";
const STATE_DIR = `/home/test/.openclaw-${SLUG}`;
const CONFIG_PATH = `${STATE_DIR}/runtime.json`;

beforeAll(async () => {
  ctx = await startTestServer();
  await seedAdmin(ctx.db);
  const serverId = seedLocalServer(ctx.registry);
  seedInstance(ctx.registry, serverId, { slug: SLUG, port: 18800, state: "stopped" });

  // Seed runtime.json with a rich multi-agent config including v2 fields
  ctx.conn.files.set(
    CONFIG_PATH,
    JSON.stringify({
      defaultModel: "anthropic/claude-opus-4-6",
      agents: [
        {
          id: "pilot",
          name: "Pilot Agent",
          isDefault: true,
          model: "anthropic/claude-opus-4-6",
          toolProfile: "manager",
          archetype: "orchestrator",
          persistence: "permanent",
          thinking: { enabled: true, budgetTokens: 20000 },
          agentToAgent: { enabled: true, allowList: ["qa", "dev"] },
          temperature: 0.7,
          maxSteps: 50,
          promptMode: "full",
          permissions: [
            { permission: "*", pattern: "**", action: "allow" },
            { permission: "read", pattern: "*.env", action: "ask" },
          ],
          heartbeat: { every: "30m", prompt: "Check tasks" },
        },
        {
          id: "qa",
          name: "QA Agent",
          model: "anthropic/claude-haiku-4-5",
          toolProfile: "executor",
          archetype: "evaluator",
          persistence: "ephemeral",
          temperature: 0.3,
          maxSteps: 20,
          promptMode: "subagent",
        },
        {
          id: "dev",
          name: "Dev Agent",
          model: "anthropic/claude-sonnet-4-5",
          toolProfile: "executor",
          archetype: "generator",
          persistence: "ephemeral",
          inheritWorkspace: false,
          bootstrapFiles: ["docs/*.md"],
        },
      ],
      port: 18800,
    }),
  );

  // Seed workspace files for each agent
  for (const agentId of ["pilot", "qa", "dev"]) {
    const ws = `${STATE_DIR}/workspaces/${agentId}`;
    ctx.conn.files.set(`${ws}/SOUL.md`, `# ${agentId} Soul\n\nIdentity of ${agentId}.`);
    ctx.conn.files.set(`${ws}/AGENTS.md`, `# Available Agents\n\nTeam members.`);
    ctx.conn.files.set(`${ws}/USER.md`, `# User Context`);
    ctx.conn.files.set(`${ws}/HEARTBEAT.md`, `# Heartbeat\n\nPeriodic tasks.`);
    ctx.conn.files.set(`${ws}/BOOTSTRAP.md`, `# Bootstrap ${agentId}\n\nSetup instructions.`);
  }

  // Seed agents in DB (AgentSync during export will reconcile)
  const instance = ctx.registry.getInstance(SLUG)!;
  for (const id of ["pilot", "qa", "dev"]) {
    ctx.registry.createAgent(instance.id, {
      agentId: id,
      name: `${id} Agent`,
      workspacePath: `${STATE_DIR}/workspaces/${id}`,
      isDefault: id === "pilot",
    });
  }

  // Seed links
  ctx.registry.replaceAgentLinks(instance.id, [
    { sourceAgentId: "pilot", targetAgentId: "qa", linkType: "spawn" },
    { sourceAgentId: "pilot", targetAgentId: "dev", linkType: "spawn" },
    { sourceAgentId: "pilot", targetAgentId: "qa", linkType: "a2a" },
  ]);
});

afterAll(async () => {
  await ctx.cleanup();
});

// ---------------------------------------------------------------------------
// Helper: parse YAML and normalize for comparison
// ---------------------------------------------------------------------------

interface ParsedTeam {
  version: string;
  source?: string;
  defaults?: Record<string, unknown>;
  agents: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
}

function normalizeTeam(yamlStr: string): ParsedTeam {
  const parsed = parseYaml(yamlStr) as unknown;
  const team = parsed as ParsedTeam;
  // Sort agents by id for stable comparison
  team.agents.sort((a, b) => String(a["id"]).localeCompare(String(b["id"])));
  // Sort links for stable comparison
  team.links.sort((a, b) => {
    const cmp = String(a["source"]).localeCompare(String(b["source"]));
    if (cmp !== 0) return cmp;
    const cmp2 = String(a["target"]).localeCompare(String(b["target"]));
    if (cmp2 !== 0) return cmp2;
    return String(a["type"]).localeCompare(String(b["type"]));
  });
  // Sort file keys within each agent
  for (const agent of team.agents) {
    if (agent["files"] && typeof agent["files"] === "object") {
      const files = agent["files"] as Record<string, string>;
      const sorted: Record<string, string> = {};
      for (const key of Object.keys(files).sort()) {
        sorted[key] = files[key]!;
      }
      agent["files"] = sorted;
    }
  }
  return team;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Team YAML round-trip: instance → blueprint → compare", () => {
  let yaml1: string;
  let yaml2: string;
  let blueprintId: number;

  it("Step 1: export instance as YAML", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${SLUG}/team/export`);
    expect(res.status).toBe(200);
    yaml1 = await res.text();
    expect(yaml1).toContain("version:");
    expect(yaml1).toContain("agents:");
  });

  it("Step 2: create blueprint and import YAML", async () => {
    // Create blueprint
    const createRes = await ctx.client
      .withBearer()
      .post("/api/blueprints", { name: "cpteam2", description: "Round-trip test" });
    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as { id: number };
    blueprintId = body.id;

    // Import YAML into blueprint (raw fetch — TestClient.post() always JSON.stringify)
    const importRes = await fetch(`${ctx.baseUrl}/api/blueprints/${blueprintId}/team/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        "Content-Type": "text/yaml",
      },
      body: yaml1,
    });
    expect(importRes.status).toBe(200);
    const importBody = (await importRes.json()) as { ok: boolean; agents_imported: number };
    expect(importBody.ok).toBe(true);
    expect(importBody.agents_imported).toBe(3);
  });

  it("Step 3: export blueprint as YAML", async () => {
    const res = await ctx.client.withBearer().get(`/api/blueprints/${blueprintId}/team/export`);
    expect(res.status).toBe(200);
    yaml2 = await res.text();
    expect(yaml2).toContain("version:");
  });

  it("Step 4: compare — agents are identical", () => {
    const team1 = normalizeTeam(yaml1);
    const team2 = normalizeTeam(yaml2);

    expect(team1.version).toBe(team2.version);
    expect(team1.agents.length).toBe(team2.agents.length);

    for (let i = 0; i < team1.agents.length; i++) {
      const a1 = team1.agents[i]!;
      const a2 = team2.agents[i]!;

      expect(a2["id"]).toBe(a1["id"]);
      expect(a2["name"]).toBe(a1["name"]);
      expect(a2["is_default"]).toBe(a1["is_default"]);

      // Config should match (v2 fields included)
      const c1 = a1["config"] as Record<string, unknown> | undefined;
      const c2 = a2["config"] as Record<string, unknown> | undefined;
      expect(c2).toEqual(c1);
    }
  });

  it("Step 5: compare — links are identical", () => {
    const team1 = normalizeTeam(yaml1);
    const team2 = normalizeTeam(yaml2);

    expect(team2.links).toEqual(team1.links);
  });

  it("Step 6: compare — workspace files are identical", () => {
    const team1 = normalizeTeam(yaml1);
    const team2 = normalizeTeam(yaml2);

    for (let i = 0; i < team1.agents.length; i++) {
      const files1 = team1.agents[i]!["files"] as Record<string, string> | undefined;
      const files2 = team2.agents[i]!["files"] as Record<string, string> | undefined;
      expect(files2).toEqual(files1);

      // Verify BOOTSTRAP.md is included
      if (files1) {
        expect(Object.keys(files1)).toContain("BOOTSTRAP.md");
      }
    }
  });

  it("Step 7: compare — defaults.model matches", () => {
    const team1 = normalizeTeam(yaml1);
    const team2 = normalizeTeam(yaml2);

    expect(team2.defaults).toEqual(team1.defaults);
  });

  it("Step 8: v2 config fields survive the round-trip", () => {
    const team2 = normalizeTeam(yaml2);

    // Find pilot agent
    const pilot = team2.agents.find((a) => a["id"] === "pilot");
    expect(pilot).toBeDefined();
    const config = pilot!["config"] as Record<string, unknown>;

    expect(config["persistence"]).toBe("permanent");
    expect(config["thinking"]).toEqual({ enabled: true, budgetTokens: 20000 });
    expect(config["agentToAgent"]).toEqual({ enabled: true, allowList: ["qa", "dev"] });
    expect(config["temperature"]).toBe(0.7);
    expect(config["maxSteps"]).toBe(50);
    expect(config["promptMode"]).toBe("full");

    // Find dev agent — check inheritWorkspace and bootstrapFiles
    const dev = team2.agents.find((a) => a["id"] === "dev");
    expect(dev).toBeDefined();
    const devConfig = dev!["config"] as Record<string, unknown>;
    expect(devConfig["inheritWorkspace"]).toBe(false);
    expect(devConfig["bootstrapFiles"]).toEqual(["docs/*.md"]);
  });
});
