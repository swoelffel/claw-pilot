// src/core/__tests__/team-export.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { MockConnection } from "./mock-connection.js";
import { exportInstanceTeam, exportBlueprintTeam, serializeTeamYaml } from "../team-export.js";
import type { InstanceRecord } from "../registry.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

const STATE_DIR = "/opt/openclaw/.openclaw-test";
const CONFIG_PATH = `${STATE_DIR}/runtime.json`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-team-export-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedInstance(slug = "test-inst"): InstanceRecord {
  const server = registry.upsertLocalServer("testhost", "/opt/openclaw");
  return registry.createInstance({
    serverId: server.id,
    slug,
    port: 18790,
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    systemdUnit: `claw-runtime-${slug}`,
  });
}

/** Seed a minimal runtime.json in MockConnection */
function seedRuntimeJson(content: Record<string, unknown> = {}): void {
  conn.files.set(
    CONFIG_PATH,
    JSON.stringify({
      defaultModel: "anthropic/claude-haiku-4-5",
      agents: [],
      port: 18790,
      ...content,
    }),
  );
}

/** Seed a minimal runtime.json with a full agent entry */
function seedRuntimeJsonWithAgent(agentId: string, extra: Record<string, unknown> = {}): void {
  conn.files.set(
    CONFIG_PATH,
    JSON.stringify({
      defaultModel: "anthropic/claude-haiku-4-5",
      agents: [
        {
          id: agentId,
          name: "Pilot",
          isDefault: true,
          model: "anthropic/claude-haiku-4-5",
          toolProfile: "manager",
          permissions: [
            { permission: "*", pattern: "**", action: "allow" },
            { permission: "read", pattern: "*.env", action: "ask" },
          ],
          heartbeat: { every: "30m", prompt: "Check tasks" },
          humanDelay: { enabled: true, minMs: 500, maxMs: 2000 },
          ...extra,
        },
      ],
      port: 18790,
    }),
  );
}

// ---------------------------------------------------------------------------
// exportInstanceTeam tests
// ---------------------------------------------------------------------------

describe("exportInstanceTeam()", () => {
  it("basic export — returns TeamFile with agents and source slug", async () => {
    const instance = seedInstance("t1");
    seedRuntimeJson();

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);

    expect(team.version).toBe("2");
    expect(team.source).toBe("t1");
    expect(team.agents).toHaveLength(1);
    expect(team.agents[0]!.id).toBe("pilot");
    expect(team.agents[0]!.name).toBe("Pilot");
    expect(team.agents[0]!.is_default).toBe(true);
  });

  it("exports toolProfile from runtime.json agent entry", async () => {
    const instance = seedInstance("t2");
    seedRuntimeJsonWithAgent("pilot");

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);

    expect(team.agents[0]!.config?.toolProfile).toBe("manager");
  });

  it("exports permissions array from runtime.json agent entry", async () => {
    const instance = seedInstance("t3");
    seedRuntimeJsonWithAgent("pilot");

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);

    const perms = team.agents[0]!.config?.permissions as Array<{
      permission: string;
      pattern: string;
      action: string;
    }>;
    expect(Array.isArray(perms)).toBe(true);
    expect(perms).toHaveLength(2);
    expect(perms[0]!.permission).toBe("*");
    expect(perms[0]!.action).toBe("allow");
  });

  it("exports heartbeat and humanDelay from runtime.json agent entry", async () => {
    const instance = seedInstance("t4");
    seedRuntimeJsonWithAgent("pilot");

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);

    expect(team.agents[0]!.config?.heartbeat).toEqual({ every: "30m", prompt: "Check tasks" });
    expect(team.agents[0]!.config?.humanDelay).toEqual({ enabled: true, minMs: 500, maxMs: 2000 });
  });

  it("exports workspace files for EXPORTABLE_FILES only", async () => {
    const instance = seedInstance("t5");
    seedRuntimeJson();

    // Seed files in MockConnection at workspace paths (AgentSync reads from there)
    conn.files.set(`${STATE_DIR}/workspaces/pilot/SOUL.md`, "# Soul");
    conn.files.set(`${STATE_DIR}/workspaces/pilot/AGENTS.md`, "# Agents");
    conn.files.set(`${STATE_DIR}/workspaces/pilot/MEMORY.md`, "# Memory — should not be exported");

    const team = await exportInstanceTeam(conn, registry, instance);

    const files = team.agents[0]!.files ?? {};
    expect(Object.keys(files)).toContain("SOUL.md");
    expect(Object.keys(files)).toContain("AGENTS.md");
    expect(Object.keys(files)).not.toContain("MEMORY.md");
  });

  it("exports defaults.model from runtime.json defaultModel", async () => {
    const instance = seedInstance("t6");
    seedRuntimeJson({ defaultModel: "anthropic/claude-sonnet-4-5" });

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);

    expect(team.defaults?.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("exports links", async () => {
    const instance = seedInstance("t7");
    // runtime.json with 2 agents + spawn link via subagents.allowAgents
    conn.files.set(
      CONFIG_PATH,
      JSON.stringify({
        defaultModel: "anthropic/claude-haiku-4-5",
        agents: [
          {
            id: "main",
            name: "Main",
            isDefault: true,
            subagents: { allowAgents: ["dev"] },
          },
          { id: "dev", name: "Dev" },
        ],
        port: 18790,
      }),
    );

    const team = await exportInstanceTeam(conn, registry, instance);

    expect(team.links).toHaveLength(1);
    expect(team.links[0]!.source).toBe("main");
    expect(team.links[0]!.target).toBe("dev");
    expect(team.links[0]!.type).toBe("spawn");
  });
});

