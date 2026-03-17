// src/core/__tests__/team-import.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { MockConnection } from "./mock-connection.js";
import { importBlueprintTeam, importInstanceTeam } from "../team-import.js";
import type { TeamFile } from "../team-schema.js";
import type { InstanceRecord } from "../registry.js";

// ---------------------------------------------------------------------------
// Mock platform.js to avoid real process spawning during lifecycle.restart()
// ---------------------------------------------------------------------------

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => "systemd" as const,
    SERVICE_MANAGER: "systemd" as const,
    getSystemdUnit: (slug: string) => `openclaw-${slug}.service`,
    getRuntimeStateDir: (slug: string) => `/opt/openclaw/.claw-pilot/instances/${slug}`,
    getRuntimePidPath: (stateDir: string) => `${stateDir}/runtime.pid`,
    // stopRuntime: getRuntimePid returns null → nothing to stop
    getRuntimePid: () => null,
    // startRuntime: isRuntimeRunning returns true → already running, returns immediately
    isRuntimeRunning: () => true,
    isDocker: () => false,
  };
});

// Mock ensureRuntimeConfig to avoid real filesystem operations
vi.mock("../../runtime/engine/config-loader.js", () => ({
  ensureRuntimeConfig: () => {},
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-team-import-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATE_DIR = "/opt/openclaw/.openclaw-test";
const CONFIG_PATH = `${STATE_DIR}/runtime.json`;

/** Minimal runtime.json for instance tests */
const MINIMAL_RUNTIME_JSON = JSON.stringify({
  defaultModel: "claude-3-5-sonnet-20241022",
  agents: [],
  port: 18790,
});

/** A minimal valid TeamFile with 2 agents and 1 link */
function makeTeam(overrides: Partial<TeamFile> = {}): TeamFile {
  return {
    version: "1",
    exported_at: "2026-01-01T00:00:00Z",
    source: "test",
    agents: [
      {
        id: "main",
        name: "Main",
        is_default: true,
        files: { "SOUL.md": "# Main soul" },
      },
      {
        id: "helper",
        name: "Helper",
        is_default: false,
        files: {},
      },
    ],
    links: [{ source: "main", target: "helper", type: "spawn" }],
    ...overrides,
  };
}

/** A minimal valid TeamFile with 1 agent (no links) */
function makeSingleAgentTeam(): TeamFile {
  return {
    version: "1",
    exported_at: "2026-01-01T00:00:00Z",
    agents: [
      {
        id: "main",
        name: "Main",
        is_default: true,
        files: { "SOUL.md": "# Soul content" },
      },
    ],
    links: [],
  };
}

/** Create a blueprint in the registry */
function seedBlueprint(name = "Test Blueprint") {
  return registry.createBlueprint({ name });
}

/** Create an instance in the registry */
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

// ---------------------------------------------------------------------------
// importBlueprintTeam tests
// ---------------------------------------------------------------------------

describe("importBlueprintTeam()", () => {
  it("happy path — imports 2 agents + 1 link, returns correct counts", async () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    const result = await importBlueprintTeam(db, registry, blueprint.id, team);

    expect(result.ok).toBe(true);
    if (!("dry_run" in result)) {
      expect(result.agents_imported).toBe(2);
      expect(result.links_imported).toBe(1);
      // main has SOUL.md (1 from YAML) + 5 gap-filled (AGENTS, TOOLS, IDENTITY, USER, HEARTBEAT)
      // helper has 0 from YAML + 6 gap-filled (all EXPORTABLE_FILES)
      expect(result.files_written).toBe(12);
    }
  });

  it("happy path — agents are persisted in DB", async () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    await importBlueprintTeam(db, registry, blueprint.id, team);

    const agents = registry.listBlueprintAgents(blueprint.id);
    expect(agents).toHaveLength(2);
    const agentIds = agents.map((a) => a.agent_id);
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("helper");
  });

  it("happy path — links are persisted in DB", async () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    await importBlueprintTeam(db, registry, blueprint.id, team);

    const links = registry.listBlueprintLinks(blueprint.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.source_agent_id).toBe("main");
    expect(links[0]!.target_agent_id).toBe("helper");
    expect(links[0]!.link_type).toBe("spawn");
  });

  it("dry-run — returns dry_run summary without writing to DB", async () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    const result = await importBlueprintTeam(db, registry, blueprint.id, team, true);

    expect(result.ok).toBe(true);
    expect("dry_run" in result && result.dry_run).toBe(true);

    if ("dry_run" in result) {
      expect(result.summary.agents_to_import).toBe(2);
      expect(result.summary.links_to_import).toBe(1);
      expect(result.summary.files_to_write).toBe(1);
      expect(result.summary.agents_to_remove).toBe(0); // no existing agents
      expect(result.summary.current_agent_count).toBe(0);
    }

    // No agents should have been written to DB
    const agents = registry.listBlueprintAgents(blueprint.id);
    expect(agents).toHaveLength(0);
  });

  it("dry-run — reflects existing agent count in summary", async () => {
    const blueprint = seedBlueprint();

    // Pre-seed an agent in the blueprint
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "existing",
      name: "Existing",
      isDefault: true,
    });

    const team = makeTeam();
    const result = await importBlueprintTeam(db, registry, blueprint.id, team, true);

    if ("dry_run" in result) {
      expect(result.summary.agents_to_remove).toBe(1);
      expect(result.summary.current_agent_count).toBe(1);
    }
  });

  it("replaces existing agents — old agents are deleted before import", async () => {
    const blueprint = seedBlueprint();

    // Pre-seed an agent that should be replaced
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "old-agent",
      name: "Old Agent",
      isDefault: true,
    });

    expect(registry.listBlueprintAgents(blueprint.id)).toHaveLength(1);

    const team = makeTeam();
    await importBlueprintTeam(db, registry, blueprint.id, team);

    // Old agent should be gone, new agents should be present
    const agents = registry.listBlueprintAgents(blueprint.id);
    expect(agents).toHaveLength(2);
    const agentIds = agents.map((a) => a.agent_id);
    expect(agentIds).not.toContain("old-agent");
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("helper");
  });

  it("throws if blueprint not found", async () => {
    const team = makeTeam();
    await expect(importBlueprintTeam(db, registry, 9999, team)).rejects.toThrow(
      "Blueprint 9999 not found",
    );
  });
});

