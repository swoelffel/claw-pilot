// src/core/team-import.ts
// Import an agent team from a .team.yaml file into an instance or blueprint.

import { parse as parseYaml } from "yaml";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type Database from "better-sqlite3";
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { TeamFileSchema, type TeamFile } from "./team-schema.js";
import { logger } from "../lib/logger.js";
import { now } from "../lib/date.js";
import { constants } from "../lib/constants.js";
import { loadWorkspaceTemplate, type TemplateVars } from "../lib/workspace-templates.js";
import { Lifecycle } from "./lifecycle.js";
import { getBus } from "../runtime/bus/index.js";
import { WorkspaceFileChanged } from "../runtime/bus/events.js";
import type { InstanceSlug, AgentId } from "../runtime/types.js";

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

/** Delete existing agents and links for the target (blueprint or instance). */
function deleteExistingAgents(db: Database.Database, target: ImportTarget): void {
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

  if (target.type === "blueprint") {
    db.prepare("DELETE FROM agent_links WHERE blueprint_id = ?").run(target.blueprintId);
    db.prepare("DELETE FROM agents WHERE blueprint_id = ?").run(target.blueprintId);
  } else {
    db.prepare("DELETE FROM agent_links WHERE instance_id = ?").run(target.instanceId);
    db.prepare("DELETE FROM agents WHERE instance_id = ?").run(target.instanceId);
  }
}

