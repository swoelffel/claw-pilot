// src/core/blueprint-deployer.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { createHash } from "node:crypto";

export class BlueprintDeployer {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  async deploy(blueprintId: number, instance: InstanceRecord): Promise<void> {
    // 1. Read blueprint
    const blueprint = this.registry.getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Blueprint ${blueprintId} not found`);

    // 2. Read blueprint agents
    const blueprintAgents = this.registry.listBlueprintAgents(blueprintId);
    if (blueprintAgents.length === 0) return; // Nothing to deploy

    // 3. Read blueprint links
    const blueprintLinks = this.registry.listBlueprintLinks(blueprintId);

    // 4. Read openclaw.json
    const path = await import("node:path");
    const configRaw = await this.conn.readFile(instance.config_path);
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    const openclawHome = path.dirname(instance.config_path);
    const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
    config["agents"] = agentsConf;
    if (!Array.isArray(agentsConf["list"])) {
      agentsConf["list"] = [];
    }

    // 5. For each blueprint agent: create workspace + write files + add to config
    for (const bpAgent of blueprintAgents) {
      const workspaceDir = path.join(openclawHome, `workspace-${bpAgent.agent_id}`);

      // Create workspace directory
      await this.conn.mkdir(workspaceDir);

      // Read files from DB and write to disk
      const files = this.registry.listAgentFiles(bpAgent.id);
      for (const file of files) {
        if (file.content) {
          await this.conn.writeFile(
            path.join(workspaceDir, file.filename),
            file.content,
          );
        }
      }

      // If no files in DB, write minimal placeholders
      if (files.length === 0) {
        const minimalFiles = ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md"];
        for (const filename of minimalFiles) {
          await this.conn.writeFile(
            path.join(workspaceDir, filename),
            `# ${bpAgent.name}\n`,
          );
        }
      }

      // Add agent to openclaw.json agents.list[]
      const agentEntry: Record<string, unknown> = {
        id: bpAgent.agent_id,
        name: bpAgent.name,
        workspace: workspaceDir,
      };
      if (bpAgent.model) {
        agentEntry["model"] = bpAgent.model;
      }

      // Add spawn links for this agent
      const spawnTargets = blueprintLinks
        .filter(l => l.source_agent_id === bpAgent.agent_id && l.link_type === "spawn")
        .map(l => l.target_agent_id);
      if (spawnTargets.length > 0) {
        agentEntry["subagents"] = { allowAgents: spawnTargets };
      }

      (agentsConf["list"] as unknown[]).push(agentEntry);

      // Register agent in DB (linked to instance)
      this.registry.upsertAgent(instance.id, {
        agentId: bpAgent.agent_id,
        name: bpAgent.name,
        model: bpAgent.model ?? undefined,
        workspacePath: workspaceDir,
        isDefault: bpAgent.is_default === 1,
      });

      // Copy files to instance agent DB cache
      const instanceAgent = this.registry.getAgentByAgentId(instance.id, bpAgent.agent_id);
      if (instanceAgent) {
        for (const file of files) {
          if (file.content) {
            const hash = createHash("sha256").update(file.content).digest("hex").slice(0, 16);
            this.registry.upsertAgentFile(instanceAgent.id, {
              filename: file.filename,
              content: file.content,
              contentHash: hash,
            });
          }
        }
      }
    }

    // 6. Write updated openclaw.json
    await this.conn.writeFile(
      instance.config_path,
      JSON.stringify(config, null, 2) + "\n",
    );

    // 7. Register blueprint links as instance links in DB
    const instanceLinks = blueprintLinks.map(l => ({
      sourceAgentId: l.source_agent_id,
      targetAgentId: l.target_agent_id,
      linkType: l.link_type,
    }));
    if (instanceLinks.length > 0) {
      this.registry.replaceAgentLinks(instance.id, instanceLinks);
    }
  }
}
