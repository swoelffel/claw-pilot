// src/core/agent-sync.ts
import { createHash } from "node:crypto";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { normaliseModel } from "../lib/model-helpers.js";
import { constants } from "../lib/constants.js";

// ---------------------------------------------------------------------------
// Constants (imported from single source of truth)
// ---------------------------------------------------------------------------

const DISCOVERABLE_FILES = constants.DISCOVERABLE_FILES;

/** Subset of discoverable files that the UI is allowed to edit. */
export const EDITABLE_FILES: Set<string> = new Set(constants.EDITABLE_FILES);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentSyncResult {
  agents: SyncedAgent[];
  links: SyncedLink[];
  changes: {
    agentsAdded: string[];
    agentsRemoved: string[];
    agentsUpdated: string[];
    filesChanged: number;
    linksChanged: number;
  };
}

export interface SyncedAgent {
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: boolean;
  config_hash: string;
  files: Array<{
    filename: string;
    content_hash: string;
    size: number;
    updated_at: string;
  }>;
}

export interface SyncedLink {
  source_agent_id: string;
  target_agent_id: string;
  link_type: "a2a" | "spawn";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// AgentSync
// ---------------------------------------------------------------------------

export class AgentSync {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  /**
   * Synchronise the agent roster and workspace files for a given instance.
   *
   * Algorithm:
   *  1. Read + parse runtime.json
   *  2. Reconcile agents (add / update / remove)
   *  3. For each agent, sync workspace files
   *  4. Extract and persist agent links
   *  5. Return a detailed change report
   */
  async sync(instance: InstanceRecord): Promise<AgentSyncResult> {
    // ------------------------------------------------------------------
    // 1. Read and parse runtime.json
    // ------------------------------------------------------------------
    const configRaw = await this.conn.readFile(instance.config_path);
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    // ------------------------------------------------------------------
    // 2. Build the expected agent list from config
    //    runtime.json uses a flat agents[] array (no agents.defaults/list split)
    // ------------------------------------------------------------------
    const agentsList = (config["agents"] ?? []) as Array<Record<string, unknown>>;
    const defaultModel = normaliseModel(config["defaultModel"]);
    const stateDir = instance.state_dir;

    // Describe each agent from config
    interface ConfigAgent {
      agentId: string;
      name: string;
      model: string | null;
      workspacePath: string;
      isDefault: boolean;
      /** Raw JSON block used for config_hash */
      rawBlock: unknown;
    }

    const configAgents: ConfigAgent[] = [];

    // If no agents in config, create a synthetic "main" agent
    if (agentsList.length === 0) {
      configAgents.push({
        agentId: "main",
        name: "Main",
        model: defaultModel,
        workspacePath: `${stateDir}/workspaces/workspace`,
        isDefault: true,
        // Include defaultModel in rawBlock so the config_hash changes when the model changes
        rawBlock: { defaultModel: defaultModel ?? null },
      });
    }

    for (const agent of agentsList) {
      if (!agent["id"]) continue;
      const agentId = agent["id"] as string;
      const isDefault =
        (agent["isDefault"] as boolean | undefined) === true ||
        (agent["default"] as boolean | undefined) === true ||
        agentId === "main";

      const explicitWorkspace = agent["workspace"] as string | undefined;
      let workspacePath: string;
      if (explicitWorkspace) {
        workspacePath = explicitWorkspace.startsWith("/")
          ? explicitWorkspace
          : `${stateDir}/workspaces/${explicitWorkspace}`;
      } else {
        workspacePath = isDefault
          ? `${stateDir}/workspaces/workspace`
          : `${stateDir}/workspaces/workspace-${agentId}`;
      }

      configAgents.push({
        agentId,
        name: (agent["name"] as string | undefined) ?? agentId,
        model: normaliseModel(agent["model"]) ?? defaultModel,
        workspacePath,
        isDefault,
        rawBlock: agent,
      });
    }

    // Ensure at least one default agent exists
    if (configAgents.length > 0 && !configAgents.some((a) => a.isDefault)) {
      configAgents[0]!.isDefault = true;
    }

    // ------------------------------------------------------------------
    // 3. Reconcile agents against DB
    // ------------------------------------------------------------------
    const agentsAdded: string[] = [];
    const agentsRemoved: string[] = [];
    const agentsUpdated: string[] = [];
    let totalFilesChanged = 0;

    // Index existing DB agents by agent_id string
    // We'll remove entries as we process them; what remains at the end is stale.
    const dbAgents = new Map(this.registry.listAgents(instance.slug).map((a) => [a.agent_id, a]));

    const syncedAgents: SyncedAgent[] = [];
    const syncedAt = new Date().toISOString();

    for (const ca of configAgents) {
      const configHash = hashContent(JSON.stringify(ca.rawBlock));
      const existing = dbAgents.get(ca.agentId);

      let agentDbId: number;

      if (!existing) {
        // New agent — upsert creates the row (no position yet → null)
        const created = this.registry.upsertAgent(instance.id, {
          agentId: ca.agentId,
          name: ca.name,
          ...(ca.model != null && { model: ca.model }),
          workspacePath: ca.workspacePath,
          isDefault: ca.isDefault,
        });
        agentDbId = created.id;
        agentsAdded.push(ca.agentId);
      } else {
        agentDbId = existing.id;
        if (existing.config_hash !== configHash) {
          // Config changed — update name/model/workspace via upsert
          // Preserve existing canvas positions (set by blueprint deploy or user drag)
          this.registry.upsertAgent(instance.id, {
            agentId: ca.agentId,
            name: ca.name,
            ...(ca.model != null && { model: ca.model }),
            workspacePath: ca.workspacePath,
            isDefault: ca.isDefault,
            position_x: existing.position_x,
            position_y: existing.position_y,
          });
          agentsUpdated.push(ca.agentId);
        }
      }

      // Mark this agent as seen (remove from stale-tracking map)
      dbAgents.delete(ca.agentId);

      // Always update sync metadata
      this.registry.updateAgentSync(agentDbId, {
        configHash,
        syncedAt,
      });

      // ------------------------------------------------------------------
      // 4. Sync workspace files for this agent
      // ------------------------------------------------------------------
      const fileSummaries: SyncedAgent["files"] = [];

      // Index existing DB files for this agent
      const dbFiles = new Map(this.registry.listAgentFiles(agentDbId).map((f) => [f.filename, f]));

      for (const filename of DISCOVERABLE_FILES) {
        const filePath = `${ca.workspacePath}/${filename}`;
        let content: string;

        try {
          content = await this.conn.readFile(filePath);
        } catch {
          // File absent or unreadable — remove from DB if it was cached
          if (dbFiles.has(filename)) {
            this.registry.deleteAgentFile(agentDbId, filename);
            totalFilesChanged++;
          }
          dbFiles.delete(filename);
          continue;
        }

        const contentHash = hashContent(content);
        const dbFile = dbFiles.get(filename);

        if (!dbFile || dbFile.content_hash !== contentHash) {
          this.registry.upsertAgentFile(agentDbId, {
            filename,
            content,
            contentHash,
          });
          totalFilesChanged++;
        }

        fileSummaries.push({
          filename,
          content_hash: contentHash,
          size: Buffer.byteLength(content, "utf8"),
          updated_at: syncedAt,
        });

        dbFiles.delete(filename);
      }

      // Remove DB files that are no longer on disk
      for (const [filename] of dbFiles) {
        this.registry.deleteAgentFile(agentDbId, filename);
        totalFilesChanged++;
      }

      syncedAgents.push({
        agent_id: ca.agentId,
        name: ca.name,
        model: ca.model,
        workspace_path: ca.workspacePath,
        is_default: ca.isDefault,
        config_hash: configHash,
        files: fileSummaries,
      });
    }

    // Agents remaining in dbAgents are no longer in config → delete them
    for (const [agentId, record] of dbAgents) {
      this.registry.deleteAgentById(record.id);
      agentsRemoved.push(agentId);
    }

    // ------------------------------------------------------------------
    // 5. Extract agent links from config
    //    runtime.json uses agents[].links[] or agents[].subagents[]
    // ------------------------------------------------------------------
    const links: SyncedLink[] = [];

    for (const agent of agentsList) {
      if (!agent["id"]) continue;
      const sourceId = agent["id"] as string;

      // Spawn links from subagents.allowAgents (if present)
      const subagents = agent["subagents"] as Record<string, unknown> | undefined;
      const allowAgents = (subagents?.["allowAgents"] ?? []) as string[];
      for (const target of allowAgents) {
        links.push({
          source_agent_id: sourceId,
          target_agent_id: target,
          link_type: "spawn",
        });
      }

      // Links from agent.links[] array (if present)
      const agentLinks = (agent["links"] ?? []) as Array<Record<string, unknown>>;
      for (const link of agentLinks) {
        const target = link["target"] as string | undefined;
        const linkType = (link["type"] as string | undefined) ?? "a2a";
        if (target) {
          links.push({
            source_agent_id: sourceId,
            target_agent_id: target,
            link_type: linkType as "a2a" | "spawn",
          });
        }
      }
    }

    // Persist links (atomic replace)
    const prevLinks = this.registry.listAgentLinks(instance.id);
    this.registry.replaceAgentLinks(
      instance.id,
      links.map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type,
      })),
    );
    const linksChanged = Math.abs(links.length - prevLinks.length);

    return {
      agents: syncedAgents,
      links,
      changes: {
        agentsAdded,
        agentsRemoved,
        agentsUpdated,
        filesChanged: totalFilesChanged,
        linksChanged,
      },
    };
  }
}
