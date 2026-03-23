// src/core/agent-provisioner.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { EDITABLE_FILES } from "./agent-sync.js";
import { createHash } from "node:crypto";
import { constants } from "../lib/constants.js";
import { loadWorkspaceTemplate, type TemplateVars } from "../lib/workspace-templates.js";

// Resolve templates directory relative to this file
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_MEMORY_DIR = path.resolve(__dirname, "../../templates/workspace/memory");

/** Memory template files created for primary agents during provisioning */
const MEMORY_TEMPLATE_FILES = [
  "facts.md",
  "decisions.md",
  "user-prefs.md",
  "timeline.md",
  "knowledge.md",
] as const;

export interface CreateAgentData {
  agentSlug: string;
  name: string;
  role: string;
  provider: string;
  model: string;
  /**
   * Functional role of the agent.
   * - "primary" (default): full workspace context, permanent session, all template files
   * - "subagent": minimal context, only AGENTS.md created
   */
  kind?: "primary" | "subagent";
}

export class AgentProvisioner {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  async createAgent(instance: InstanceRecord, data: CreateAgentData): Promise<void> {
    // 1. Validate slug uniqueness
    const existing = this.registry.getAgentByAgentId(instance.id, data.agentSlug);
    if (existing) throw new Error(`Agent "${data.agentSlug}" already exists`);

    // 2. Determine workspace dir inside <stateDir>/workspaces/ (consistent with provisioner)
    const stateDir = path.dirname(instance.config_path);
    const workspaceDir = path.join(stateDir, "workspaces", data.agentSlug);

    // 3. Create workspace directory + rich template files
    await this.conn.mkdir(workspaceDir);

    // Build template vars — include existing agents + the new one for AGENTS.md completeness
    const existingAgents = this.registry
      .listAgents(instance.slug)
      .map((a) => ({ id: a.agent_id, name: a.name }));
    const vars: TemplateVars = {
      agentId: data.agentSlug,
      agentName: data.name,
      instanceSlug: instance.slug,
      instanceName: instance.display_name ?? instance.slug,
      agents: [...existingAgents, { id: data.agentSlug, name: data.name }],
    };

    // Subagents only need AGENTS.md — no identity, no memory, no heartbeat.
    const agentKind = data.kind ?? "primary";
    const workspaceFiles: readonly string[] =
      agentKind === "subagent" ? (["AGENTS.md"] as const) : constants.TEMPLATE_FILES;

    // Create workspace files from templates
    for (const filename of workspaceFiles) {
      const content = await loadWorkspaceTemplate(filename, vars);
      await this.conn.writeFile(path.join(workspaceDir, filename), content);
    }

    // Create memory template files for primary agents
    if (agentKind === "primary") {
      const memoryDir = path.join(workspaceDir, "memory");
      await this.conn.mkdir(memoryDir);
      for (const filename of MEMORY_TEMPLATE_FILES) {
        const templatePath = path.join(TEMPLATES_MEMORY_DIR, filename);
        const destPath = path.join(memoryDir, filename);
        try {
          const content = fs.readFileSync(templatePath, "utf-8");
          await this.conn.writeFile(destPath, content);
        } catch {
          // Template absent — skip silently (non-blocking)
        }
      }
    }

    // Append to agents[] array in runtime.json
    const configRaw = await this.conn.readFile(instance.config_path);
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    if (!Array.isArray(config["agents"])) {
      config["agents"] = [];
    }
    (config["agents"] as unknown[]).push({
      id: data.agentSlug,
      name: data.name,
      model: `${data.provider}/${data.model}`,
      permissions: [],
    });

    await this.conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

    // Upsert agent in DB
    this.registry.upsertAgent(instance.id, {
      agentId: data.agentSlug,
      name: data.name,
      model: `${data.provider}/${data.model}`,
      workspacePath: workspaceDir,
      isDefault: false,
    });

    if (data.role) {
      const agent = this.registry.getAgentByAgentId(instance.id, data.agentSlug);
      if (agent) {
        this.registry.updateAgentMeta(agent.id, { role: data.role });
      }
    }
  }

  async deleteAgent(instance: InstanceRecord, agentSlug: string): Promise<void> {
    // 1. Lookup agent in DB
    const agent = this.registry.getAgentByAgentId(instance.id, agentSlug);
    if (!agent) throw new Error(`Agent "${agentSlug}" not found`);

    // 2. Block deletion of default agent
    if (agent.is_default) throw new Error(`Cannot delete the default agent`);

    // Remove from agents[] array in runtime.json
    const configRaw = await this.conn.readFile(instance.config_path);
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    if (Array.isArray(config["agents"])) {
      config["agents"] = (config["agents"] as Array<{ id: string }>).filter(
        (a) => a.id !== agentSlug,
      );
    }

    await this.conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

    // Delete workspace directory on server
    await this.conn.remove(agent.workspace_path, { recursive: true });

    // Clean up orphan links in DB
    const allLinks = this.registry.listAgentLinks(instance.id);
    const remainingLinks = allLinks
      .filter((l) => l.source_agent_id !== agentSlug && l.target_agent_id !== agentSlug)
      .map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type as "a2a" | "spawn",
      }));
    this.registry.replaceAgentLinks(instance.id, remainingLinks);

    // Delete agent from DB (cascades to agent_files)
    this.registry.deleteAgentById(agent.id);
  }

  async updateAgentFile(
    instance: InstanceRecord,
    agentSlug: string,
    filename: string,
    content: string,
  ): Promise<void> {
    // 1. Lookup agent in DB
    const agent = this.registry.getAgentByAgentId(instance.id, agentSlug);
    if (!agent) throw new Error(`Agent "${agentSlug}" not found`);

    // 2. Guard: file must be editable
    if (!EDITABLE_FILES.has(filename)) {
      throw new Error(`File "${filename}" is not editable`);
    }

    // 3. Write to disk
    const filePath = path.join(agent.workspace_path, filename);
    await this.conn.writeFile(filePath, content);

    // 4. Update SQLite cache
    const hash = createHash("sha256").update(content).digest("hex");
    this.registry.upsertAgentFile(agent.id, { filename, content, contentHash: hash });
  }
}
