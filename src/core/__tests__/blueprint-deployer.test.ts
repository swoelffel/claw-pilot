// src/core/__tests__/blueprint-deployer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { BlueprintDeployer } from "../blueprint-deployer.js";
import { MockConnection } from "./mock-connection.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

const STATE_DIR = "/opt/openclaw/.openclaw-test-inst";
const CONFIG_PATH = `${STATE_DIR}/runtime.json`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-bp-deploy-"));
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

/** Create a server + instance in the registry and seed a minimal runtime.json in MockConnection */
function seedInstance(): { instanceId: number; serverId: number } {
  const server = registry.upsertLocalServer("test-host", "/opt/openclaw");
  const instance = registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    displayName: "Test Instance",
    port: 18790,
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    systemdUnit: "openclaw-test-inst.service",
    discovered: false,
  });

  // Seed the main agent (created by Provisioner step 8)
  registry.createAgent(instance.id, {
    agentId: "main",
    name: "Main",
    workspacePath: `${STATE_DIR}/workspaces/main`,
    isDefault: true,
  });

  // Seed a minimal runtime.json (as written by Provisioner step 4)
  const config = {
    agents: [],
    defaultModel: "claude-3-5-sonnet",
    port: 18790,
  };
  conn.files.set(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Seed the main workspace directory (created by Provisioner step 5)
  conn.dirs.add(`${STATE_DIR}/workspaces`);
  conn.dirs.add(`${STATE_DIR}/workspaces/main`);
  // Seed generic template files (written by Provisioner step 5)
  conn.files.set(`${STATE_DIR}/workspaces/main/SOUL.md`, "# Generic SOUL template\n");
  conn.files.set(`${STATE_DIR}/workspaces/main/AGENTS.md`, "# Generic AGENTS template\n");

  return { instanceId: instance.id, serverId: server.id };
}

