// src/core/agent-sync.ts
import { createHash } from "node:crypto";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import type { RuntimeConfig } from "../runtime/config/index.js";
import { normaliseModel } from "../lib/model-helpers.js";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";

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
   *  1. Read config from DB (source of truth), fallback to runtime.json
   *  2. Reconcile agents (add / update / remove)
   *  3. For each agent, sync workspace files
   *  4. Extract and persist agent links
   *  5. Return a detailed change report
   */
  async sync(instance: InstanceRecord): Promise<AgentSyncResult> {
    // ------------------------------------------------------------------
    // 1. Read config — DB first, fallback to runtime.json file
    // ------------------------------------------------------------------
    let config: Record<string, unknown>;
    let _typedConfig: RuntimeConfig | null = null;

    const dbConfig = this.registry.getRuntimeConfig(instance.slug);
    if (dbConfig) {
      _typedConfig = dbConfig;
      // Convert to untyped for backward-compatible agent parsing below
      config = JSON.parse(JSON.stringify(dbConfig)) as Record<string, unknown>;
    } else {
      // Fallback: read runtime.json (pre-v21 instances or file-only setups)
      const configRaw = await this.conn.readFile(instance.config_path);
      config = JSON.parse(configRaw) as Record<string, unknown>;
      logger.debug(
        `[agent-sync] Read config from file for "${instance.slug}" (DB config not found)`,
      );
    }

    // ------------------------------------------------------------------
    // 2. Build the expected agent list from config
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

    // If no agents in config, create a synthetic "pilot" agent
    if (agentsList.length === 0) {
      configAgents.push({
        agentId: "pilot",
        name: "Pilot",
        model: defaultModel,
        workspacePath: `${stateDir}/workspaces/pilot`,
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
        agentId === "pilot";

      const explicitWorkspace = agent["workspace"] as string | undefined;
      let workspacePath: string;
      if (explicitWorkspace) {
        workspacePath = explicitWorkspace.startsWith("/")
          ? explicitWorkspace
          : `${stateDir}/workspaces/${explicitWorkspace}`;
      } else {
        workspacePath = `${stateDir}/workspaces/${agentId}`;
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

      // Serialize the full agent config block as config_json
      const configJson = JSON.stringify(ca.rawBlock);

      if (!existing) {
        // New agent — upsert creates the row (no position yet → null)
        const created = this.registry.upsertAgent(instance.id, {
          agentId: ca.agentId,
          name: ca.name,
          ...(ca.model != null && { model: ca.model }),
          workspacePath: ca.workspacePath,
          isDefault: ca.isDefault,
          configJson,
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
            configJson,
          });
          agentsUpdated.push(ca.agentId);
        } else if (existing.config_json == null) {
          // Backfill config_json for agents that were synced before v20
          this.registry.updateAgentConfig(agentDbId, configJson);
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
    // 5. Extract spawn links from config
    //    Config sources: agents[].agentToAgent.allowList (v2),
    //    agents[].subagents.allowAgents (legacy), agents[].links[] (explicit).
    //
    //    A2A links are NOT in config — they are set via the builder UI and
    //    stored only in agent_links. The sync must PRESERVE existing a2a links.
    // ------------------------------------------------------------------
    const configSpawnLinks: SyncedLink[] = [];

    for (const agent of agentsList) {
      if (!agent["id"]) continue;
      const sourceId = agent["id"] as string;

      // Spawn links from agentToAgent.allowList (v2 format)
      const agentToAgent = agent["agentToAgent"] as Record<string, unknown> | undefined;
      const allowList = (agentToAgent?.["allowList"] ?? []) as string[];
      for (const target of allowList) {
        configSpawnLinks.push({
          source_agent_id: sourceId,
          target_agent_id: target,
          link_type: "spawn",
        });
      }

      // Spawn links from subagents.allowAgents (legacy format)
      const subagents = agent["subagents"] as Record<string, unknown> | undefined;
      const allowAgents = (subagents?.["allowAgents"] ?? []) as string[];
      for (const target of allowAgents) {
        // Avoid duplicates if both formats are present
        const exists = configSpawnLinks.some(
          (l) => l.source_agent_id === sourceId && l.target_agent_id === target,
        );
        if (!exists) {
          configSpawnLinks.push({
            source_agent_id: sourceId,
            target_agent_id: target,
            link_type: "spawn",
          });
        }
      }

      // Explicit links from agent.links[] array (if present)
      const agentLinks = (agent["links"] ?? []) as Array<Record<string, unknown>>;
      for (const link of agentLinks) {
        const target = link["target"] as string | undefined;
        const linkType = (link["type"] as string | undefined) ?? "a2a";
        if (target) {
          configSpawnLinks.push({
            source_agent_id: sourceId,
            target_agent_id: target,
            link_type: linkType as "a2a" | "spawn",
          });
        }
      }
    }

    // Merge: replace spawn links from config, but PRESERVE existing a2a links
    const prevLinks = this.registry.listAgentLinks(instance.id);
    const existingA2aLinks = prevLinks
      .filter((l) => l.link_type === "a2a")
      .map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type as "a2a" | "spawn",
      }));

    // Also preserve existing spawn links that are NOT in config
    // (e.g. spawn links set via the builder UI that target @archetype or specific agents)
    const configSpawnSet = new Set(
      configSpawnLinks.map((l) => `${l.source_agent_id}:${l.target_agent_id}`),
    );
    const existingExtraSpawnLinks = prevLinks
      .filter(
        (l) =>
          l.link_type === "spawn" &&
          !configSpawnSet.has(`${l.source_agent_id}:${l.target_agent_id}`),
      )
      .map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type as "a2a" | "spawn",
      }));

    const mergedLinks = [
      ...existingA2aLinks,
      ...existingExtraSpawnLinks,
      ...configSpawnLinks.map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type,
      })),
    ];

    this.registry.replaceAgentLinks(instance.id, mergedLinks);
    const linksChanged = Math.abs(mergedLinks.length - prevLinks.length);

    // Return all links for the sync result
    const links: SyncedLink[] = mergedLinks.map((l) => ({
      source_agent_id: l.sourceAgentId,
      target_agent_id: l.targetAgentId,
      link_type: l.linkType,
    }));

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