// ---------------------------------------------------------------------------
// exportBlueprintTeam tests
// ---------------------------------------------------------------------------

describe("exportBlueprintTeam()", () => {
  it("basic export — returns TeamFile with agents and source blueprint name", () => {
    const blueprint = registry.createBlueprint({ name: "My Team" });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      model: "anthropic/claude-haiku-4-5",
    });

    const team = exportBlueprintTeam(registry, blueprint.id);

    expect(team.version).toBe("2");
    expect(team.source).toBe("My Team");
    expect(team.agents).toHaveLength(1);
    expect(team.agents[0]!.id).toBe("pilot");
  });

  it("exports defaults.model from the default agent's model", () => {
    const blueprint = registry.createBlueprint({ name: "My Team" });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      model: "anthropic/claude-sonnet-4-5",
    });

    const team = exportBlueprintTeam(registry, blueprint.id);

    expect(team.defaults?.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("no defaults.model when default agent has no model", () => {
    const blueprint = registry.createBlueprint({ name: "My Team" });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
    });

    const team = exportBlueprintTeam(registry, blueprint.id);

    expect(team.defaults).toBeUndefined();
  });

  it("exports links", () => {
    const blueprint = registry.createBlueprint({ name: "My Team" });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
    });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "dev",
      name: "Dev",
      isDefault: false,
    });
    registry.replaceBlueprintLinks(blueprint.id, [
      { sourceAgentId: "pilot", targetAgentId: "dev", linkType: "a2a" },
    ]);

    const team = exportBlueprintTeam(registry, blueprint.id);

    expect(team.links).toHaveLength(1);
    expect(team.links[0]!.source).toBe("pilot");
    expect(team.links[0]!.target).toBe("dev");
    expect(team.links[0]!.type).toBe("a2a");
  });

  it("throws if blueprint not found", () => {
    expect(() => exportBlueprintTeam(registry, 9999)).toThrow("Blueprint 9999 not found");
  });
});

// ---------------------------------------------------------------------------
// serializeTeamYaml tests
// ---------------------------------------------------------------------------

describe("serializeTeamYaml()", () => {
  it("produces valid YAML string", () => {
    const team = {
      version: "1" as const,
      exported_at: "2026-01-01T00:00:00Z",
      source: "test",
      agents: [
        {
          id: "pilot",
          name: "Pilot",
          is_default: true,
          config: { model: "anthropic/claude-haiku-4-5", toolProfile: "manager" as const },
        },
      ],
      links: [],
    };

    const yaml = serializeTeamYaml(team);

    expect(typeof yaml).toBe("string");
    expect(yaml).toContain("version:");
    expect(yaml).toContain("agents:");
    expect(yaml).toContain("toolProfile: manager");
    expect(yaml).toContain("model: anthropic/claude-haiku-4-5");
  });

  it("uses literal blocks for multiline markdown content", () => {
    const team = {
      version: "1" as const,
      exported_at: "2026-01-01T00:00:00Z",
      source: "test",
      agents: [
        {
          id: "pilot",
          name: "Pilot",
          is_default: true,
          files: { "SOUL.md": "# Soul\n\nLine 2\n" },
        },
      ],
      links: [],
    };

    const yaml = serializeTeamYaml(team);

    // Literal block style uses | for multiline
    expect(yaml).toContain("SOUL.md: |");
  });
});

// ---------------------------------------------------------------------------
// config_json-based export tests (v2)
// ---------------------------------------------------------------------------

