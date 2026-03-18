// src/core/__tests__/agent-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { AgentSync } from "../agent-sync.js";
import { MockConnection } from "./mock-connection.js";
import type { InstanceRecord } from "../registry.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-agent-sync-"));
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

const STATE_DIR = "/opt/openclaw/.openclaw-test";
const CONFIG_PATH = `${STATE_DIR}/runtime.json`;

/** Minimal runtime.json with no agents (empty array → synthetic "pilot" agent) */
const MINIMAL_CONFIG = JSON.stringify({
  defaultModel: "claude-3-5-sonnet-20241022",
  agents: [],
});

/** Config with two agents: main + helper */
const MULTI_AGENT_CONFIG = JSON.stringify({
  defaultModel: "claude-3-5-sonnet-20241022",
  agents: [
    { id: "main", name: "Main", isDefault: true, workspace: "workspace" },
    { id: "helper", name: "Helper", workspace: "workspace-helper" },
  ],
});

/** Create a minimal instance in the registry */
function seedInstance(slug = "test-inst"): InstanceRecord {
  const server = registry.upsertLocalServer("testhost", "/opt/openclaw");
  const instance = registry.createInstance({
    serverId: server.id,
    slug,
    port: 18790,
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    systemdUnit: `claw-runtime-${slug}`,
  });
  return instance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentSync.sync()", () => {
  it("agent added — new agent in config is added to registry", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MULTI_AGENT_CONFIG);

    const agentSync = new AgentSync(conn, registry);
    const result = await agentSync.sync(instance);

    // "main" is always added (it's always in config), "helper" is new
    expect(result.changes.agentsAdded).toContain("helper");
    expect(result.changes.agentsAdded).toContain("main");

    // Both agents should be in the registry
    const agents = registry.listAgents("test-inst");
    const agentIds = agents.map((a) => a.agent_id);
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("helper");
  });

  it("agent updated — changed model triggers agentsUpdated", async () => {
    const instance = seedInstance();

    // First sync: establish baseline with minimal config
    conn.files.set(CONFIG_PATH, MINIMAL_CONFIG);
    const agentSync = new AgentSync(conn, registry);
    await agentSync.sync(instance);

    // Second sync: change the default model
    const updatedConfig = JSON.stringify({
      defaultModel: "claude-3-opus-20240229", // different model
      agents: [],
    });
    conn.files.set(CONFIG_PATH, updatedConfig);

    const result = await agentSync.sync(instance);

    // "pilot" agent config changed (model changed) → should be in agentsUpdated
    expect(result.changes.agentsUpdated).toContain("pilot");
    expect(result.changes.agentsAdded).toHaveLength(0);
  });

  it("agent removed — DB agent not in config is removed", async () => {
    const instance = seedInstance();

    // First sync: add "helper" agent
    conn.files.set(CONFIG_PATH, MULTI_AGENT_CONFIG);
    const agentSync = new AgentSync(conn, registry);
    await agentSync.sync(instance);

    // Verify helper is in registry
    expect(registry.listAgents("test-inst").map((a) => a.agent_id)).toContain("helper");

    // Second sync: config no longer has "helper"
    conn.files.set(CONFIG_PATH, MINIMAL_CONFIG);
    const result = await agentSync.sync(instance);

    expect(result.changes.agentsRemoved).toContain("helper");

    // Helper should be gone from registry
    const agents = registry.listAgents("test-inst");
    expect(agents.map((a) => a.agent_id)).not.toContain("helper");
  });

  it("no changes — config matches DB exactly → all change arrays empty", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_CONFIG);

    const agentSync = new AgentSync(conn, registry);

    // First sync establishes baseline
    await agentSync.sync(instance);

    // Second sync with same config — no changes
    const result = await agentSync.sync(instance);

    expect(result.changes.agentsAdded).toHaveLength(0);
    expect(result.changes.agentsRemoved).toHaveLength(0);
    expect(result.changes.agentsUpdated).toHaveLength(0);
  });

  it("workspace files synced — file in workspace dir appears in agent files", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_CONFIG);

    // With MINIMAL_CONFIG (empty agents array), synthetic pilot agent workspace is stateDir/workspaces/pilot
    const workspacePath = `${STATE_DIR}/workspaces/pilot`;
    conn.files.set(`${workspacePath}/SOUL.md`, "# Soul\nThis is the soul file.");

    const agentSync = new AgentSync(conn, registry);
    const result = await agentSync.sync(instance);

    // Find the pilot agent in the result
    const mainAgent = result.agents.find((a) => a.agent_id === "pilot");
    expect(mainAgent).toBeDefined();

    // SOUL.md should be in the files list
    const soulFile = mainAgent!.files.find((f) => f.filename === "SOUL.md");
    expect(soulFile).toBeDefined();
    expect(soulFile!.size).toBeGreaterThan(0);
    expect(soulFile!.content_hash).toBeTruthy();
  });

  it("workspace files synced — multiple files are discovered", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MINIMAL_CONFIG);

    // With MINIMAL_CONFIG (empty agents array), synthetic pilot agent workspace is stateDir/workspaces/pilot
    const workspacePath = `${STATE_DIR}/workspaces/pilot`;
    conn.files.set(`${workspacePath}/AGENTS.md`, "# Agents");
    conn.files.set(`${workspacePath}/SOUL.md`, "# Soul");
    conn.files.set(`${workspacePath}/TOOLS.md`, "# Tools");

    const agentSync = new AgentSync(conn, registry);
    const result = await agentSync.sync(instance);

    const mainAgent = result.agents.find((a) => a.agent_id === "pilot");
    expect(mainAgent).toBeDefined();
    expect(mainAgent!.files).toHaveLength(3);

    const filenames = mainAgent!.files.map((f) => f.filename);
    expect(filenames).toContain("AGENTS.md");
    expect(filenames).toContain("SOUL.md");
    expect(filenames).toContain("TOOLS.md");
  });

  it("returns correct agent structure for multi-agent config", async () => {
    const instance = seedInstance();
    conn.files.set(CONFIG_PATH, MULTI_AGENT_CONFIG);

    const agentSync = new AgentSync(conn, registry);
    const result = await agentSync.sync(instance);

    expect(result.agents).toHaveLength(2);

    const mainAgent = result.agents.find((a) => a.agent_id === "main");
    const helperAgent = result.agents.find((a) => a.agent_id === "helper");

    expect(mainAgent).toBeDefined();
    expect(mainAgent!.is_default).toBe(true);

    expect(helperAgent).toBeDefined();
    expect(helperAgent!.is_default).toBe(false);
  });

  it("agent updated — existing canvas positions are preserved", async () => {
    const instance = seedInstance();

    // First sync: establish baseline
    conn.files.set(CONFIG_PATH, MINIMAL_CONFIG);
    const agentSync = new AgentSync(conn, registry);
    await agentSync.sync(instance);

    // Set positions on the pilot agent (simulates blueprint deploy or user drag)
    const mainAgent = registry.listAgents("test-inst").find((a) => a.agent_id === "pilot");
    expect(mainAgent).toBeDefined();
    registry.updateAgentPosition(mainAgent!.id, 400, 300);

    // Verify position is set
    const before = registry.getAgentByAgentId(instance.id, "pilot");
    expect(before!.position_x).toBe(400);
    expect(before!.position_y).toBe(300);

    // Second sync: config changes (model changed) → triggers upsert
    const updatedConfig = JSON.stringify({
      defaultModel: "claude-3-opus-20240229",
      agents: [],
    });
    conn.files.set(CONFIG_PATH, updatedConfig);
    const result = await agentSync.sync(instance);

    expect(result.changes.agentsUpdated).toContain("pilot");

    // Positions must be preserved after sync
    const after = registry.getAgentByAgentId(instance.id, "pilot");
    expect(after!.position_x).toBe(400);
    expect(after!.position_y).toBe(300);
  });

  it("upsertAgent with null positions does not overwrite existing positions (COALESCE)", async () => {
    const instance = seedInstance();

    // Create agent with positions via upsert
    registry.upsertAgent(instance.id, {
      agentId: "test-agent",
      name: "Test",
      workspacePath: "/tmp/test",
      position_x: 250,
      position_y: 500,
    });

    const before = registry.getAgentByAgentId(instance.id, "test-agent");
    expect(before!.position_x).toBe(250);
    expect(before!.position_y).toBe(500);

    // Upsert again WITHOUT positions (simulates a caller that omits them)
    registry.upsertAgent(instance.id, {
      agentId: "test-agent",
      name: "Test Updated",
      workspacePath: "/tmp/test",
    });

    // Positions must NOT be wiped to null
    const after = registry.getAgentByAgentId(instance.id, "test-agent");
    expect(after!.name).toBe("Test Updated");
    expect(after!.position_x).toBe(250);
    expect(after!.position_y).toBe(500);
  });
});
