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
import { exportRuntimeJsonSnapshot } from "../runtime/engine/config-loader.js";
import { deleteSessionsByAgent } from "./repositories/runtime-session-repository.js";
import { logger } from "../lib/logger.js";

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
  /** Tool profile written to runtime.json — controls available tools. */
  toolProfile?: "sentinel" | "pilot" | "manager" | "executor" | "custom";
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
        } catch (err) {
          logger.debug("[agent-provisioner] memory template file not found", {
            error: String(err),
          });
        }
      }
    }

    // Build agent config block.
    // Extended thinking is enabled by default — only honored by Anthropic
    // providers (see prompt-loop.ts). Non-Anthropic models silently ignore it.
    const agentConfigBlock = {
      id: data.agentSlug,
      name: data.name,
      model: `${data.provider}/${data.model}`,
      permissions: [],
      thinking: { enabled: true, budgetTokens: 4000 },
      ...(data.toolProfile ? { toolProfile: data.toolProfile } : {}),
    };

    // Upsert agent in DB with full config_json (source of truth)
    this.registry.upsertAgent(instance.id, {
      agentId: data.agentSlug,
      name: data.name,
      model: `${data.provider}/${data.model}`,
      workspacePath: workspaceDir,
      isDefault: false,
      configJson: JSON.stringify(agentConfigBlock),
    });

    // Export runtime.json snapshot for debugging
    this.exportSnapshot(instance);

    // Save optional metadata fields to DB
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

    // Clean up all sessions (permanent + ephemeral) for this agent
    deleteSessionsByAgent(this.registry.getDb(), instance.slug, agentSlug);

    // Delete agent from DB (cascades to agent_files)
    this.registry.deleteAgentById(agent.id);

    // Export runtime.json snapshot for debugging
    this.exportSnapshot(instance);
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

  /** Export runtime.json snapshot for debugging (best-effort). */
  private exportSnapshot(instance: InstanceRecord): void {
    try {
      const stateDir = path.dirname(instance.config_path);
      const config = this.registry.getRuntimeConfig(instance.slug);
      if (config) {
        exportRuntimeJsonSnapshot(stateDir, config);
      }
    } catch (err) {
      logger.warn(
        `[agent-provisioner] Failed to export runtime.json snapshot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