// ---------------------------------------------------------------------------
// importInstanceTeam tests
// ---------------------------------------------------------------------------

describe("importInstanceTeam()", () => {
  it("dry-run — returns dry_run summary without DB writes", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const team = makeTeam();
    const result = await importInstanceTeam(
      db,
      registry,
      conn,
      instance,
      team,
      "/run/user/1000",
      true, // dryRun
    );

    expect(result.ok).toBe(true);
    expect("dry_run" in result && result.dry_run).toBe(true);

    if ("dry_run" in result) {
      expect(result.summary.agents_to_import).toBe(2);
      expect(result.summary.links_to_import).toBe(1);
      expect(result.summary.files_to_write).toBe(1);
    }

    // No agents should have been written to DB
    const agents = registry.listAgents("test-inst");
    expect(agents).toHaveLength(0);
  });

  it("dry-run — conn.writeFile is NOT called", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const writeFileSpy = vi.spyOn(conn, "writeFile");

    const team = makeTeam();
    await importInstanceTeam(
      db,
      registry,
      conn,
      instance,
      team,
      "/run/user/1000",
      true, // dryRun
    );

    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it("happy path — DB transaction runs, agents are in registry", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const team = makeTeam();
    const result = await importInstanceTeam(db, registry, conn, instance, team, "/run/user/1000");

    expect(result.ok).toBe(true);
    if (!("dry_run" in result)) {
      expect(result.agents_imported).toBe(2);
      expect(result.links_imported).toBe(1);
    }

    // Agents should be in registry
    const agents = registry.listAgents("test-inst");
    expect(agents).toHaveLength(2);
    const agentIds = agents.map((a) => a.agent_id);
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("helper");
  });

  it("happy path — conn.writeFile is called for runtime.json", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const writeFileSpy = vi.spyOn(conn, "writeFile");

    const team = makeSingleAgentTeam();
    await importInstanceTeam(db, registry, conn, instance, team, "/run/user/1000");

    // writeFile should have been called at least once (for runtime.json)
    expect(writeFileSpy).toHaveBeenCalled();

    // The config path should have been written
    const configWriteCall = writeFileSpy.mock.calls.find(([filePath]) => filePath === CONFIG_PATH);
    expect(configWriteCall).toBeDefined();
  });

  it("happy path — workspace files are written to disk", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const team = makeSingleAgentTeam(); // has SOUL.md for main agent

    await importInstanceTeam(db, registry, conn, instance, team, "/run/user/1000");

    // SOUL.md should be written to the main agent's workspace
    const soulPath = path.join(STATE_DIR, "workspaces", "workspace", "SOUL.md");
    expect(conn.files.has(soulPath)).toBe(true);
    expect(conn.files.get(soulPath)).toBe("# Soul content");
  });

  it("happy path — files_written includes YAML files + gap-filled templates", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const team = makeTeam(); // main has SOUL.md (1 file), helper has no files

    const result = await importInstanceTeam(db, registry, conn, instance, team, "/run/user/1000");

    if (!("dry_run" in result)) {
      // main: 1 YAML (SOUL.md) + 5 gap-filled (AGENTS, TOOLS, IDENTITY, USER, HEARTBEAT) = 6
      // helper: 0 YAML + 6 gap-filled (all EXPORTABLE_FILES) = 6
      // Total: 12
      expect(result.files_written).toBe(12);
    }
  });
});