/** Insert a single agent into the DB and return its DB id. */
function insertAgent(
  db: Database.Database,
  target: ImportTarget,
  agent: TeamFile["agents"][number],
  stateDir: string | null,
): number {
  const workspacePath =
    target.type === "blueprint"
      ? `blueprint://${target.blueprintId}/${agent.id}`
      : path.join(stateDir!, "workspaces", agent.id);

  const tagsJson = agent.meta?.tags ? JSON.stringify(agent.meta.tags) : null;
  let modelValue: string | null = null;
  if (agent.config?.model) {
    modelValue =
      typeof agent.config.model === "string"
        ? agent.config.model
        : JSON.stringify(agent.config.model);
  }

  const createdAt = now();

  // Reconstruct config_json from YAML agent config + top-level fields
  const configJsonValue = agent.config
    ? JSON.stringify({
        id: agent.id,
        name: agent.name,
        isDefault: agent.is_default,
        ...agent.config,
      })
    : null;

  if (target.type === "blueprint") {
    db.prepare(
      `INSERT INTO agents (blueprint_id, agent_id, name, model, workspace_path, is_default,
       role, tags, notes, skills, position_x, position_y, created_at, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      null, // skills column (deprecated — archetype is now in config)
      agent.meta?.position?.x ?? null,
      agent.meta?.position?.y ?? null,
      createdAt,
      configJsonValue,
    );
  } else {
    db.prepare(
      `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default,
       role, tags, notes, position_x, position_y, created_at, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      createdAt,
      configJsonValue,
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

  return inserted.id;
}

/** Insert files from YAML for a single agent, return the set of filenames written. */
function insertAgentFiles(
  db: Database.Database,
  agentDbId: number,
  files: Record<string, string> | undefined,
): { filesWritten: number; existingFilenames: Set<string> } {
  const existingFilenames = new Set<string>();
  let filesWritten = 0;

  if (!files) return { filesWritten, existingFilenames };

  for (const [filename, content] of Object.entries(files)) {
    const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    db.prepare(
      `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(agentDbId, filename, content, contentHash, now());
    filesWritten++;
    existingFilenames.add(filename);
  }

  return { filesWritten, existingFilenames };
}

/** Insert links into the DB for the given target. */
function insertLinks(db: Database.Database, target: ImportTarget, links: TeamFile["links"]): void {
  for (const link of links) {
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
}

/** Gap-fill missing EXPORTABLE_FILES from templates for all agents. */
async function gapFillMissingFiles(
  db: Database.Database,
  agentsToGapFill: Array<{
    dbId: number;
    agentId: string;
    agentName: string;
    existingFilenames: Set<string>;
  }>,
): Promise<number> {
  let filesWritten = 0;

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
  const agentsToGapFill: Array<{
    dbId: number;
    agentId: string;
    agentName: string;
    existingFilenames: Set<string>;
  }> = [];

  db.transaction(() => {
    // 1. Delete existing agents, files, and links
    deleteExistingAgents(db, target);

    // 2. Insert new agents + files
    const stateDir = target.type === "instance" ? path.dirname(target.configPath) : null;

    for (const agent of team.agents) {
      const agentDbId = insertAgent(db, target, agent, stateDir);

      const { filesWritten: agentFiles, existingFilenames } = insertAgentFiles(
        db,
        agentDbId,
        agent.files,
      );
      filesWritten += agentFiles;

      agentsToGapFill.push({
        dbId: agentDbId,
        agentId: agent.id,
        agentName: agent.name,
        existingFilenames,
      });
    }

    // 3. Insert links
    insertLinks(db, target, team.links);
  })();

  // --- Phase 2: Gap-fill missing EXPORTABLE_FILES from templates (async) ---
  filesWritten += await gapFillMissingFiles(db, agentsToGapFill);

  return filesWritten;
}

// ---------------------------------------------------------------------------
// Dry-run file count helper
// ---------------------------------------------------------------------------

/** Compute the number of files that would be written (YAML + gap-fill). */
function computeDryRunFileCount(team: TeamFile): number {
  return team.agents.reduce((sum, a) => {
    const provided = Object.keys(a.files ?? {}).filter((f) =>
      (constants.EXPORTABLE_FILES as readonly string[]).includes(f),
    ).length;
    return sum + Object.keys(a.files ?? {}).length + (constants.EXPORTABLE_FILES.length - provided);
  }, 0);
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
    return {
      ok: true,
      dry_run: true,
      summary: {
        agents_to_import: team.agents.length,
        links_to_import: team.links.length,
        files_to_write: computeDryRunFileCount(team),
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
// Import into instance (DB + filesystem + runtime.json + restart)
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
    return {
      ok: true,
      dry_run: true,
      summary: {
        agents_to_import: team.agents.length,
        links_to_import: team.links.length,
        files_to_write: computeDryRunFileCount(team),
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
  await syncInstanceFilesystem(conn, registry, instance, team, xdgRuntimeDir);

  return {
    ok: true,
    agents_imported: team.agents.length,
    links_imported: team.links.length,
    files_written: await syncWorkspacesToDisk(conn, path.dirname(instance.config_path), team),
  };
}

// ---------------------------------------------------------------------------
// Instance filesystem sync
// ---------------------------------------------------------------------------

/** Perform filesystem operations after DB import: config merge, workspace write, bus notify, restart. */
async function syncInstanceFilesystem(
  conn: ServerConnection,
  registry: Registry,
  instance: InstanceRecord,
  team: TeamFile,
  xdgRuntimeDir: string,
): Promise<void> {
  // B1. Regenerate runtime.json (partial merge)
  const configRaw = await conn.readFile(instance.config_path);
  const config = JSON.parse(configRaw) as Record<string, unknown>;
  mergeTeamIntoRuntimeConfig(config, team);
  await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

  // B1b. Sync to DB — the runtime loads config from DB (runtime_config_json), not just the file
  registry.saveRuntimeConfig(instance.slug, config as Parameters<Registry["saveRuntimeConfig"]>[1]);

  // B2. Write workspace files to disk
  const stateDir = path.dirname(instance.config_path);
  await syncWorkspacesToDisk(conn, stateDir, team);

  // B2b. Notify runtime of changed workspace files (invalidates cache + dirty flags)
  notifyWorkspaceChanges(instance, team, stateDir);

  // B3. Restart daemon (best-effort, don't fail the import)
  try {
    const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
    await lifecycle.restart(instance.slug);
  } catch (err) {
    logger.warn("[team-import] best-effort restart failed after import", { error: String(err) });
  }
}

/** Notify the runtime bus of changed workspace files. */
function notifyWorkspaceChanges(instance: InstanceRecord, team: TeamFile, stateDir: string): void {
  try {
    const bus = getBus(instance.slug);
    for (const agent of team.agents) {
      if (!agent.files) continue;
      for (const filename of Object.keys(agent.files)) {
        const filePath = path.join(stateDir, "workspaces", agent.id, filename);
        bus.publish(WorkspaceFileChanged, {
          instanceSlug: instance.slug as InstanceSlug,
          agentId: agent.id as AgentId,
          filename,
          filePath,
        });
      }
    }
  } catch (err) {
    // Bus may not exist if the runtime is not running — restart will clear the cache
    logger.debug("[team-import] workspace file change notification skipped (bus unavailable)", {
      error: String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the effective model for an agent entry. */
function resolveAgentModel(
  agentEntry: Record<string, unknown>,
  team: TeamFile,
  config: Record<string, unknown>,
): void {
  if (agentEntry["model"]) return;

  const teamModel =
    typeof team.defaults?.model === "string"
      ? team.defaults.model
      : typeof team.defaults?.model === "object" && team.defaults?.model !== null
        ? (team.defaults.model as { primary?: string }).primary
        : undefined;
  const fallback = teamModel ?? (config["defaultModel"] as string | undefined);
  if (fallback) {
    agentEntry["model"] = fallback;
  }
}

/**
 * Merge team data into an existing runtime.json config.
 * Updates the agents[] array and defaultModel.
 * All other sections (channels, port, etc.) are preserved.
 */
function mergeTeamIntoRuntimeConfig(config: Record<string, unknown>, team: TeamFile): void {
  // Update defaultModel from team defaults
  if (team.defaults?.model) {
    config["defaultModel"] = team.defaults.model;
  }

  // Rebuild agents[] array from team
  const agents: Array<Record<string, unknown>> = [];

  for (const agent of team.agents) {
    const entry: Record<string, unknown> = {
      id: agent.id,
      name: agent.name,
    };

    if (agent.is_default) {
      entry["isDefault"] = true;
    }

    // Spread all config fields into the runtime.json agent entry
    if (agent.config) {
      for (const [key, value] of Object.entries(agent.config)) {
        if (value !== undefined) {
          entry[key] = value;
        }
      }
    }

    // Ensure every agent has a model
    resolveAgentModel(entry, team, config);

    // Inject subagents.allowAgents from spawn links
    // Targets starting with "@" are archetype references — strip the prefix for allowList
    const spawnTargets = team.links
      .filter((l) => l.type === "spawn" && l.source === agent.id)
      .map((l) => (l.target.startsWith("@") ? l.target.slice(1) : l.target));
    if (spawnTargets.length > 0) {
      const existingSubagents = (entry["subagents"] ?? {}) as Record<string, unknown>;
      entry["subagents"] = { ...existingSubagents, allowAgents: spawnTargets };
    }

    agents.push(entry);
  }

  config["agents"] = agents;
}

/**
 * Write workspace files to disk for all agents.
 * Gap-fills missing EXPORTABLE_FILES with default templates.
 */
async function syncWorkspacesToDisk(
  conn: ServerConnection,
  stateDir: string,
  team: TeamFile,
): Promise<number> {
  let filesWritten = 0;

  for (const agent of team.agents) {
    const workspacePath = path.join(stateDir, "workspaces", agent.id);

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
