// src/core/team-import.ts
// Import an agent team from a .team.yaml file into an instance or blueprint.

import { parse as parseYaml } from "yaml";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type Database from "better-sqlite3";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { TeamFileSchema, type TeamFile } from "./team-schema.js";
import { now } from "../lib/date.js";
import { constants } from "../lib/constants.js";
import { loadWorkspaceTemplate, type TemplateVars } from "../lib/workspace-templates.js";

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
// Internal helpers
// ---------------------------------------------------------------------------

type ImportTarget =
  | { type: "blueprint"; blueprintId: number }
  | { type: "instance"; instanceId: number; configPath: string };

/**
 * Core DB transaction shared by importBlueprintTeam and importInstanceTeam.
 *
 * After inserting the YAML-provided files, gap-fills any missing EXPORTABLE_FILES
 * with default templates from templates/workspace/. This ensures that blueprints
 * imported from outside claw-pilot (e.g., with only AGENTS.md + SOUL.md + USER.md)
 * get a complete set of workspace files.
 *
 * Returns the number of files written (YAML + gap-filled).
 */
async function _importTeamCore(
  db: Database.Database,
  target: ImportTarget,
  team: TeamFile,
): Promise<number> {
  let filesWritten = 0;

  // --- Phase 1: DB transaction (synchronous) ---
  // Collect { agentDbId, agentId, agentName, existingFilenames } for gap-fill phase.
  const agentsToGapFill: Array<{
    dbId: number;
    agentId: string;
    agentName: string;
    existingFilenames: Set<string>;
  }> = [];

  db.transaction(() => {
    // 1. Delete existing agent_files
    const existingAgents =
      target.type === "blueprint"
        ? (db.prepare("SELECT id FROM agents WHERE blueprint_id = ?").all(target.blueprintId) as {
            id: number;
          }[])
        : (db.prepare("SELECT id FROM agents WHERE instance_id = ?").all(target.instanceId) as {
            id: number;
          }[]);

    for (const agent of existingAgents) {
      db.prepare("DELETE FROM agent_files WHERE agent_id = ?").run(agent.id);
    }

    // 2. Delete existing agent_links
    if (target.type === "blueprint") {
      db.prepare("DELETE FROM agent_links WHERE blueprint_id = ?").run(target.blueprintId);
      db.prepare("DELETE FROM agents WHERE blueprint_id = ?").run(target.blueprintId);
    } else {
      db.prepare("DELETE FROM agent_links WHERE instance_id = ?").run(target.instanceId);
      db.prepare("DELETE FROM agents WHERE instance_id = ?").run(target.instanceId);
    }

    // 3. Insert new agents + files
    const openclawHome = target.type === "instance" ? path.dirname(target.configPath) : null;

    for (const agent of team.agents) {
      const workspacePath =
        target.type === "blueprint"
          ? `blueprint://${target.blueprintId}/${agent.id}`
          : agent.is_default
            ? path.join(openclawHome!, "workspaces", "workspace")
            : path.join(openclawHome!, "workspaces", `workspace-${agent.id}`);

      const tagsJson = agent.meta?.tags ? JSON.stringify(agent.meta.tags) : null;
      let modelValue: string | null = null;
      if (agent.config?.model) {
        modelValue =
          typeof agent.config.model === "string"
            ? agent.config.model
            : JSON.stringify(agent.config.model);
      }

      if (target.type === "blueprint") {
        // Serialize skills from config.skills (array) → JSON string for DB column.
        // Array.isArray check handles both populated arrays and empty arrays [].
        const skillsJson =
          Array.isArray(agent.config?.skills) && (agent.config.skills as string[]).length >= 0
            ? JSON.stringify(agent.config.skills)
            : null;

        db.prepare(
          `INSERT INTO agents (blueprint_id, agent_id, name, model, workspace_path, is_default,
           role, tags, notes, skills, position_x, position_y)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          target.blueprintId,
          agent.id,
          agent.name,
          modelValue,
          workspacePath,
          agent.is_default ? 1 : 0,
          agent.meta?.role ?? null,
          tagsJson,
          agent.meta?.notes ?? null,
          skillsJson,
          agent.meta?.position?.x ?? null,
          agent.meta?.position?.y ?? null,
        );
      } else {
        db.prepare(
          `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default,
           role, tags, notes, position_x, position_y)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          target.instanceId,
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
      }

      // Get the inserted agent's DB id
      const inserted =
        target.type === "blueprint"
          ? (db
              .prepare("SELECT id FROM agents WHERE blueprint_id = ? AND agent_id = ?")
              .get(target.blueprintId, agent.id) as { id: number })
          : (db
              .prepare("SELECT id FROM agents WHERE instance_id = ? AND agent_id = ?")
              .get(target.instanceId, agent.id) as { id: number });

      // Insert files from YAML
      const existingFilenames = new Set<string>();
      if (agent.files) {
        for (const [filename, content] of Object.entries(agent.files)) {
          const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
          db.prepare(
            `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(inserted.id, filename, content, contentHash, now());
          filesWritten++;
          existingFilenames.add(filename);
        }
      }

      // Track for gap-fill phase
      agentsToGapFill.push({
        dbId: inserted.id,
        agentId: agent.id,
        agentName: agent.name,
        existingFilenames,
      });
    }

    // 4. Insert links
    for (const link of team.links) {
      if (target.type === "blueprint") {
        db.prepare(
          `INSERT OR IGNORE INTO agent_links (blueprint_id, source_agent_id, target_agent_id, link_type)
           VALUES (?, ?, ?, ?)`,
        ).run(target.blueprintId, link.source, link.target, link.type);
      } else {
        db.prepare(
          `INSERT OR IGNORE INTO agent_links (instance_id, source_agent_id, target_agent_id, link_type)
           VALUES (?, ?, ?, ?)`,
        ).run(target.instanceId, link.source, link.target, link.type);
      }
    }
  })();

  // --- Phase 2: Gap-fill missing EXPORTABLE_FILES from templates (async) ---
  // This runs outside the transaction since template loading is async.
  // We use a separate INSERT for each gap-filled file.
  const insertFile = db.prepare(
    `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const agent of agentsToGapFill) {
    const missingFiles = constants.EXPORTABLE_FILES.filter((f) => !agent.existingFilenames.has(f));
    if (missingFiles.length === 0) continue;

    const vars: TemplateVars = {
      agentId: agent.agentId,
      agentName: agent.agentName,
    };

    for (const filename of missingFiles) {
      const content = await loadWorkspaceTemplate(filename, vars);
      const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      insertFile.run(agent.dbId, filename, content, contentHash, now());
      filesWritten++;
    }
  }

  return filesWritten;
}

// ---------------------------------------------------------------------------
// Import into blueprint (DB only)
// ---------------------------------------------------------------------------

export async function importBlueprintTeam(
  db: Database.Database,
  registry: Registry,
  blueprintId: number,
  team: TeamFile,
  dryRun = false,
): Promise<ImportResult | DryRunResult> {
  const blueprint = registry.getBlueprint(blueprintId);
  if (!blueprint) throw new Error(`Blueprint ${blueprintId} not found`);

  const currentAgents = registry.listBlueprintAgents(blueprintId);

  if (dryRun) {
    const filesToWrite = team.agents.reduce((sum, a) => sum + Object.keys(a.files ?? {}).length, 0);
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

  const filesWritten = await _importTeamCore(db, { type: "blueprint", blueprintId }, team);

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
  const currentAgents = registry.listAgents(instance.slug);

  if (dryRun) {
    const filesToWrite = team.agents.reduce((sum, a) => sum + Object.keys(a.files ?? {}).length, 0);
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

  // --- Phase A: DB transaction + gap-fill ---
  await _importTeamCore(
    db,
    { type: "instance", instanceId: instance.id, configPath: instance.config_path },
    team,
  );

  // --- Phase B: Filesystem operations ---

  // B1. Regenerate openclaw.json (partial merge)
  const configRaw = await conn.readFile(instance.config_path);
  const config = JSON.parse(configRaw) as Record<string, unknown>;
  mergeTeamIntoConfig(config, team);
  await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

  // B2. Write workspace files to disk
  const openclawHome = path.dirname(instance.config_path);
  const filesWritten = await syncWorkspacesToDisk(conn, openclawHome, team);

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

/** Update agents.defaults from team.defaults and the default agent's config. */
function buildDefaultsSection(
  existingDefaults: Record<string, unknown>,
  team: TeamFile,
): Record<string, unknown> {
  let merged: Record<string, unknown> = { ...existingDefaults };

  // Apply top-level team.defaults first
  if (team.defaults) {
    merged = { ...merged, ...team.defaults };
  }

  // Then merge the default agent's config into agents.defaults
  const defaultAgent = team.agents.find((a) => a.is_default);
  if (defaultAgent?.config) {
    const {
      model,
      identity,
      subagents,
      heartbeat,
      sandbox,
      tools,
      params,
      skills,
      humanDelay,
      groupChat,
    } = defaultAgent.config;
    if (model !== undefined) merged["model"] = model;
    if (identity !== undefined) merged["identity"] = identity;
    if (subagents !== undefined)
      merged["subagents"] = {
        ...((merged["subagents"] as Record<string, unknown>) ?? {}),
        ...subagents,
      };
    if (heartbeat !== undefined) merged["heartbeat"] = heartbeat;
    if (sandbox !== undefined) merged["sandbox"] = sandbox;
    if (tools !== undefined) merged["tools"] = tools;
    if (params !== undefined) merged["params"] = params;
    if (skills !== undefined) merged["skills"] = skills;
    if (humanDelay !== undefined) merged["humanDelay"] = humanDelay;
    if (groupChat !== undefined) merged["groupChat"] = groupChat;
  }

  return merged;
}

/** Build the agents.list[] array from non-default agents + default agent entry. */
function buildAgentsList(team: TeamFile): Array<Record<string, unknown>> {
  // Rebuild agents.list[] from non-default agents
  // NOTE: spawn links for the default agent (main) are handled via a dedicated
  // list[] entry for "main" appended below. OpenClaw rejects allowAgents inside
  // agents.defaults.subagents — it is only valid inside list[].subagents.
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
        const {
          model,
          identity,
          subagents,
          heartbeat,
          sandbox,
          tools,
          params,
          skills,
          humanDelay,
          groupChat,
        } = a.config;
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

  // Always prepend a dedicated list[] entry for the default agent (main).
  // - "default": true is required so OpenClaw knows which agent is the default;
  //   without it, OpenClaw picks the first entry alphabetically.
  // - "name" preserves the display name.
  // - subagents.allowAgents carries spawn links (only valid location in list[],
  //   OpenClaw rejects it in defaults.subagents).
  // Prepend so main appears first in the list, matching the source instance order.
  const defaultAgent = team.agents.find((a) => a.is_default);
  if (defaultAgent) {
    const mainSpawnTargets = team.links
      .filter((l) => l.type === "spawn" && l.source === defaultAgent.id)
      .map((l) => l.target);
    const mainEntry: Record<string, unknown> = {
      id: defaultAgent.id,
      default: true,
    };
    if (defaultAgent.name) mainEntry["name"] = defaultAgent.name;
    if (defaultAgent.config?.model !== undefined) mainEntry["model"] = defaultAgent.config.model;
    if (mainSpawnTargets.length > 0) {
      mainEntry["subagents"] = { allowAgents: mainSpawnTargets };
    }
    agentsList.unshift(mainEntry);
  }

  return agentsList;
}

/** Extract tools.agentToAgent from team if present. */
function buildAgentToAgentSection(team: TeamFile): unknown | undefined {
  return team.agent_to_agent;
}

/**
 * Merge team data into an existing openclaw.json config.
 * Only modifies agents.defaults, agents.list[], and tools.agentToAgent.
 * All other sections (providers, telegram, mem0, etc.) are preserved.
 */
function mergeTeamIntoConfig(config: Record<string, unknown>, team: TeamFile): void {
  if (!config["agents"] || typeof config["agents"] !== "object") config["agents"] = {};
  const agentsConf = config["agents"] as Record<string, unknown>;

  const existingDefaults = (agentsConf["defaults"] ?? {}) as Record<string, unknown>;
  agentsConf["defaults"] = buildDefaultsSection(existingDefaults, team);
  agentsConf["list"] = buildAgentsList(team);

  const a2a = buildAgentToAgentSection(team);
  if (a2a !== undefined) {
    if (!config["tools"] || typeof config["tools"] !== "object") config["tools"] = {};
    (config["tools"] as Record<string, unknown>)["agentToAgent"] = a2a;
  }
}

/**
 * Write workspace files to disk for all agents.
 * Gap-fills missing EXPORTABLE_FILES with default templates — same logic as
 * the DB gap-fill in _importTeamCore, but for the filesystem.
 */
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

    // Write YAML-provided files
    const writtenFilenames = new Set<string>();
    if (agent.files) {
      for (const [filename, content] of Object.entries(agent.files)) {
        await conn.writeFile(path.join(workspacePath, filename), content);
        filesWritten++;
        writtenFilenames.add(filename);
      }
    }

    // Gap-fill missing EXPORTABLE_FILES with templates
    const missingFiles = constants.EXPORTABLE_FILES.filter((f) => !writtenFilenames.has(f));
    if (missingFiles.length > 0) {
      const vars: TemplateVars = {
        agentId: agent.id,
        agentName: agent.name,
      };
      for (const filename of missingFiles) {
        const content = await loadWorkspaceTemplate(filename, vars);
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