// ---------------------------------------------------------------------------
// Gap-fill tests (workspace files)
// ---------------------------------------------------------------------------

describe("gap-fill — missing workspace files seeded from templates", () => {
  it("blueprint import — partial files get gap-filled to all 6 EXPORTABLE_FILES", async () => {
    const blueprint = seedBlueprint();
    // Agent with only AGENTS.md and SOUL.md — missing TOOLS, IDENTITY, USER, HEARTBEAT
    const team: TeamFile = {
      version: "1",
      exported_at: "2026-01-01T00:00:00Z",
      agents: [
        {
          id: "main",
          name: "Main",
          is_default: true,
          files: { "AGENTS.md": "# Custom agents", "SOUL.md": "# Custom soul" },
        },
      ],
      links: [],
    };

    await importBlueprintTeam(db, registry, blueprint.id, team);

    const agents = registry.listBlueprintAgents(blueprint.id);
    expect(agents).toHaveLength(1);

    const files = registry.listAgentFiles(agents[0]!.id);
    const filenames = files.map((f) => f.filename).sort();

    // Should have all 6 EXPORTABLE_FILES
    expect(filenames).toEqual([
      "AGENTS.md",
      "HEARTBEAT.md",
      "IDENTITY.md",
      "SOUL.md",
      "TOOLS.md",
      "USER.md",
    ]);
  });

  it("blueprint import — YAML-provided files are NOT overwritten by templates", async () => {
    const blueprint = seedBlueprint();
    const customContent = "# My custom SOUL content — do not overwrite";
    const team: TeamFile = {
      version: "1",
      exported_at: "2026-01-01T00:00:00Z",
      agents: [
        {
          id: "main",
          name: "Main",
          is_default: true,
          files: { "SOUL.md": customContent },
        },
      ],
      links: [],
    };

    await importBlueprintTeam(db, registry, blueprint.id, team);

    const agents = registry.listBlueprintAgents(blueprint.id);
    const soulFile = registry.getAgentFileContent(agents[0]!.id, "SOUL.md");
    expect(soulFile?.content).toBe(customContent);
  });

  it("blueprint import — agent with ALL 6 files gets zero gap-fills", async () => {
    const blueprint = seedBlueprint();
    const team: TeamFile = {
      version: "1",
      exported_at: "2026-01-01T00:00:00Z",
      agents: [
        {
          id: "main",
          name: "Main",
          is_default: true,
          files: {
            "AGENTS.md": "# A",
            "SOUL.md": "# S",
            "TOOLS.md": "# T",
            "IDENTITY.md": "# I",
            "USER.md": "# U",
            "HEARTBEAT.md": "# H",
          },
        },
      ],
      links: [],
    };

    const result = await importBlueprintTeam(db, registry, blueprint.id, team);

    if (!("dry_run" in result)) {
      // 6 YAML files, 0 gap-filled
      expect(result.files_written).toBe(6);
    }
  });

  it("instance import — gap-filled files are written to disk", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    // Agent with only USER.md — missing 5 other EXPORTABLE_FILES
    const team: TeamFile = {
      version: "1",
      exported_at: "2026-01-01T00:00:00Z",
      agents: [
        {
          id: "main",
          name: "Main",
          is_default: true,
          files: { "USER.md": "# Custom user" },
        },
      ],
      links: [],
    };

    await importInstanceTeam(db, registry, conn, instance, team, "/run/user/1000");

    const workspaceDir = path.join(STATE_DIR, "workspaces", "workspace");

    // USER.md should have the YAML content
    expect(conn.files.get(path.join(workspaceDir, "USER.md"))).toBe("# Custom user");

    // Gap-filled files should exist on disk
    for (const filename of ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "HEARTBEAT.md"]) {
      const filePath = path.join(workspaceDir, filename);
      expect(conn.files.has(filePath)).toBe(true);
      // Gap-filled content should not be empty
      expect(conn.files.get(filePath)!.length).toBeGreaterThan(0);
    }
  });

  it("instance import — gap-filled files are also in DB", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_RUNTIME_JSON);

    const team: TeamFile = {
      version: "1",
      exported_at: "2026-01-01T00:00:00Z",
      agents: [
        {
          id: "main",
          name: "Main",
          is_default: true,
          files: { "SOUL.md": "# Soul" },
        },
      ],
      links: [],
    };

    await importInstanceTeam(db, registry, conn, instance, team, "/run/user/1000");

    // Check DB has all 6 files for the agent
    const agents = registry.listAgents("test-inst");
    expect(agents).toHaveLength(1);
    const files = registry.listAgentFiles(agents[0]!.id);
    const filenames = files.map((f) => f.filename).sort();
    expect(filenames).toEqual([
      "AGENTS.md",
      "HEARTBEAT.md",
      "IDENTITY.md",
      "SOUL.md",
      "TOOLS.md",
      "USER.md",
    ]);
  });
});