/** Create a blueprint with agents and files in the registry */
function seedBlueprint(opts: {
  agents: Array<{
    agentId: string;
    name: string;
    isDefault?: boolean;
    model?: string;
    position_x?: number;
    position_y?: number;
    files?: Array<{ filename: string; content: string }>;
  }>;
  links?: Array<{ source: string; target: string; type: "spawn" | "a2a" }>;
}): number {
  const bp = registry.createBlueprint({ name: "Test Blueprint" });

  for (const agent of opts.agents) {
    const bpAgent = registry.createBlueprintAgent(bp.id, {
      agentId: agent.agentId,
      name: agent.name,
      isDefault: agent.isDefault ?? false,
      ...(agent.model !== undefined && { model: agent.model }),
    });

    // Set canvas positions if provided
    if (agent.position_x != null && agent.position_y != null) {
      registry.updateBlueprintAgentPosition(bpAgent.id, agent.position_x, agent.position_y);
    }

    if (agent.files) {
      for (const file of agent.files) {
        registry.upsertAgentFile(bpAgent.id, {
          filename: file.filename,
          content: file.content,
          contentHash: "test-hash",
        });
      }
    }
  }

  if (opts.links) {
    registry.replaceBlueprintLinks(
      bp.id,
      opts.links.map((l) => ({
        sourceAgentId: l.source,
        targetAgentId: l.target,
        linkType: l.type,
      })),
    );
  }

  return bp.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BlueprintDeployer.deploy()", () => {
  it("main agent — files are written to workspaces/main/ (overwriting generic templates)", async () => {
    const { instanceId } = seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          files: [
            { filename: "SOUL.md", content: "# Custom SOUL from blueprint\n" },
            { filename: "AGENTS.md", content: "# Custom AGENTS from blueprint\n" },
          ],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    // Files should be written in the existing main workspace (overwriting templates)
    const soulPath = `${STATE_DIR}/workspaces/main/SOUL.md`;
    const agentsPath = `${STATE_DIR}/workspaces/main/AGENTS.md`;

    expect(conn.files.get(soulPath)).toBe("# Custom SOUL from blueprint\n");
    expect(conn.files.get(agentsPath)).toBe("# Custom AGENTS from blueprint\n");
  });

  it("main agent — added to agents[] with isDefault: true", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          files: [{ filename: "SOUL.md", content: "# Custom\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    // main should be in agents[] with isDefault: true
    expect(config.agents).toHaveLength(1);
    const mainEntry = config.agents[0];
    expect(mainEntry.id).toBe("main");
    expect(mainEntry.isDefault).toBe(true);
  });

  it("main agent — no new directory is created (workspace already exists)", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          files: [{ filename: "SOUL.md", content: "# Custom\n" }],
        },
      ],
    });

    const dirsBefore = new Set(conn.dirs);

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    // No new directories should have been created
    expect(conn.dirs).toEqual(dirsBefore);
  });

  it("secondary agent — workspace created in workspaces/<id>/", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "researcher",
          name: "Researcher",
          model: "claude-3-5-sonnet",
          files: [
            { filename: "SOUL.md", content: "# Researcher SOUL\n" },
            { filename: "AGENTS.md", content: "# Researcher AGENTS\n" },
          ],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    // Directory should be created under workspaces/
    const expectedDir = `${STATE_DIR}/workspaces/researcher`;
    expect(conn.dirs.has(expectedDir)).toBe(true);

    // Files should be written there
    expect(conn.files.get(`${expectedDir}/SOUL.md`)).toBe("# Researcher SOUL\n");
    expect(conn.files.get(`${expectedDir}/AGENTS.md`)).toBe("# Researcher AGENTS\n");
  });

  it("secondary agent — added to agents[] with correct id and name", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "researcher",
          name: "Researcher",
          model: "claude-3-5-sonnet",
          files: [{ filename: "SOUL.md", content: "# Researcher\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(config.agents).toHaveLength(1);

    const entry = config.agents[0];
    expect(entry.id).toBe("researcher");
    expect(entry.name).toBe("Researcher");
  });

  it("model is a plain string in agents[] for all agents", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          model: "anthropic/claude-3-5-sonnet",
          files: [{ filename: "SOUL.md", content: "# Main\n" }],
        },
        {
          agentId: "researcher",
          name: "Researcher",
          model: "openai/gpt-4o",
          files: [{ filename: "SOUL.md", content: "# Researcher\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    const mainEntry = config.agents.find((a: { id: string }) => a.id === "main");
    const researcherEntry = config.agents.find((a: { id: string }) => a.id === "researcher");

    // Both should have model as plain string
    expect(mainEntry.model).toBe("anthropic/claude-3-5-sonnet");
    expect(researcherEntry.model).toBe("openai/gpt-4o");
  });

  it("secondary agents do NOT have isDefault: true", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        { agentId: "main", name: "Main", isDefault: true },
        { agentId: "coder", name: "Coder" },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    const coderEntry = config.agents.find((a: { id: string }) => a.id === "coder");
    expect(coderEntry.isDefault).toBeUndefined();
  });

  it("multi-agent blueprint — main overwrites templates, secondaries get own workspaces", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          files: [{ filename: "SOUL.md", content: "# Blueprint Main SOUL\n" }],
        },
        {
          agentId: "coder",
          name: "Coder",
          files: [{ filename: "SOUL.md", content: "# Coder SOUL\n" }],
        },
        {
          agentId: "reviewer",
          name: "Reviewer",
          files: [{ filename: "SOUL.md", content: "# Reviewer SOUL\n" }],
        },
      ],
      links: [
        { source: "main", target: "coder", type: "spawn" },
        { source: "main", target: "reviewer", type: "spawn" },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    // Main: files overwritten in existing workspace
    expect(conn.files.get(`${STATE_DIR}/workspaces/main/SOUL.md`)).toBe("# Blueprint Main SOUL\n");

    // Secondaries: own workspaces created
    expect(conn.dirs.has(`${STATE_DIR}/workspaces/coder`)).toBe(true);
    expect(conn.dirs.has(`${STATE_DIR}/workspaces/reviewer`)).toBe(true);
    expect(conn.files.get(`${STATE_DIR}/workspaces/coder/SOUL.md`)).toBe("# Coder SOUL\n");
    expect(conn.files.get(`${STATE_DIR}/workspaces/reviewer/SOUL.md`)).toBe("# Reviewer SOUL\n");

    // Config: ALL agents in agents[] (main + secondaries)
    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(config.agents).toHaveLength(3);
    const ids = config.agents.map((a: { id: string }) => a.id).sort();
    expect(ids).toEqual(["coder", "main", "reviewer"]);

    // main should have isDefault: true
    const mainEntry = config.agents.find((a: { id: string }) => a.id === "main");
    expect(mainEntry.isDefault).toBe(true);
  });

  it("model already JSON-serialized in DB — parsed correctly (no double-wrapping)", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          model: '{"primary":"opencode/claude-sonnet-4-5"}', // JSON-serialized (as stored by blueprint editor)
          files: [{ filename: "SOUL.md", content: "# Main\n" }],
        },
        {
          agentId: "researcher",
          name: "Researcher",
          model: '{"primary":"opencode/claude-haiku-4-5"}',
          files: [{ filename: "SOUL.md", content: "# Researcher\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    const mainEntry = config.agents.find((a: { id: string }) => a.id === "main");
    const researcherEntry = config.agents.find((a: { id: string }) => a.id === "researcher");

    // Should be extracted primary strings, NOT double-wrapped
    expect(mainEntry.model).toBe("opencode/claude-sonnet-4-5");
    expect(researcherEntry.model).toBe("opencode/claude-haiku-4-5");
  });

  it("main agent — spawn links set allowSubAgents: true in agents[]", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        { agentId: "main", name: "Main", isDefault: true },
        { agentId: "lead-tech", name: "Lead Tech" },
        { agentId: "lead-product", name: "Lead Product" },
        { agentId: "lead-marketing", name: "Lead Marketing" },
      ],
      links: [
        { source: "main", target: "lead-tech", type: "spawn" },
        { source: "main", target: "lead-product", type: "spawn" },
        { source: "main", target: "lead-marketing", type: "spawn" },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    const mainEntry = config.agents.find((a: { id: string }) => a.id === "main");
    expect(mainEntry.allowSubAgents).toBe(true);
  });

  it("spawn links — set allowSubAgents: true on secondary agents with outgoing links", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        { agentId: "main", name: "Main", isDefault: true },
        { agentId: "coder", name: "Coder" },
        { agentId: "tester", name: "Tester" },
      ],
      links: [{ source: "coder", target: "tester", type: "spawn" }],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    const coderEntry = config.agents.find((a: { id: string }) => a.id === "coder");
    expect(coderEntry.allowSubAgents).toBe(true);

    // Tester has no outgoing spawn links
    const testerEntry = config.agents.find((a: { id: string }) => a.id === "tester");
    expect(testerEntry.allowSubAgents).toBeUndefined();
  });

  it("agents are registered in DB with correct workspace paths", async () => {
    const { instanceId } = seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          files: [{ filename: "SOUL.md", content: "# Main\n" }],
        },
        {
          agentId: "coder",
          name: "Coder",
          files: [{ filename: "SOUL.md", content: "# Coder\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const agents = registry.listAgents("test-inst");
    const mainAgent = agents.find((a) => a.agent_id === "main");
    const coderAgent = agents.find((a) => a.agent_id === "coder");

    expect(mainAgent).toBeDefined();
    expect(mainAgent!.workspace_path).toBe(`${STATE_DIR}/workspaces/main`);

    expect(coderAgent).toBeDefined();
    expect(coderAgent!.workspace_path).toBe(`${STATE_DIR}/workspaces/coder`);
  });

  it("agent files are copied to instance DB cache", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          files: [
            { filename: "SOUL.md", content: "# Custom SOUL\n" },
            { filename: "AGENTS.md", content: "# Custom AGENTS\n" },
          ],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const mainAgent = registry.getAgentByAgentId(instance.id, "main");
    expect(mainAgent).toBeDefined();

    const files = registry.listAgentFiles(mainAgent!.id);
    const filenames = files.map((f) => f.filename).sort();
    expect(filenames).toEqual(["AGENTS.md", "SOUL.md"]);
  });

  it("blueprint links are registered as instance links in DB", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        { agentId: "main", name: "Main", isDefault: true },
        { agentId: "coder", name: "Coder" },
        { agentId: "reviewer", name: "Reviewer" },
      ],
      links: [
        { source: "main", target: "coder", type: "spawn" },
        { source: "coder", target: "reviewer", type: "a2a" },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const links = registry.listAgentLinks(instance.id);
    expect(links).toHaveLength(2);
    expect(
      links.find((l) => l.source_agent_id === "main" && l.target_agent_id === "coder"),
    ).toBeDefined();
    expect(
      links.find((l) => l.source_agent_id === "coder" && l.target_agent_id === "reviewer"),
    ).toBeDefined();
  });

  it("empty blueprint — returns immediately, no changes", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    // Blueprint with no agents
    const bp = registry.createBlueprint({ name: "Empty Blueprint" });

    const configBefore = conn.files.get(CONFIG_PATH)!;

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bp.id, instance);

    // Config should be unchanged
    expect(conn.files.get(CONFIG_PATH)).toBe(configBefore);
  });

  it("secondary agent with no files — gets minimal placeholder files", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        { agentId: "helper", name: "Helper" }, // no files
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const wsDir = `${STATE_DIR}/workspaces/helper`;
    expect(conn.files.has(`${wsDir}/SOUL.md`)).toBe(true);
    expect(conn.files.has(`${wsDir}/AGENTS.md`)).toBe(true);
    expect(conn.files.get(`${wsDir}/SOUL.md`)).toBe("# Helper\n");
  });

  it("agent canvas positions are copied from blueprint to instance", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          position_x: 400,
          position_y: 300,
          files: [{ filename: "SOUL.md", content: "# Main\n" }],
        },
        {
          agentId: "coder",
          name: "Coder",
          position_x: 150,
          position_y: 500,
          files: [{ filename: "SOUL.md", content: "# Coder\n" }],
        },
        {
          agentId: "reviewer",
          name: "Reviewer",
          position_x: 650,
          position_y: 500,
          files: [{ filename: "SOUL.md", content: "# Reviewer\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const agents = registry.listAgents("test-inst");

    const mainAgent = agents.find((a) => a.agent_id === "main");
    expect(mainAgent).toBeDefined();
    expect(mainAgent!.position_x).toBe(400);
    expect(mainAgent!.position_y).toBe(300);

    const coderAgent = agents.find((a) => a.agent_id === "coder");
    expect(coderAgent).toBeDefined();
    expect(coderAgent!.position_x).toBe(150);
    expect(coderAgent!.position_y).toBe(500);

    const reviewerAgent = agents.find((a) => a.agent_id === "reviewer");
    expect(reviewerAgent).toBeDefined();
    expect(reviewerAgent!.position_x).toBe(650);
    expect(reviewerAgent!.position_y).toBe(500);
  });

  it("agents without blueprint positions — instance positions remain null", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        {
          agentId: "main",
          name: "Main",
          isDefault: true,
          // no position_x/position_y
          files: [{ filename: "SOUL.md", content: "# Main\n" }],
        },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const agents = registry.listAgents("test-inst");
    const mainAgent = agents.find((a) => a.agent_id === "main");
    expect(mainAgent).toBeDefined();
    expect(mainAgent!.position_x).toBeNull();
    expect(mainAgent!.position_y).toBeNull();
  });
});
