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
const CONFIG_PATH = `${STATE_DIR}/openclaw.json`;

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

/** Create a server + instance in the registry and seed a minimal openclaw.json in MockConnection */
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
    workspacePath: `${STATE_DIR}/workspaces/workspace`,
    isDefault: true,
  });

  // Seed a minimal openclaw.json (as written by Provisioner step 4)
  const config = {
    agents: {
      defaults: { model: { primary: "claude-3-5-sonnet" }, workspace: "workspace" },
    },
    gateway: { port: 18790 },
  };
  conn.files.set(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Seed the main workspace directory (created by Provisioner step 5)
  conn.dirs.add(`${STATE_DIR}/workspaces`);
  conn.dirs.add(`${STATE_DIR}/workspaces/workspace`);
  // Seed generic template files (written by Provisioner step 5)
  conn.files.set(`${STATE_DIR}/workspaces/workspace/SOUL.md`, "# Generic SOUL template\n");
  conn.files.set(`${STATE_DIR}/workspaces/workspace/AGENTS.md`, "# Generic AGENTS template\n");

  return { instanceId: instance.id, serverId: server.id };
}

/** Create a blueprint with agents and files in the registry */
function seedBlueprint(opts: {
  agents: Array<{
    agentId: string;
    name: string;
    isDefault?: boolean;
    model?: string;
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
      model: agent.model,
    });

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
  it("main agent — files are written to workspaces/workspace/ (overwriting generic templates)", async () => {
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
    const soulPath = `${STATE_DIR}/workspaces/workspace/SOUL.md`;
    const agentsPath = `${STATE_DIR}/workspaces/workspace/AGENTS.md`;

    expect(conn.files.get(soulPath)).toBe("# Custom SOUL from blueprint\n");
    expect(conn.files.get(agentsPath)).toBe("# Custom AGENTS from blueprint\n");
  });

  it("main agent — added to agents.list[] with default: true", async () => {
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
    // main should be in agents.list[] with default: true
    expect(config.agents.list).toHaveLength(1);
    const mainEntry = config.agents.list[0];
    expect(mainEntry.id).toBe("main");
    expect(mainEntry.default).toBe(true);
    expect(mainEntry.workspace).toBe("workspace");
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

  it("secondary agent — workspace created in workspaces/workspace-<id>/", async () => {
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
    const expectedDir = `${STATE_DIR}/workspaces/workspace-researcher`;
    expect(conn.dirs.has(expectedDir)).toBe(true);

    // Files should be written there
    expect(conn.files.get(`${expectedDir}/SOUL.md`)).toBe("# Researcher SOUL\n");
    expect(conn.files.get(`${expectedDir}/AGENTS.md`)).toBe("# Researcher AGENTS\n");
  });

  it("secondary agent — added to agents.list[] with RELATIVE workspace path", async () => {
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
    expect(config.agents.list).toHaveLength(1);

    const entry = config.agents.list[0];
    expect(entry.id).toBe("researcher");
    expect(entry.name).toBe("Researcher");
    // Workspace must be a RELATIVE path (not absolute)
    expect(entry.workspace).toBe("workspace-researcher");
    expect(entry.workspace).not.toContain("/");
  });

  it("model is wrapped as { primary: ... } in agents.list[] for all agents", async () => {
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
    const mainEntry = config.agents.list.find((a: { id: string }) => a.id === "main");
    const researcherEntry = config.agents.list.find((a: { id: string }) => a.id === "researcher");

    // Both should have model wrapped as { primary: "..." }
    expect(mainEntry.model).toEqual({ primary: "anthropic/claude-3-5-sonnet" });
    expect(researcherEntry.model).toEqual({ primary: "openai/gpt-4o" });
  });

  it("secondary agents do NOT have default: true", async () => {
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
    const coderEntry = config.agents.list.find((a: { id: string }) => a.id === "coder");
    expect(coderEntry.default).toBeUndefined();
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
    expect(conn.files.get(`${STATE_DIR}/workspaces/workspace/SOUL.md`)).toBe("# Blueprint Main SOUL\n");

    // Secondaries: own workspaces created
    expect(conn.dirs.has(`${STATE_DIR}/workspaces/workspace-coder`)).toBe(true);
    expect(conn.dirs.has(`${STATE_DIR}/workspaces/workspace-reviewer`)).toBe(true);
    expect(conn.files.get(`${STATE_DIR}/workspaces/workspace-coder/SOUL.md`)).toBe("# Coder SOUL\n");
    expect(conn.files.get(`${STATE_DIR}/workspaces/workspace-reviewer/SOUL.md`)).toBe("# Reviewer SOUL\n");

    // Config: ALL agents in agents.list[] (main + secondaries)
    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    expect(config.agents.list).toHaveLength(3);
    const ids = config.agents.list.map((a: { id: string }) => a.id).sort();
    expect(ids).toEqual(["coder", "main", "reviewer"]);

    // main should have default: true
    const mainEntry = config.agents.list.find((a: { id: string }) => a.id === "main");
    expect(mainEntry.default).toBe(true);

    // All workspace paths in config should be relative
    for (const entry of config.agents.list) {
      expect(entry.workspace).not.toContain("/");
    }
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
    const mainEntry = config.agents.list.find((a: { id: string }) => a.id === "main");
    const researcherEntry = config.agents.list.find((a: { id: string }) => a.id === "researcher");

    // Should be parsed objects, NOT double-wrapped strings
    expect(mainEntry.model).toEqual({ primary: "opencode/claude-sonnet-4-5" });
    expect(researcherEntry.model).toEqual({ primary: "opencode/claude-haiku-4-5" });
  });

  it("main agent — spawn links included in agents.list[] as subagents.allowAgents", async () => {
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
    const mainEntry = config.agents.list.find((a: { id: string }) => a.id === "main");
    expect(mainEntry.subagents.allowAgents.sort()).toEqual(
      ["lead-marketing", "lead-product", "lead-tech"],
    );
  });

  it("spawn links — added as subagents.allowAgents on secondary agents", async () => {
    seedInstance();
    const instance = registry.getInstance("test-inst")!;

    const bpId = seedBlueprint({
      agents: [
        { agentId: "main", name: "Main", isDefault: true },
        { agentId: "coder", name: "Coder" },
        { agentId: "tester", name: "Tester" },
      ],
      links: [
        { source: "coder", target: "tester", type: "spawn" },
      ],
    });

    const deployer = new BlueprintDeployer(conn, registry);
    await deployer.deploy(bpId, instance);

    const config = JSON.parse(conn.files.get(CONFIG_PATH)!);
    const coderEntry = config.agents.list.find((a: { id: string }) => a.id === "coder");
    expect(coderEntry.subagents).toEqual({ allowAgents: ["tester"] });

    // Tester has no outgoing spawn links
    const testerEntry = config.agents.list.find((a: { id: string }) => a.id === "tester");
    expect(testerEntry.subagents).toBeUndefined();
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
    expect(mainAgent!.workspace_path).toBe(`${STATE_DIR}/workspaces/workspace`);

    expect(coderAgent).toBeDefined();
    expect(coderAgent!.workspace_path).toBe(`${STATE_DIR}/workspaces/workspace-coder`);
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
    expect(links.find((l) => l.source_agent_id === "main" && l.target_agent_id === "coder")).toBeDefined();
    expect(links.find((l) => l.source_agent_id === "coder" && l.target_agent_id === "reviewer")).toBeDefined();
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

    const wsDir = `${STATE_DIR}/workspaces/workspace-helper`;
    expect(conn.files.has(`${wsDir}/SOUL.md`)).toBe(true);
    expect(conn.files.has(`${wsDir}/AGENTS.md`)).toBe(true);
    expect(conn.files.get(`${wsDir}/SOUL.md`)).toBe("# Helper\n");
  });
});
