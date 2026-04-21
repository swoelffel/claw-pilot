// src/core/system-instance.ts
//
// Service for auto-provisioning and managing the system instance (cp-system).
// The system instance hosts the system-pilot agent and subagents used by the Home chatbot.
// Agent config comes from templates/system/cp-system.team.yaml (editable).
// Flow definitions come from templates/system/cp-system.flows.json (editable).

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import type { Lifecycle } from "./lifecycle.js";
import type { InstanceRecord } from "./registry-types.js";
import { NamedKeyRepository } from "./repositories/named-key-repository.js";
import { Provisioner } from "./provisioner.js";
import { parseAndValidateTeam } from "./team-import.js";
import { createFlowDefinition, listFlowDefinitions } from "./repositories/flow-repository.js";
import { isRuntimeRunning } from "../lib/platform.js";
import { logger } from "../lib/logger.js";
import { constants } from "../lib/constants.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reserved slug for the system instance. Uses `cp-` prefix to avoid conflicts. */
export const SYSTEM_INSTANCE_SLUG = "cp-system";
export const SYSTEM_INSTANCE_DISPLAY_NAME = "System";
export const SYSTEM_AGENT_ID = "system-pilot";
export const SYSTEM_AGENT_NAME = "System Pilot";

// Resolve templates/system/ relative to this file.
// In dev: src/core/ → ../../templates/system = templates/system ✓
// In prod: dist/ → ../templates/system = templates/system ✓
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_TEMPLATE_DIR = path.join(__dirname, "../templates/system");
const CP_SYSTEM_TEMPLATE_HASH_KEY = "cp_system_template_hash";
const CP_SYSTEM_SHARED_TEMPLATE_FILES_KEY = "cp_system_shared_template_files";
const WORKSPACE_DIR = path.join(SYSTEM_TEMPLATE_DIR, "workspace");
const SHARED_TEMPLATE_DIR = path.join(WORKSPACE_DIR, constants.SHARED_WORKSPACE_DIR);

// ---------------------------------------------------------------------------
// SystemInstanceService
// ---------------------------------------------------------------------------

export class SystemInstanceService {
  /** Check if the system instance is provisioned. */
  static isProvisioned(registry: Registry): boolean {
    return registry.getSystemInstance() !== undefined;
  }

  /** Return the system instance record, or undefined. */
  static get(registry: Registry): InstanceRecord | undefined {
    return registry.getSystemInstance();
  }

  /**
   * Idempotent: provision the system instance if it does not exist.
   * Uses templates/system/cp-system.team.yaml for agent config
   * and templates/system/cp-system.flows.json for flow definitions.
   * Requires at least one named API key.
   */
  static async ensureProvisioned(
    registry: Registry,
    conn: ServerConnection,
    db: Database.Database,
    namedKeyId: number,
  ): Promise<InstanceRecord> {
    // 1. Already provisioned?
    const existing = registry.getSystemInstance();
    if (existing) {
      // Ensure flows are provisioned (idempotent)
      await SystemInstanceService._provisionFlows(db, SYSTEM_INSTANCE_SLUG);
      // Re-sync workspace files if the YAML template changed (e.g. after code deploy)
      await SystemInstanceService._syncTemplateIfChanged(db, conn, existing, registry);
      return existing;
    }

    // 2. Resolve named key details
    const namedKeyRepo = new NamedKeyRepository(db);
    const key = namedKeyRepo.getById(namedKeyId);
    if (!key) throw new Error(`Named API key not found: ${namedKeyId}`);

    let apiKey: string;
    try {
      apiKey = namedKeyRepo.decryptApiKey(namedKeyId);
    } catch (err) {
      throw new Error(`Cannot decrypt API key ${namedKeyId}: ${String(err)}`);
    }

    // 3. Load team YAML from templates
    const teamFile = await SystemInstanceService._loadTeamFile();

    // 4. Provision via standard provisioner with blueprintTeamFile
    const serverId = registry.getLocalServer()?.id;
    if (serverId === undefined) throw new Error("No local server registered");

    const provisioner = new Provisioner(conn, registry);
    await provisioner.provision(
      {
        slug: SYSTEM_INSTANCE_SLUG,
        displayName: SYSTEM_INSTANCE_DISPLAY_NAME,
        agents: [
          {
            id: SYSTEM_AGENT_ID,
            name: SYSTEM_AGENT_NAME,
            isDefault: true,
          },
        ],
        defaultModel: key.defaultModel,
        provider: key.providerId,
        apiKey,
        telegram: { enabled: false },
        mem0: { enabled: false },
        blueprintTeamFile: teamFile,
      },
      serverId,
    );

    // 5. Mark as system instance
    db.prepare("UPDATE instances SET is_system = 1 WHERE slug = ?").run(SYSTEM_INSTANCE_SLUG);

    // 6. Assign named key as default
    db.prepare("UPDATE instances SET default_named_key_id = ? WHERE slug = ?").run(
      namedKeyId,
      SYSTEM_INSTANCE_SLUG,
    );

    // 7. Provision flow definitions
    await SystemInstanceService._provisionFlows(db, SYSTEM_INSTANCE_SLUG);

    logger.info(`[system-instance] Provisioned ${SYSTEM_INSTANCE_SLUG} with key "${key.name}"`);

    return registry.getInstance(SYSTEM_INSTANCE_SLUG)!;
  }

