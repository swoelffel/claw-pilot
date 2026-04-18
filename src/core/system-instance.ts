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
const WORKSPACE_DIR = path.join(SYSTEM_TEMPLATE_DIR, "workspace");

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
      await SystemInstanceService._syncTemplateIfChanged(db, conn, existing);
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
      await SystemInstanceService._syncTemplateIfChanged(db, conn, instance);
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

    // Build a combined hash: YAML content + all external workspace files (sorted for stability)
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
    const currentHash = hashInput.digest("hex");

    const storedHash = db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(CP_SYSTEM_TEMPLATE_HASH_KEY) as { value: string } | undefined;

    if (storedHash?.value === currentHash) return; // No change

    // Re-sync workspace files AND agent config_json.
    const { filesUpdated, configsUpdated } = await SystemInstanceService._syncAgents(
      db,
      conn,
      instance.state_dir,
      team.agents,
    );

    // Store new hash
    db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(CP_SYSTEM_TEMPLATE_HASH_KEY, currentHash);

    logger.info(
      `[system-instance] Template re-synced: ${filesUpdated} files, ${configsUpdated} configs updated`,
    );
  }

  /** Sync agent configs and workspace files to disk + DB. */
  private static async _syncAgents(
    db: Database.Database,
    conn: ServerConnection,
    stateDir: string,
    agents: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly is_default: boolean;
      readonly config?: Record<string, unknown> | undefined;
      readonly files?: Record<string, string> | undefined;
    }>,
  ): Promise<{ filesUpdated: number; configsUpdated: number }> {
    let filesUpdated = 0;
    let configsUpdated = 0;

    for (const agent of agents) {
      // 1. Sync config_json from YAML
      if (agent.config) {
        const configJson = JSON.stringify({
          id: agent.id,
          name: agent.name,
          isDefault: agent.is_default,
          ...agent.config,
        });
        const dbResult = db
          .prepare(
            `UPDATE agents SET config_json = ?
             WHERE agent_id = ? AND instance_id IN (SELECT id FROM instances WHERE slug = ?)`,
          )
          .run(configJson, agent.id, SYSTEM_INSTANCE_SLUG);
        if (dbResult.changes > 0) configsUpdated++;
      }

      // 2. Sync workspace files (YAML-defined + external, already merged)
      if (!agent.files) continue;
      const workspacePath = path.join(stateDir, "workspaces", agent.id);
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

    return { filesUpdated, configsUpdated };
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