describe("exportInstanceTeam() — config_json source of truth", () => {
  it("exports v2 fields from config_json (persistence, thinking, agentToAgent)", async () => {
    const instance = seedInstance("cfg1");
    // Seed runtime.json with v2 fields — AgentSync reads this into config_json
    const richAgentConfig = {
      id: "pilot",
      name: "Pilot",
      isDefault: true,
      model: "anthropic/claude-opus-4-6",
      toolProfile: "manager",
      persistence: "permanent",
      thinking: { enabled: true, budgetTokens: 20000 },
      agentToAgent: { enabled: true, allowList: ["qa", "dev"] },
      archetype: "orchestrator",
      temperature: 0.7,
      maxSteps: 50,
      promptMode: "full",
    };
    conn.files.set(
      CONFIG_PATH,
      JSON.stringify({
        defaultModel: "anthropic/claude-opus-4-6",
        agents: [richAgentConfig],
        port: 18790,
      }),
    );

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);
    const config = team.agents[0]!.config!;

    expect(config.model).toBe("anthropic/claude-opus-4-6");
    expect(config["persistence"]).toBe("permanent");
    expect(config["thinking"]).toEqual({ enabled: true, budgetTokens: 20000 });
    expect(config["agentToAgent"]).toEqual({ enabled: true, allowList: ["qa", "dev"] });
    expect(config.archetype).toBe("orchestrator");
    expect(config["temperature"]).toBe(0.7);
    expect(config["maxSteps"]).toBe(50);
    expect(config["promptMode"]).toBe("full");
  });

  it("strips id, name, isDefault from config (they are top-level)", async () => {
    const instance = seedInstance("cfg3");
    conn.files.set(
      CONFIG_PATH,
      JSON.stringify({
        defaultModel: "anthropic/claude-haiku-4-5",
        agents: [
          {
            id: "pilot",
            name: "Pilot",
            isDefault: true,
            model: "anthropic/claude-haiku-4-5",
          },
        ],
        port: 18790,
      }),
    );

    registry.createAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      workspacePath: `${STATE_DIR}/workspaces/pilot`,
    });

    const team = await exportInstanceTeam(conn, registry, instance);
    const config = team.agents[0]!.config!;

    // These should not be in config — they are top-level YAML fields
    expect(config).not.toHaveProperty("id");
    expect(config).not.toHaveProperty("name");
    expect(config).not.toHaveProperty("isDefault");
    // But model should be there
    expect(config.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("exports BOOTSTRAP.md when present", async () => {
    const instance = seedInstance("cfg4");
    seedRuntimeJson();

    conn.files.set(`${STATE_DIR}/workspaces/pilot/BOOTSTRAP.md`, "# Bootstrap\nSetup instructions");
    conn.files.set(`${STATE_DIR}/workspaces/pilot/SOUL.md`, "# Soul");

    const team = await exportInstanceTeam(conn, registry, instance);

    const files = team.agents[0]!.files ?? {};
    expect(Object.keys(files)).toContain("BOOTSTRAP.md");
    expect(files["BOOTSTRAP.md"]).toBe("# Bootstrap\nSetup instructions");
  });
});

describe("exportBlueprintTeam() — config_json source of truth", () => {
  it("exports v2 fields from blueprint agent config_json", () => {
    const blueprint = registry.createBlueprint({ name: "Rich Team" });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      model: "anthropic/claude-haiku-4-5",
    });

    // Write config_json to the blueprint agent
    const agent = registry.listBlueprintAgents(blueprint.id)[0]!;
    db.prepare("UPDATE agents SET config_json = ? WHERE id = ?").run(
      JSON.stringify({
        id: "pilot",
        name: "Pilot",
        isDefault: true,
        model: "anthropic/claude-opus-4-6",
        persistence: "permanent",
        archetype: "orchestrator",
        thinking: { enabled: true, budgetTokens: 15000 },
      }),
      agent.id,
    );

    const team = exportBlueprintTeam(registry, blueprint.id);
    const config = team.agents[0]!.config!;

    expect(team.version).toBe("2");
    expect(config.model).toBe("anthropic/claude-opus-4-6");
    expect(config["persistence"]).toBe("permanent");
    expect(config.archetype).toBe("orchestrator");
    expect(config["thinking"]).toEqual({ enabled: true, budgetTokens: 15000 });
  });

  it("falls back to model field when config_json is null", () => {
    const blueprint = registry.createBlueprint({ name: "Legacy Team" });
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "pilot",
      name: "Pilot",
      isDefault: true,
      model: "anthropic/claude-haiku-4-5",
    });

    const team = exportBlueprintTeam(registry, blueprint.id);
    const config = team.agents[0]!.config!;

    expect(config.model).toBe("anthropic/claude-haiku-4-5");
  });
});
