// src/core/agent-sync.ts
import { createHash } from "node:crypto";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";

import { normaliseModel } from "../lib/model-helpers.js";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";
import { hasAllowedWorkspaceExtension, isIgnoredWorkspaceSegment } from "../lib/workspace-path.js";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants (imported from single source of truth)
// ---------------------------------------------------------------------------

/**
 * Subset of workspace files that the runtime includes in the system prompt
 * (see `src/runtime/session/system-prompt.ts`). These are the only files
 * that also have a guaranteed schema / provisioning template.
 *
 * Everything else in the workspace tree is user-managed (or agent-generated)
 * and is now visible & editable via the UI file tree, but is NOT injected
 * into the prompt automatically.
 */
export const EDITABLE_FILES: Set<string> = new Set(constants.EDITABLE_FILES);

/** Maximum size (bytes) of a single workspace file synced into the DB cache. */
const MAX_SYNC_FILE_SIZE = 1_048_576; // 1 MiB

/** Maximum recursion depth when walking a workspace directory. */
const MAX_WORKSPACE_DEPTH = 8;

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
    sharedFilesChanged: number;
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
// Internal types
// ---------------------------------------------------------------------------

interface ConfigAgent {
  agentId: string;
  name: string;
  model: string | null;
  workspacePath: string;
  isDefault: boolean;
  /** Raw JSON block used for config_hash */
  rawBlock: unknown;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Recursively walk a workspace directory and return every allowed text/config
 * file (relative path + content). Reserved segments (.git, node_modules,
 * dotfiles, etc.) are skipped, as are files larger than `MAX_SYNC_FILE_SIZE`.
 *
 * Exported so both the provisioning sync (`AgentSync`) and the on-demand
 * dashboard sync route (`POST /api/instances/:slug/agents/sync`) share one walker.
 */
export async function walkWorkspaceFiles(
  conn: ServerConnection,
  workspacePath: string,
): Promise<Array<{ relPath: string; content: string }>> {
  const results: Array<{ relPath: string; content: string }> = [];

  const visit = async (absDir: string, relDir: string, depth: number): Promise<void> => {
    if (depth > MAX_WORKSPACE_DEPTH) {
      logger.debug("[agent-sync] depth limit reached", { absDir, depth });
      return;
    }
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = await conn.readdirWithTypes(absDir);
    } catch (err) {
      logger.debug("[agent-sync] readdir failed", { error: String(err), absDir });
      return;
    }

    for (const entry of entries) {
      if (isIgnoredWorkspaceSegment(entry.name)) continue;
      const absEntry = `${absDir}/${entry.name}`;
      const relEntry = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        await visit(absEntry, relEntry, depth + 1);
        continue;
      }

      if (!hasAllowedWorkspaceExtension(entry.name)) continue;

      let content: string;
      try {
        content = await conn.readFile(absEntry);
      } catch (err) {
        logger.debug("[agent-sync] file unreadable", { error: String(err), absEntry });
        continue;
      }

      if (Buffer.byteLength(content, "utf8") > MAX_SYNC_FILE_SIZE) {
        logger.debug("[agent-sync] file too large, skipping", { absEntry });
        continue;
      }

      results.push({ relPath: relEntry, content });
    }
  };

  await visit(workspacePath, "", 0);
  return results;
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
    // 1. Read config — DB first, fallback to runtime.json file
    const config = await this._loadConfig(instance);

    // 2. Build the expected agent list from config
    const agentsList = (config["agents"] ?? []) as Array<Record<string, unknown>>;
    const defaultModel = normaliseModel(config["defaultModel"]);
    const configAgents = this._buildConfigAgents(agentsList, defaultModel, instance.state_dir);

    // 3. Reconcile agents against DB + sync workspace files
    const { syncedAgents, agentsAdded, agentsRemoved, agentsUpdated, totalFilesChanged } =
      await this._reconcileAgents(instance, configAgents);

    // 4. Extract and persist agent links
    const { links, linksChanged } = this._extractAndMergeLinks(instance, agentsList);

    // 5. Sync the instance shared workspace (v38) — self-healing: create the
    //    directory if missing (legacy instances provisioned before v38).
    const sharedFilesChanged = await this._syncSharedWorkspace(instance);

    return {
      agents: syncedAgents,
      links,
      changes: {
        agentsAdded,
        agentsRemoved,
        agentsUpdated,
        filesChanged: totalFilesChanged,
        linksChanged,
        sharedFilesChanged,
      },
    };
  }

  // ------------------------------------------------------------------
  // Private: Sync shared workspace (v38)
  // ------------------------------------------------------------------

  /**
   * Ensure `<stateDir>/workspaces/shared/` exists, walk it, and reconcile the
   * `instance_shared_files` table. Symmetrical with `_syncAgentFiles()`.
   */
  private async _syncSharedWorkspace(instance: InstanceRecord): Promise<number> {
    const sharedPath = path.join(instance.state_dir, "workspaces", constants.SHARED_WORKSPACE_DIR);

    // Self-heal: mkdir is recursive, idempotent.
    try {
      await this.conn.mkdir(sharedPath);
    } catch (err) {
      logger.debug("[agent-sync] shared workspace mkdir failed", {
        error: String(err),
        sharedPath,
      });
    }

    const dbFiles = new Map(this.registry.listSharedFiles(instance.id).map((f) => [f.filename, f]));

    const walked = await walkWorkspaceFiles(this.conn, sharedPath);

    let filesChanged = 0;
    for (const { relPath, content } of walked) {
      const contentHash = hashContent(content);
      const dbFile = dbFiles.get(relPath);
      if (!dbFile || dbFile.content_hash !== contentHash) {
        this.registry.upsertSharedFile(instance.id, {
          filename: relPath,
          content,
          contentHash,
        });
        filesChanged++;
      }
      dbFiles.delete(relPath);
    }

    for (const [filename] of dbFiles) {
      this.registry.deleteSharedFile(instance.id, filename);
      filesChanged++;
    }

    return filesChanged;
  }

  // ------------------------------------------------------------------
  // Private: Load config
  // ------------------------------------------------------------------

  /** Read config from DB (source of truth), fallback to runtime.json file. */
  private async _loadConfig(instance: InstanceRecord): Promise<Record<string, unknown>> {
    const dbConfig = this.registry.getRuntimeConfig(instance.slug);
    if (dbConfig) {
      return JSON.parse(JSON.stringify(dbConfig)) as Record<string, unknown>;
    }

    // Fallback: read runtime.json (pre-v21 instances or file-only setups)
    logger.warn(
      `[agent-sync] Reading runtime.json for "${instance.slug}" — this is deprecated. ` +
        "Config should be in the database. This fallback will be removed in a future version.",
    );
    const configRaw = await this.conn.readFile(instance.config_path);
    return JSON.parse(configRaw) as Record<string, unknown>;
  }

  // ------------------------------------------------------------------
  // Private: Build config agents
  // ------------------------------------------------------------------

  /** Build the expected agent list from runtime config. */
  private _buildConfigAgents(
    agentsList: Array<Record<string, unknown>>,
    defaultModel: string | null,
    stateDir: string,
  ): ConfigAgent[] {
    const configAgents: ConfigAgent[] = [];

    // If no agents in config, create a synthetic "pilot" agent
    if (agentsList.length === 0) {
      configAgents.push({
        agentId: "pilot",
        name: "Pilot",
        model: defaultModel,
        workspacePath: `${stateDir}/workspaces/pilot`,
        isDefault: true,
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

    return configAgents;
  }

  // ------------------------------------------------------------------
  // Private: Reconcile agents
  // ------------------------------------------------------------------

  /** Reconcile config agents against DB: add/update/remove + sync workspace files. */
  private async _reconcileAgents(
    instance: InstanceRecord,
    configAgents: ConfigAgent[],
  ): Promise<{
    syncedAgents: SyncedAgent[];
    agentsAdded: string[];
    agentsRemoved: string[];
    agentsUpdated: string[];
    totalFilesChanged: number;
  }> {
    const agentsAdded: string[] = [];
    const agentsRemoved: string[] = [];
    const agentsUpdated: string[] = [];
    let totalFilesChanged = 0;

    const dbAgents = new Map(this.registry.listAgents(instance.slug).map((a) => [a.agent_id, a]));

    const syncedAgents: SyncedAgent[] = [];
    const syncedAt = new Date().toISOString();

    for (const ca of configAgents) {
      const configHash = hashContent(JSON.stringify(ca.rawBlock));
      const existing = dbAgents.get(ca.agentId);
      const configJson = JSON.stringify(ca.rawBlock);

      let agentDbId: number;

      if (!existing) {
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
          this.registry.updateAgentConfig(agentDbId, configJson);
        }
      }

      dbAgents.delete(ca.agentId);

      this.registry.updateAgentSync(agentDbId, { configHash, syncedAt });

      // Sync workspace files for this agent
      const { fileSummaries, filesChanged } = await this._syncAgentFiles(
        agentDbId,
        ca.workspacePath,
        syncedAt,
      );
      totalFilesChanged += filesChanged;

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

    // Agents remaining in dbAgents are no longer in config — delete them
    for (const [agentId, record] of dbAgents) {
      this.registry.deleteAgentById(record.id);
      agentsRemoved.push(agentId);
    }

    return { syncedAgents, agentsAdded, agentsRemoved, agentsUpdated, totalFilesChanged };
  }

  // ------------------------------------------------------------------
  // Private: Sync workspace files for a single agent
  // ------------------------------------------------------------------

  /**
   * Sync all workspace files for a single agent by recursively walking the
   * workspace directory. Every text/config file with an allowed extension
   * (see `ALLOWED_WORKSPACE_EXTENSIONS` in `src/lib/workspace-path.ts`) is
   * upserted into the `agent_files` cache under its relative path
   * (e.g. `SOUL.md`, `memory/facts.md`).
   *
   * Reserved segments (.git, node_modules, dotfiles, etc.) are skipped.
   * Files exceeding `MAX_SYNC_FILE_SIZE` are skipped (logged at debug level).
   */
  private async _syncAgentFiles(
    agentDbId: number,
    workspacePath: string,
    syncedAt: string,
  ): Promise<{
    fileSummaries: SyncedAgent["files"];
    filesChanged: number;
  }> {
    const fileSummaries: SyncedAgent["files"] = [];
    let filesChanged = 0;

    const dbFiles = new Map(this.registry.listAgentFiles(agentDbId).map((f) => [f.filename, f]));

    const walked = await walkWorkspaceFiles(this.conn, workspacePath);

    for (const { relPath, content } of walked) {
      const contentHash = hashContent(content);
      const dbFile = dbFiles.get(relPath);

      if (!dbFile || dbFile.content_hash !== contentHash) {
        this.registry.upsertAgentFile(agentDbId, { filename: relPath, content, contentHash });
        filesChanged++;
      }

      fileSummaries.push({
        filename: relPath,
        content_hash: contentHash,
        size: Buffer.byteLength(content, "utf8"),
        updated_at: syncedAt,
      });

      dbFiles.delete(relPath);
    }

    // Remove DB files that are no longer on disk
    for (const [filename] of dbFiles) {
      this.registry.deleteAgentFile(agentDbId, filename);
      filesChanged++;
    }

    return { fileSummaries, filesChanged };
  }

  // ------------------------------------------------------------------
  // Private: Extract and merge links
  // ------------------------------------------------------------------

  /** Extract spawn links from config and merge with existing a2a links. */
  private _extractAndMergeLinks(
    instance: InstanceRecord,
    agentsList: Array<Record<string, unknown>>,
  ): { links: SyncedLink[]; linksChanged: number } {
    const configSpawnLinks = this._extractSpawnLinks(agentsList);

    // Merge: replace spawn links from config, but PRESERVE existing a2a links
    const prevLinks = this.registry.listAgentLinks(instance.id);
    const existingA2aLinks = prevLinks
      .filter((l) => l.link_type === "a2a")
      .map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type as "a2a" | "spawn",
      }));

    // Preserve existing spawn links not in config (e.g. set via builder UI)
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

    const links: SyncedLink[] = mergedLinks.map((l) => ({
      source_agent_id: l.sourceAgentId,
      target_agent_id: l.targetAgentId,
      link_type: l.linkType,
    }));

    return { links, linksChanged };
  }

  /** Extract spawn links from the agents config array. */
  private _extractSpawnLinks(agentsList: Array<Record<string, unknown>>): SyncedLink[] {
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

    return configSpawnLinks;
  }
}
