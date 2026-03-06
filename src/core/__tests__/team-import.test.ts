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
// Mock platform.js to avoid systemd calls during restartDaemon
// ---------------------------------------------------------------------------

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => "systemd" as const,
    SERVICE_MANAGER: "systemd" as const,
    getSystemdUnit: (slug: string) => `openclaw-${slug}.service`,
  };
});

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
const CONFIG_PATH = `${STATE_DIR}/openclaw.json`;

/** Minimal openclaw.json for instance tests */
const MINIMAL_OPENCLAW_JSON = JSON.stringify({
  agents: {
    defaults: { model: "claude-3-5-sonnet-20241022" },
    list: [],
  },
  gateway: { port: 18790 },
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
    links: [
      { source: "main", target: "helper", type: "spawn" },
    ],
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
    systemdUnit: `openclaw-${slug}.service`,
  });
}

// ---------------------------------------------------------------------------
// importBlueprintTeam tests
// ---------------------------------------------------------------------------

describe("importBlueprintTeam()", () => {
  it("happy path — imports 2 agents + 1 link, returns correct counts", () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    const result = importBlueprintTeam(db, registry, blueprint.id, team);

    expect(result.ok).toBe(true);
    if (!("dry_run" in result)) {
      expect(result.agents_imported).toBe(2);
      expect(result.links_imported).toBe(1);
      expect(result.files_written).toBe(1); // only main has a file (SOUL.md)
    }
  });

  it("happy path — agents are persisted in DB", () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    importBlueprintTeam(db, registry, blueprint.id, team);

    const agents = registry.listBlueprintAgents(blueprint.id);
    expect(agents).toHaveLength(2);
    const agentIds = agents.map((a) => a.agent_id);
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("helper");
  });

  it("happy path — links are persisted in DB", () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    importBlueprintTeam(db, registry, blueprint.id, team);

    const links = registry.listBlueprintLinks(blueprint.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.source_agent_id).toBe("main");
    expect(links[0]!.target_agent_id).toBe("helper");
    expect(links[0]!.link_type).toBe("spawn");
  });

  it("dry-run — returns dry_run summary without writing to DB", () => {
    const blueprint = seedBlueprint();
    const team = makeTeam();

    const result = importBlueprintTeam(db, registry, blueprint.id, team, true);

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

  it("dry-run — reflects existing agent count in summary", () => {
    const blueprint = seedBlueprint();

    // Pre-seed an agent in the blueprint
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "existing",
      name: "Existing",
      isDefault: true,
    });

    const team = makeTeam();
    const result = importBlueprintTeam(db, registry, blueprint.id, team, true);

    if ("dry_run" in result) {
      expect(result.summary.agents_to_remove).toBe(1);
      expect(result.summary.current_agent_count).toBe(1);
    }
  });

  it("replaces existing agents — old agents are deleted before import", () => {
    const blueprint = seedBlueprint();

    // Pre-seed an agent that should be replaced
    registry.createBlueprintAgent(blueprint.id, {
      agentId: "old-agent",
      name: "Old Agent",
      isDefault: true,
    });

    expect(registry.listBlueprintAgents(blueprint.id)).toHaveLength(1);

    const team = makeTeam();
    importBlueprintTeam(db, registry, blueprint.id, team);

    // Old agent should be gone, new agents should be present
    const agents = registry.listBlueprintAgents(blueprint.id);
    expect(agents).toHaveLength(2);
    const agentIds = agents.map((a) => a.agent_id);
    expect(agentIds).not.toContain("old-agent");
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("helper");
  });

  it("throws if blueprint not found", () => {
    const team = makeTeam();
    expect(() => importBlueprintTeam(db, registry, 9999, team)).toThrow(
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
    conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);

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
    conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);

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
    conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);

    const team = makeTeam();
    const result = await importInstanceTeam(
      db,
      registry,
      conn,
      instance,
      team,
      "/run/user/1000",
    );

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

  it("happy path — conn.writeFile is called for openclaw.json", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);

    const writeFileSpy = vi.spyOn(conn, "writeFile");

    const team = makeSingleAgentTeam();
    await importInstanceTeam(
      db,
      registry,
      conn,
      instance,
      team,
      "/run/user/1000",
    );

    // writeFile should have been called at least once (for openclaw.json)
    expect(writeFileSpy).toHaveBeenCalled();

    // The config path should have been written
    const configWriteCall = writeFileSpy.mock.calls.find(
      ([filePath]) => filePath === CONFIG_PATH,
    );
    expect(configWriteCall).toBeDefined();
  });

  it("happy path — workspace files are written to disk", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);

    const team = makeSingleAgentTeam(); // has SOUL.md for main agent

    await importInstanceTeam(
      db,
      registry,
      conn,
      instance,
      team,
      "/run/user/1000",
    );

    // SOUL.md should be written to the main agent's workspace
    const soulPath = path.join(STATE_DIR, "workspaces", "workspace", "SOUL.md");
    expect(conn.files.has(soulPath)).toBe(true);
    expect(conn.files.get(soulPath)).toBe("# Soul content");
  });

  it("happy path — files_written count matches team files", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_OPENCLAW_JSON);

    const team = makeTeam(); // main has SOUL.md (1 file), helper has no files

    const result = await importInstanceTeam(
      db,
      registry,
      conn,
      instance,
      team,
      "/run/user/1000",
    );

    if (!("dry_run" in result)) {
      expect(result.files_written).toBe(1);
    }
  });
});
