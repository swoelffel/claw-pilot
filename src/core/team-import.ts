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
import { Lifecycle } from "./lifecycle.js";

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
    const stateDir = target.type === "instance" ? path.dirname(target.configPath) : null;

    for (const agent of team.agents) {
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

      if (target.type === "blueprint") {
        // Serialize skills from config.skills (array) → JSON string for DB column.
        const skillsJson =
          Array.isArray(agent.config?.skills) && (agent.config.skills as string[]).length >= 0
            ? JSON.stringify(agent.config.skills)
            : null;

        db.prepare(
          `INSERT INTO agents (blueprint_id, agent_id, name, model, workspace_path, is_default,
           role, tags, notes, skills, position_x, position_y, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          createdAt,
        );
      } else {
        db.prepare(
          `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default,
           role, tags, notes, position_x, position_y, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    // Include gap-fill: each agent gets EXPORTABLE_FILES minus what's already in the YAML
    const filesToWrite = team.agents.reduce((sum, a) => {
      const provided = Object.keys(a.files ?? {}).filter((f) =>
        (constants.EXPORTABLE_FILES as readonly string[]).includes(f),
      ).length;
      return (
        sum + Object.keys(a.files ?? {}).length + (constants.EXPORTABLE_FILES.length - provided)
      );
    }, 0);
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
    // Include gap-fill: each agent gets EXPORTABLE_FILES minus what's already in the YAML
    const filesToWrite = team.agents.reduce((sum, a) => {
      const provided = Object.keys(a.files ?? {}).filter((f) =>
        (constants.EXPORTABLE_FILES as readonly string[]).includes(f),
      ).length;
      return (
        sum + Object.keys(a.files ?? {}).length + (constants.EXPORTABLE_FILES.length - provided)
      );
    }, 0);
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

  // B1. Regenerate runtime.json (partial merge)
  const configRaw = await conn.readFile(instance.config_path);
  const config = JSON.parse(configRaw) as Record<string, unknown>;
  mergeTeamIntoRuntimeConfig(config, team);
  await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2) + "\n");

  // B2. Write workspace files to disk
  const stateDir = path.dirname(instance.config_path);
  const filesWritten = await syncWorkspacesToDisk(conn, stateDir, team);

  // B3. Restart daemon (best-effort, don't fail the import)
  try {
    const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
    await lifecycle.restart(instance.slug);
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

    // Spread config fields
    if (agent.config) {
      const {
        model,
        toolProfile,
        permissions,
        subagents,
        tools,
        params,
        skills,
        heartbeat,
        humanDelay,
        identity,
        sandbox,
        groupChat,
      } = agent.config;
      if (model !== undefined) entry["model"] = model;
      if (toolProfile !== undefined) entry["toolProfile"] = toolProfile;
      if (permissions !== undefined) entry["permissions"] = permissions;
      if (subagents !== undefined) entry["subagents"] = subagents;
      if (tools !== undefined) entry["tools"] = tools;
      if (params !== undefined) entry["params"] = params;
      if (skills !== undefined) entry["skills"] = skills;
      if (heartbeat !== undefined) entry["heartbeat"] = heartbeat;
      if (humanDelay !== undefined) entry["humanDelay"] = humanDelay;
      if (identity !== undefined) entry["identity"] = identity;
      if (sandbox !== undefined) entry["sandbox"] = sandbox;
      if (groupChat !== undefined) entry["groupChat"] = groupChat;
    }

    // Inject subagents.allowAgents from spawn links
    const spawnTargets = team.links
      .filter((l) => l.type === "spawn" && l.source === agent.id)
      .map((l) => l.target);
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
