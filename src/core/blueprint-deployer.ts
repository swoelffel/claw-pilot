// src/core/blueprint-deployer.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { createHash } from "node:crypto";
import { constants } from "../lib/constants.js";

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

    // 4. Read runtime.json
    const configRaw = await this.conn.readFile(instance.config_path);
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    const stateDir = path.dirname(instance.config_path);
    if (!Array.isArray(config["agents"])) {
      config["agents"] = [];
    }

    // 5. For each blueprint agent: write files + register in DB + update config
    for (const bpAgent of blueprintAgents) {
      const isDefault = bpAgent.is_default === 1;

      // Workspace path: workspaces/<agent_id> for all agents
      const workspaceDir = path.join(stateDir, "workspaces", bpAgent.agent_id);

      // Create workspace directory only for secondary agents
      // (main workspace already exists, created by Provisioner step 5)
      if (!isDefault) {
        await this.conn.mkdir(workspaceDir);
      }

      // Read files from DB and write to disk
      // For main: overwrites the generic templates with blueprint content
      const files = this.registry.listAgentFiles(bpAgent.id);
      for (const file of files) {
        if (file.content) {
          await this.conn.writeFile(path.join(workspaceDir, file.filename), file.content);
        }
      }

      // If no files in DB, write minimal placeholders (secondary agents only).
      if (files.length === 0 && !isDefault) {
        for (const filename of constants.TEMPLATE_FILES) {
          await this.conn.writeFile(path.join(workspaceDir, filename), `# ${bpAgent.name}\n`);
        }
      }

      // Add to agents[] array in runtime.json
      {
        const agentEntry: Record<string, unknown> = {
          id: bpAgent.agent_id,
          name: bpAgent.name,
          permissions: [],
        };
        if (isDefault) {
          agentEntry["isDefault"] = true;
        }

        // Resolve model: use blueprint model if available, otherwise use instance default
        let modelStr: string;
        if (bpAgent.model) {
          // bpAgent.model may be either:
          //   - a JSON-serialized object: '{"primary":"opencode/claude-haiku-4-5"}' → use primary
          //   - a bare "provider/model" string: "anthropic/claude-haiku-4-5" → use as-is
          try {
            const parsed = JSON.parse(bpAgent.model) as Record<string, unknown>;
            modelStr = typeof parsed["primary"] === "string" ? parsed["primary"] : bpAgent.model;
          } catch {
            // intentionally ignored — model is a bare string, not JSON
            modelStr = bpAgent.model;
          }
        } else {
          // No model in blueprint: use instance's defaultModel
          modelStr = (config["defaultModel"] as string) ?? "anthropic/claude-sonnet-4-5";
        }
        agentEntry["model"] = modelStr;

        // Add spawn links for this agent (all agents including main)
        const spawnTargets = blueprintLinks
          .filter((l) => l.source_agent_id === bpAgent.agent_id && l.link_type === "spawn")
          .map((l) => l.target_agent_id);
        if (spawnTargets.length > 0) {
          agentEntry["allowSubAgents"] = true;
        }

        (config["agents"] as unknown[]).push(agentEntry);
      }

      // Register agent in DB (linked to instance)
      // Copy canvas positions from blueprint so the dashboard renders cards
      // at the same layout the user designed in the blueprint editor.
      this.registry.upsertAgent(instance.id, {
        agentId: bpAgent.agent_id,
        name: bpAgent.name,
        ...(bpAgent.model != null && { model: bpAgent.model }),
        workspacePath: workspaceDir,
        isDefault,
        position_x: bpAgent.position_x ?? null,
        position_y: bpAgent.position_y ?? null,
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

    // 6. Write updated runtime.json
    await this.conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

    // 7. Register blueprint links as instance links in DB
    const instanceLinks = blueprintLinks.map((l) => ({
      sourceAgentId: l.source_agent_id,
      targetAgentId: l.target_agent_id,
      linkType: l.link_type,
    }));
    if (instanceLinks.length > 0) {
      this.registry.replaceAgentLinks(instance.id, instanceLinks);
    }
  }
}
