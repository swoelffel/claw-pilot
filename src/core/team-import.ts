// src/core/team-import.ts
// Import an agent team from a .team.yaml file into an instance or blueprint.

import { parse as parseYaml } from "yaml";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type Database from "better-sqlite3";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { TeamFileSchema, type TeamFile } from "./team-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportResult {
  ok: true;
  agents_imported: number;
  links_imported: number;
  files_written: number;
}

export interface DryRunResult {
  ok: true;
  dry_run: true;
  summary: {
    agents_to_import: number;
    links_to_import: number;
    files_to_write: number;
    agents_to_remove: number;
    current_agent_count: number;
  };
}

export interface ValidationError {
  ok: false;
  error: "validation_failed" | "yaml_parse_error";
  message?: string;
  details?: Array<{ path: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Parse + validate
// ---------------------------------------------------------------------------

/** Parse YAML string and validate against TeamFileSchema. */
export function parseAndValidateTeam(
  yamlContent: string,
): { success: true; data: TeamFile } | { success: false; error: ValidationError } {
  // 1. Parse YAML
  let raw: unknown;
  try {
    raw = parseYaml(yamlContent);
  } catch (err) {
    return {
      success: false,
      error: {
        ok: false,
        error: "yaml_parse_error",
        message: err instanceof Error ? err.message : "Invalid YAML",
      },
    };
  }

  // 2. Validate with Zod
  const result = TeamFileSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return {
      success: false,
      error: {
        ok: false,
        error: "validation_failed",
        details,
      },
    };
  }

  return { success: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Import into blueprint (DB only)
// ---------------------------------------------------------------------------

export function importBlueprintTeam(
  db: Database.Database,
  registry: Registry,
  blueprintId: number,
  team: TeamFile,
  dryRun = false,
): ImportResult | DryRunResult {
  const blueprint = registry.getBlueprint(blueprintId);
  if (!blueprint) throw new Error(`Blueprint ${blueprintId} not found`);

  // Current state for dry-run summary
  const currentAgents = registry.listBlueprintAgents(blueprintId);

  if (dryRun) {
    const filesToWrite = team.agents.reduce(
      (sum, a) => sum + Object.keys(a.files ?? {}).length,
      0,
    );
    return {
      ok: true,
      dry_run: true,
      summary: {
        agents_to_import: team.agents.length,
        links_to_import: team.links.length,
        files_to_write: filesToWrite,
        agents_to_remove: currentAgents.length,
        current_agent_count: currentAgents.length,
      },
    };
  }

  let filesWritten = 0;

  // Run everything in a single transaction
  db.transaction(() => {
    // 1. Delete existing agent_files for all blueprint agents
    for (const agent of currentAgents) {
      db.prepare("DELETE FROM agent_files WHERE agent_id = ?").run(agent.id);
    }

    // 2. Delete existing agent_links
    db.prepare("DELETE FROM agent_links WHERE blueprint_id = ?").run(blueprintId);

    // 3. Delete existing agents
    db.prepare("DELETE FROM agents WHERE blueprint_id = ?").run(blueprintId);

    // 4. Insert new agents + files
    for (const agent of team.agents) {
      const workspacePath = `blueprint://${blueprintId}/${agent.id}`;
      const tagsJson = agent.meta?.tags ? JSON.stringify(agent.meta.tags) : null;

      // Determine model value
      let modelValue: string | null = null;
      if (agent.config?.model) {
        modelValue =
          typeof agent.config.model === "string"
            ? agent.config.model
            : JSON.stringify(agent.config.model);
      }

      db.prepare(
        `INSERT INTO agents (blueprint_id, agent_id, name, model, workspace_path, is_default,
         role, tags, notes, position_x, position_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        blueprintId,
        agent.id,
        agent.name,
        modelValue,
        workspacePath,
        agent.is_default ? 1 : 0,
        agent.meta?.role ?? null,
        tagsJson,
        agent.meta?.notes ?? null,
        agent.meta?.position?.x ?? null,
        agent.meta?.position?.y ?? null,
      );

      // Get the inserted agent's DB id
      const inserted = db
        .prepare("SELECT id FROM agents WHERE blueprint_id = ? AND agent_id = ?")
        .get(blueprintId, agent.id) as { id: number };

      // Insert files
      if (agent.files) {
        for (const [filename, content] of Object.entries(agent.files)) {
          const contentHash = createHash("sha256")
            .update(content)
            .digest("hex")
            .slice(0, 16);
          db.prepare(
            `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(
            inserted.id,
            filename,
            content,
            contentHash,
            new Date().toISOString().replace("T", " ").slice(0, 19),
          );
          filesWritten++;
        }
      }
    }

    // 5. Insert links
    for (const link of team.links) {
      db.prepare(
        `INSERT OR IGNORE INTO agent_links (blueprint_id, source_agent_id, target_agent_id, link_type)
         VALUES (?, ?, ?, ?)`,
      ).run(blueprintId, link.source, link.target, link.type);
    }
  })();

  return {
    ok: true,
    agents_imported: team.agents.length,
    links_imported: team.links.length,
    files_written: filesWritten,
  };
}

// ---------------------------------------------------------------------------
// Import into instance (DB + filesystem + openclaw.json + restart)
// ---------------------------------------------------------------------------

export async function importInstanceTeam(
  db: Database.Database,
  registry: Registry,
  conn: ServerConnection,
  instance: InstanceRecord,
  team: TeamFile,
  xdgRuntimeDir: string,
  dryRun = false,
): Promise<ImportResult | DryRunResult> {
  // Current state for dry-run summary
  const currentAgents = registry.listAgents(instance.slug);

  if (dryRun) {
    const filesToWrite = team.agents.reduce(
      (sum, a) => sum + Object.keys(a.files ?? {}).length,
      0,
    );
    return {
      ok: true,
      dry_run: true,
      summary: {
        agents_to_import: team.agents.length,
        links_to_import: team.links.length,
        files_to_write: filesToWrite,
        agents_to_remove: currentAgents.length,
        current_agent_count: currentAgents.length,
      },
    };
  }

  let filesWritten = 0;

  // --- Phase A: DB transaction ---
  db.transaction(() => {
    // 1. Delete existing agent_files for all instance agents
    for (const agent of currentAgents) {
      db.prepare("DELETE FROM agent_files WHERE agent_id = ?").run(agent.id);
    }

    // 2. Delete existing agent_links
    db.prepare("DELETE FROM agent_links WHERE instance_id = ?").run(instance.id);

    // 3. Delete existing agents
    db.prepare("DELETE FROM agents WHERE instance_id = ?").run(instance.id);

    // 4. Insert new agents + files
    const openclawHome = path.dirname(instance.config_path);

    for (const agent of team.agents) {
      // agent-sync.ts resolves workspace paths as stateDir/workspaces/{workspace}.
      // We must use the same convention so that the post-import sync finds the files.
      const workspacePath = agent.is_default
        ? path.join(openclawHome, "workspaces", "workspace")
        : path.join(openclawHome, "workspaces", `workspace-${agent.id}`);

      const tagsJson = agent.meta?.tags ? JSON.stringify(agent.meta.tags) : null;

      let modelValue: string | null = null;
      if (agent.config?.model) {
        modelValue =
          typeof agent.config.model === "string"
            ? agent.config.model
            : JSON.stringify(agent.config.model);
      }

      db.prepare(
        `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default,
         role, tags, notes, position_x, position_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        instance.id,
        agent.id,
        agent.name,
        modelValue,
        workspacePath,
        agent.is_default ? 1 : 0,
        agent.meta?.role ?? null,
        tagsJson,
        agent.meta?.notes ?? null,
        agent.meta?.position?.x ?? null,
        agent.meta?.position?.y ?? null,
      );

      // Get the inserted agent's DB id
      const inserted = db
        .prepare("SELECT id FROM agents WHERE instance_id = ? AND agent_id = ?")
        .get(instance.id, agent.id) as { id: number };

      // Insert files
      if (agent.files) {
        for (const [filename, content] of Object.entries(agent.files)) {
          const contentHash = createHash("sha256")
            .update(content)
            .digest("hex")
            .slice(0, 16);
          db.prepare(
            `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(
            inserted.id,
            filename,
            content,
            contentHash,
            new Date().toISOString().replace("T", " ").slice(0, 19),
          );
        }
      }
    }

    // 5. Insert links
    for (const link of team.links) {
      db.prepare(
        `INSERT OR IGNORE INTO agent_links (instance_id, source_agent_id, target_agent_id, link_type)
         VALUES (?, ?, ?, ?)`,
      ).run(instance.id, link.source, link.target, link.type);
    }
  })();

  // --- Phase B: Filesystem operations ---

  // B1. Regenerate openclaw.json (partial merge)
  const configRaw = await conn.readFile(instance.config_path);
  const config = JSON.parse(configRaw) as Record<string, unknown>;
  mergeTeamIntoConfig(config, team);
  await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

  // B2. Write workspace files to disk
  const openclawHome = path.dirname(instance.config_path);
  filesWritten = await syncWorkspacesToDisk(conn, openclawHome, team);

  // B3. Restart daemon (best-effort, don't fail the import)
  try {
    await restartDaemon(conn, instance, xdgRuntimeDir);
  } catch {
    // Best-effort restart — import is still successful
  }

  return {
    ok: true,
    agents_imported: team.agents.length,
    links_imported: team.links.length,
    files_written: filesWritten,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merge team data into an existing openclaw.json config.
 * Only modifies agents.defaults, agents.list[], and tools.agentToAgent.
 * All other sections (providers, telegram, mem0, etc.) are preserved.
 */
function mergeTeamIntoConfig(
  config: Record<string, unknown>,
  team: TeamFile,
): void {
  // Ensure agents section exists
  if (!config["agents"] || typeof config["agents"] !== "object") {
    config["agents"] = {};
  }
  const agentsConf = config["agents"] as Record<string, unknown>;

  // 1. Update agents.defaults
  if (team.defaults) {
    const existingDefaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;
    agentsConf["defaults"] = { ...existingDefaults, ...team.defaults };
  }

  // Also merge the default agent's config into agents.defaults
  const defaultAgent = team.agents.find((a) => a.is_default);
  if (defaultAgent?.config) {
    const existingDefaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;
    const { model, identity, subagents, heartbeat, sandbox, tools, params, skills, humanDelay, groupChat } =
      defaultAgent.config;
    const merged: Record<string, unknown> = { ...existingDefaults };
    if (model !== undefined) merged["model"] = model;
    if (identity !== undefined) merged["identity"] = identity;
    if (subagents !== undefined) merged["subagents"] = { ...(merged["subagents"] as Record<string, unknown> ?? {}), ...subagents };
    if (heartbeat !== undefined) merged["heartbeat"] = heartbeat;
    if (sandbox !== undefined) merged["sandbox"] = sandbox;
    if (tools !== undefined) merged["tools"] = tools;
    if (params !== undefined) merged["params"] = params;
    if (skills !== undefined) merged["skills"] = skills;
    if (humanDelay !== undefined) merged["humanDelay"] = humanDelay;
    if (groupChat !== undefined) merged["groupChat"] = groupChat;
    agentsConf["defaults"] = merged;
  }

  // Rebuild subagents.allowAgents in agents.defaults from spawn links in the YAML.
  // agent-sync.ts derives spawn links by reading this field from openclaw.json —
  // if it is missing, the sync overwrites the DB links with an empty list.
  // We only set allowAgents for the default agent (main); non-default agents with
  // spawn links are handled via their list[] entry below.
  if (defaultAgent) {
    const spawnTargets = team.links
      .filter((l) => l.type === "spawn" && l.source === defaultAgent.id)
      .map((l) => l.target);

    if (spawnTargets.length > 0) {
      const existingDefaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;
      const existingSubagents = (existingDefaults["subagents"] ?? {}) as Record<string, unknown>;
      existingDefaults["subagents"] = { ...existingSubagents, allowAgents: spawnTargets };
      agentsConf["defaults"] = existingDefaults;
    }
  }

  // 2. Rebuild agents.list[] from non-default agents
  const agentsList = team.agents
    .filter((a) => !a.is_default)
    .map((a) => {
      const entry: Record<string, unknown> = {
        id: a.id,
        name: a.name,
        workspace: `workspace-${a.id}`,
      };
      // Spread config fields
      if (a.config) {
        const { model, identity, subagents, heartbeat, sandbox, tools, params, skills, humanDelay, groupChat } = a.config;
        if (model !== undefined) entry["model"] = model;
        if (identity !== undefined) entry["identity"] = identity;
        if (subagents !== undefined) entry["subagents"] = subagents;
        if (heartbeat !== undefined) entry["heartbeat"] = heartbeat;
        if (sandbox !== undefined) entry["sandbox"] = sandbox;
        if (tools !== undefined) entry["tools"] = tools;
        if (params !== undefined) entry["params"] = params;
        if (skills !== undefined) entry["skills"] = skills;
        if (humanDelay !== undefined) entry["humanDelay"] = humanDelay;
        if (groupChat !== undefined) entry["groupChat"] = groupChat;
      }

      // Inject subagents.allowAgents from spawn links for this non-default agent.
      // Same reason as for the default agent: agent-sync.ts reads this field to
      // reconstruct spawn links, so it must be present in openclaw.json.
      const agentSpawnTargets = team.links
        .filter((l) => l.type === "spawn" && l.source === a.id)
        .map((l) => l.target);
      if (agentSpawnTargets.length > 0) {
        const existingSubagents = (entry["subagents"] ?? {}) as Record<string, unknown>;
        entry["subagents"] = { ...existingSubagents, allowAgents: agentSpawnTargets };
      }

      return entry;
    });
  agentsConf["list"] = agentsList;

  // 3. Update tools.agentToAgent
  if (team.agent_to_agent) {
    if (!config["tools"] || typeof config["tools"] !== "object") {
      config["tools"] = {};
    }
    (config["tools"] as Record<string, unknown>)["agentToAgent"] = team.agent_to_agent;
  }
}

/** Write workspace files to disk for all agents. */
async function syncWorkspacesToDisk(
  conn: ServerConnection,
  openclawHome: string,
  team: TeamFile,
): Promise<number> {
  let filesWritten = 0;

  for (const agent of team.agents) {
    // Same convention as agent-sync.ts: stateDir/workspaces/{workspace}
    const workspacePath = agent.is_default
      ? path.join(openclawHome, "workspaces", "workspace")
      : path.join(openclawHome, "workspaces", `workspace-${agent.id}`);

    // Create workspace directory
    await conn.mkdir(workspacePath);

    // Write files
    if (agent.files) {
      for (const [filename, content] of Object.entries(agent.files)) {
        await conn.writeFile(path.join(workspacePath, filename), content);
        filesWritten++;
      }
    }
  }

  return filesWritten;
}

/** Restart the OpenClaw daemon for an instance. */
async function restartDaemon(
  conn: ServerConnection,
  instance: InstanceRecord,
  xdgRuntimeDir: string,
): Promise<void> {
  const { getServiceManager, getLaunchdPlistPath } = await import("../lib/platform.js");
  const sm = getServiceManager();

  if (sm === "launchd") {
    const plistPath = getLaunchdPlistPath(instance.slug);
    await conn.execFile("launchctl", ["unload", plistPath]);
    await conn.execFile("launchctl", ["load", "-w", plistPath]);
  } else {
    await conn.execFile("systemctl", ["--user", "restart", instance.systemd_unit], {
      env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
    });
  }
}
