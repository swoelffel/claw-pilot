// src/core/agent-provisioner.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { EDITABLE_FILES } from "./agent-sync.js";
import { createHash } from "node:crypto";
import { constants } from "../lib/constants.js";

export interface CreateAgentData {
  agentSlug: string;
  name: string;
  role: string;
  provider: string;
  model: string;
}

const DISCOVERABLE_FILES = constants.DISCOVERABLE_FILES;

export class AgentProvisioner {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  async createAgent(instance: InstanceRecord, data: CreateAgentData): Promise<void> {
    // 1. Validate slug uniqueness
    const existing = this.registry.getAgentByAgentId(instance.id, data.agentSlug);
    if (existing) throw new Error(`Agent "${data.agentSlug}" already exists`);

    // 2. Determine workspace dir from instance config_path
    const configHome = path.dirname(instance.config_path);
    const workspaceDir = path.join(configHome, `workspace-${data.agentSlug}`);

    // 3. Create workspace directory + minimal files
    await this.conn.mkdir(workspaceDir);
    for (const filename of DISCOVERABLE_FILES) {
      await this.conn.writeFile(path.join(workspaceDir, filename), `# ${data.name}\n`);
    }

    if (instance.instance_type === "claw-runtime") {
      // ── claw-runtime: append to agents[] array in runtime.json ──────────────
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
    } else {
      // ── openclaw: append to agents.list[] in openclaw.json ──────────────────
      const configRaw = await this.conn.readFile(instance.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;

      const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
      config["agents"] = agentsConf;
      if (!Array.isArray(agentsConf["list"])) {
        agentsConf["list"] = [];
      }
      (agentsConf["list"] as unknown[]).push({
        id: data.agentSlug,
        name: data.name,
        model: `${data.provider}/${data.model}`,
        workspace: workspaceDir, // absolute path — avoids resolveWorkspace() prefix bug
      });

      await this.conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");
    }

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

    if (instance.instance_type === "claw-runtime") {
      // ── claw-runtime: remove from agents[] array in runtime.json ────────────
      const configRaw = await this.conn.readFile(instance.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;

      if (Array.isArray(config["agents"])) {
        config["agents"] = (config["agents"] as Array<{ id: string }>).filter(
          (a) => a.id !== agentSlug,
        );
      }

      await this.conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");
    } else {
      // ── openclaw: remove from agents.list[] in openclaw.json ────────────────
      const configRaw = await this.conn.readFile(instance.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;

      const agentsConf = config["agents"] as Record<string, unknown> | undefined;
      if (agentsConf && Array.isArray(agentsConf["list"])) {
        agentsConf["list"] = (agentsConf["list"] as Array<{ id: string }>).filter(
          (a) => a.id !== agentSlug,
        );
      }

      // Clean agentSlug from all subagents.allowAgents in agents.list[]
      if (agentsConf && Array.isArray(agentsConf["list"])) {
        for (const entry of agentsConf["list"] as Array<Record<string, unknown>>) {
          const subagents = entry["subagents"] as Record<string, unknown> | undefined;
          if (subagents && Array.isArray(subagents["allowAgents"])) {
            subagents["allowAgents"] = (subagents["allowAgents"] as string[]).filter(
              (id) => id !== agentSlug,
            );
          }
        }
      }

      // Also clean from agents.defaults.subagents.allowAgents (main agent)
      const agentsDefaults = agentsConf?.["defaults"] as Record<string, unknown> | undefined;
      const defaultSubagents = agentsDefaults?.["subagents"] as Record<string, unknown> | undefined;
      if (defaultSubagents && Array.isArray(defaultSubagents["allowAgents"])) {
        defaultSubagents["allowAgents"] = (defaultSubagents["allowAgents"] as string[]).filter(
          (id) => id !== agentSlug,
        );
      }

      await this.conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");
    }

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