  /**
   * Ensure the system instance is running. If provisioned but stopped, start it.
   * Also re-syncs the YAML template (workspace files + agent configs) if it has
   * changed since last startup — so a redeploy updates cp-system without the user
   * having to visit the dashboard.
   *
   * No-op if not provisioned.
   */
  static async ensureRunning(
    registry: Registry,
    lifecycle: Lifecycle,
    db: Database.Database,
    conn: ServerConnection,
  ): Promise<void> {
    const instance = registry.getSystemInstance();
    if (!instance) return;

    // Re-sync template on every startup — cheap (hash compare) and ensures
    // redeploys propagate to the existing system instance.
    try {
      await SystemInstanceService._syncTemplateIfChanged(db, conn, instance, registry);
    } catch (err) {
      logger.warn("[system-instance] Template sync on startup failed", { error: String(err) });
    }

    if (isRuntimeRunning(instance.state_dir)) return;

    try {
      await lifecycle.start(SYSTEM_INSTANCE_SLUG);
      logger.info("[system-instance] Auto-started cp-system");
    } catch (err) {
      logger.warn("[system-instance] Failed to auto-start cp-system", { error: String(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compare the template hash (YAML + external workspace files) with the stored hash.
   * If different, re-sync workspace files to disk + DB and agent configs.
   * Preserves USER.md, memory files, and per-agent metadata (role/tags/notes/position).
   */
  private static async _syncTemplateIfChanged(
    db: Database.Database,
    conn: ServerConnection,
    instance: InstanceRecord,
    registry: Registry,
  ): Promise<void> {
    const yamlPath = path.join(SYSTEM_TEMPLATE_DIR, "cp-system.team.yaml");
    let yamlContent: string;
    try {
      yamlContent = await fs.readFile(yamlPath, "utf-8");
    } catch (err) {
      logger.debug("[system-instance] Cannot read team YAML for sync check", {
        error: String(err),
      });
      return;
    }

    // Parse the YAML first — we need agent IDs to load external workspace files
    const result = parseAndValidateTeam(yamlContent);
    if (!result.success) {
      logger.warn("[system-instance] Template changed but YAML is invalid, skipping sync", {
        error: String(result.error),
      });
      return;
    }
    const team = result.data;

    // Build a combined hash: YAML content + all external per-agent workspace files
    // + all shared workspace files (sorted for stability).
    const hashInput = createHash("sha256").update(yamlContent);
    for (const agent of team.agents) {
      const externalFiles = await SystemInstanceService._loadWorkspaceFiles(agent.id);
      const sortedKeys = Object.keys(externalFiles).sort();
      for (const key of sortedKeys) {
        hashInput.update(key).update(externalFiles[key] ?? "");
      }
      // Merge external files into agent (YAML takes priority)
      if (Object.keys(externalFiles).length > 0) {
        agent.files = { ...externalFiles, ...agent.files };
      }
    }
    const sharedFiles = await SystemInstanceService._loadSharedWorkspaceFiles();
    const sortedSharedKeys = Object.keys(sharedFiles).sort();
    for (const key of sortedSharedKeys) {
      hashInput
        .update("@shared/")
        .update(key)
        .update(sharedFiles[key] ?? "");
    }
    const currentHash = hashInput.digest("hex");

    const storedHash = db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(CP_SYSTEM_TEMPLATE_HASH_KEY) as { value: string } | undefined;

    if (storedHash?.value === currentHash) return; // No change

    // Re-sync workspace files AND agent config_json. Creates new agents introduced
    // by the YAML via upsert; existing agents absent from the YAML are NOT deleted
    // nor archived (their sessions + history are preserved).
    const { filesUpdated, configsUpdated, agentsCreated } = await SystemInstanceService._syncAgents(
      db,
      conn,
      instance,
      team.agents,
      registry,
    );

    // Re-sync agent_links from YAML. `replaceAgentLinks` wipes all links for the
    // instance and re-inserts only those declared in the YAML, so removing an
    // agent from the YAML also removes its spawn/a2a links (even though the
    // agent row itself remains).
    registry.replaceAgentLinks(
      instance.id,
      team.links.map((l) => ({
        sourceAgentId: l.source,
        targetAgentId: l.target,
        linkType: l.type,
      })),
    );

    // Re-sync shared workspace (templates/system/workspace/shared/** → <stateDir>/workspaces/shared/).
    const sharedStats = await SystemInstanceService._syncSharedWorkspace(
      db,
      conn,
      instance,
      sharedFiles,
    );

    // Store new hash
    db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(CP_SYSTEM_TEMPLATE_HASH_KEY, currentHash);

    logger.info(
      `[system-instance] Template re-synced: ${agentsCreated} agents created, ` +
        `${configsUpdated} configs updated, ${filesUpdated} agent files written, ` +
        `${sharedStats.written} shared written, ${sharedStats.deleted} shared deleted, ` +
        `${team.links.length} links`,
    );
  }

  /**
   * Sync shared workspace files from `templates/system/workspace/shared/` to the
   * instance's `<stateDir>/workspaces/shared/` directory and the
   * `instance_shared_files` table.
   *
   * Only template-owned files are managed: a prior list is kept in the `config`
   * table under `cp_system_shared_template_files`. Files that the template no
   * longer owns are removed. User-created shared files (via `ws_write_shared_file`)
   * are NOT touched.
   */
  private static async _syncSharedWorkspace(
    db: Database.Database,
    conn: ServerConnection,
    instance: InstanceRecord,
    sharedFiles: Record<string, string>,
  ): Promise<{ written: number; deleted: number }> {
    const sharedDir = path.join(instance.state_dir, "workspaces", constants.SHARED_WORKSPACE_DIR);
    await conn.mkdir(sharedDir);

    // Load the previous list of template-owned filenames.
    const prevRow = db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(CP_SYSTEM_SHARED_TEMPLATE_FILES_KEY) as { value: string } | undefined;
    let prevOwned: string[] = [];
    if (prevRow?.value) {
      try {
        prevOwned = JSON.parse(prevRow.value) as string[];
      } catch (err) {
        logger.warn("[system-instance] Cannot parse previous shared template file list", {
          error: String(err),
        });
      }
    }
    const prevOwnedSet = new Set(prevOwned);
    const currentOwned = Object.keys(sharedFiles);
    const currentOwnedSet = new Set(currentOwned);

    let written = 0;
    let deleted = 0;

    // Write / upsert current template-owned files.
    for (const [relPath, content] of Object.entries(sharedFiles)) {
      const filePath = path.join(sharedDir, relPath);
      await conn.mkdir(path.dirname(filePath));
      await conn.writeFile(filePath, content);
      const contentHash = createHash("sha256").update(content).digest("hex");
      db.prepare(
        `INSERT INTO instance_shared_files (instance_id, filename, content, content_hash, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT (instance_id, filename) DO UPDATE SET
           content = excluded.content,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      ).run(instance.id, relPath, content, contentHash);
      written++;
    }

    // Delete files that were previously template-owned but no longer are.
    for (const relPath of prevOwnedSet) {
      if (currentOwnedSet.has(relPath)) continue;
      const filePath = path.join(sharedDir, relPath);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        logger.debug("[system-instance] Cannot unlink stale shared file", {
          filePath,
          error: String(err),
        });
      }
      db.prepare("DELETE FROM instance_shared_files WHERE instance_id = ? AND filename = ?").run(
        instance.id,
        relPath,
      );
      deleted++;
    }

    // Store current owned list for next sync.
    db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(CP_SYSTEM_SHARED_TEMPLATE_FILES_KEY, JSON.stringify(currentOwned.sort()));

    return { written, deleted };
  }

  /**
   * Load shared workspace files from `templates/system/workspace/shared/`.
   * Recursively reads all .md files and returns `{ relativePath: content }`.
   */
  private static async _loadSharedWorkspaceFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};

    async function scanDir(dir: string): Promise<void> {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        logger.debug("[system-instance] No shared workspace dir", {
          dir,
          error: String(err),
        });
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const relPath = path.relative(SHARED_TEMPLATE_DIR, fullPath);
          files[relPath] = await fs.readFile(fullPath, "utf-8");
        }
      }
    }

    await scanDir(SHARED_TEMPLATE_DIR);
    return files;
  }

  /**
   * Sync agent configs and workspace files to disk + DB.
   * Uses `registry.upsertAgent` to create new agents introduced by the YAML and
   * update existing ones; returns counts of creations / updates / files written.
   */
  private static async _syncAgents(
    db: Database.Database,
    conn: ServerConnection,
    instance: InstanceRecord,
    agents: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly is_default: boolean;
      readonly config?: Record<string, unknown> | undefined;
      readonly files?: Record<string, string> | undefined;
    }>,
    registry: Registry,
  ): Promise<{ filesUpdated: number; configsUpdated: number; agentsCreated: number }> {
    let filesUpdated = 0;
    let configsUpdated = 0;
    let agentsCreated = 0;

    // Resolve the instance's default model once — used as fallback when an
    // agent's YAML block doesn't specify one. `parseAgentConfig` requires
    // `model` to be a non-empty string; omitting it would cause the stored
    // config_json to fail re-parse and fall back to a minimal-defaulted
    // config (toolProfile "executor", no archetype, etc.).
    let instanceDefaultModel: string | undefined;
    try {
      const row = db
        .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
        .get(instance.id) as { default_named_key_id: number | null } | undefined;
      if (row?.default_named_key_id != null) {
        const keyRepo = new NamedKeyRepository(db);
        const key = keyRepo.getById(row.default_named_key_id);
        instanceDefaultModel = key?.defaultModel ?? undefined;
      }
    } catch (err) {
      logger.debug("[system-instance] Cannot read instance default model", {
        error: String(err),
      });
    }

    for (const agent of agents) {
      // Resolve workspace path + upsert agent row (creates if missing).
      const workspacePath = path.join(instance.state_dir, "workspaces", agent.id);
      const preExisting = registry.getAgentByAgentId(instance.id, agent.id);

      const extractedModel =
        agent.config && typeof (agent.config as { model?: unknown }).model === "string"
          ? (agent.config as { model: string }).model
          : undefined;

      // Pick a model for the stored config_json. Precedence:
      // 1. Explicit `config.model` in the YAML (rare — we usually rely on defaults).
      // 2. The pre-existing agent's model (re-sync case: don't drop what's there).
      // 3. The instance default model derived from its named API key.
      // 4. A safe fallback so parseAgentConfig doesn't fail.
      const effectiveModel =
        extractedModel ??
        preExisting?.model ??
        instanceDefaultModel ??
        "anthropic/claude-sonnet-4-5";

      const configJson = agent.config
        ? JSON.stringify({
            id: agent.id,
            name: agent.name,
            model: effectiveModel,
            isDefault: agent.is_default,
            ...agent.config,
          })
        : null;

      registry.upsertAgent(instance.id, {
        agentId: agent.id,
        name: agent.name,
        model: effectiveModel,
        workspacePath,
        isDefault: agent.is_default,
        configJson,
      });

      if (!preExisting) agentsCreated++;
      else if (configJson) configsUpdated++;

      // Sync workspace files (YAML-defined + external, already merged).
      if (!agent.files) continue;
      await conn.mkdir(workspacePath);

      const agentRecord = db
        .prepare(
          "SELECT a.id FROM agents a JOIN instances i ON a.instance_id = i.id WHERE i.slug = ? AND a.agent_id = ?",
        )
        .get(SYSTEM_INSTANCE_SLUG, agent.id) as { id: number } | undefined;

      for (const [filename, content] of Object.entries(agent.files)) {
        const filePath = path.join(workspacePath, filename);
        await conn.mkdir(path.dirname(filePath));
        await conn.writeFile(filePath, content);
        filesUpdated++;

        if (agentRecord) {
          const contentHash = createHash("sha256").update(content).digest("hex");
          db.prepare(
            `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT (agent_id, filename) DO UPDATE SET
               content = excluded.content,
               content_hash = excluded.content_hash,
               updated_at = excluded.updated_at`,
          ).run(agentRecord.id, filename, content, contentHash);
        }
      }
    }

    return { filesUpdated, configsUpdated, agentsCreated };
  }

  /** Load and parse the system team YAML from templates, merging external workspace files. */
  private static async _loadTeamFile() {
    const yamlPath = path.join(SYSTEM_TEMPLATE_DIR, "cp-system.team.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    const result = parseAndValidateTeam(yamlContent);
    if (!result.success) {
      const detail =
        result.error.message ??
        result.error.details?.map((d) => `${d.path}: ${d.message}`).join("; ") ??
        result.error.error;
      throw new Error(`Invalid cp-system.team.yaml: ${detail}`);
    }
    const team = result.data;

    // Merge external workspace files into each agent's files map.
    // YAML-defined files take priority over external files on name conflict.
    for (const agent of team.agents) {
      const externalFiles = await SystemInstanceService._loadWorkspaceFiles(agent.id);
      if (Object.keys(externalFiles).length === 0) continue;
      agent.files = { ...externalFiles, ...agent.files };
    }

    return team;
  }

  /**
   * Load external workspace files for an agent from templates/system/workspace/<agentId>/.
   * Recursively reads all .md files and returns { relativePath: content }.
   */
  private static async _loadWorkspaceFiles(agentId: string): Promise<Record<string, string>> {
    const agentDir = path.join(WORKSPACE_DIR, agentId);
    const files: Record<string, string> = {};

    async function scanDir(dir: string): Promise<void> {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        logger.debug("[system-instance] No workspace dir for agent", { dir, error: String(err) });
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const relPath = path.relative(agentDir, fullPath);
          files[relPath] = await fs.readFile(fullPath, "utf-8");
        }
      }
    }

    await scanDir(agentDir);
    return files;
  }

  /**
   * Load flow definitions from templates/system/cp-system.flows.json
   * and insert them into the database. Idempotent — skips flows that already exist.
   */
  private static async _provisionFlows(db: Database.Database, instanceSlug: string): Promise<void> {
    const flowsPath = path.join(SYSTEM_TEMPLATE_DIR, "cp-system.flows.json");
    let flowDefs: Array<{
      name: string;
      description?: string;
      steps: unknown[];
      trigger: unknown;
    }>;
    try {
      const raw = await fs.readFile(flowsPath, "utf-8");
      flowDefs = JSON.parse(raw) as typeof flowDefs;
    } catch (err) {
      logger.warn("[system-instance] Failed to load flows template", { error: String(err) });
      return;
    }

    const existingFlows = listFlowDefinitions(db, instanceSlug);
    const existingNames = new Set(existingFlows.map((f) => f.name));

    for (const def of flowDefs) {
      if (existingNames.has(def.name)) continue;

      createFlowDefinition(db, {
        instanceSlug,
        name: def.name,
        ...(def.description !== undefined ? { description: def.description } : {}),
        stepsJson: JSON.stringify(def.steps),
        triggerJson: JSON.stringify(def.trigger),
      });
      logger.debug(`[system-instance] Provisioned flow "${def.name}" for ${instanceSlug}`);
    }
  }
}
