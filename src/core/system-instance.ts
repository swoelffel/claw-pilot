// src/core/system-instance.ts
//
// Service for auto-provisioning and managing the system instance (cp-system).
// The system instance hosts the system-pilot agent and subagents used by the Home chatbot.
// Agent config comes from templates/system/cp-system.team.yaml (editable).
// Flow definitions come from templates/system/cp-system.flows.json (editable).

import * as path from "node:path";
import * as fs from "node:fs/promises";
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
    dashboardPort: number,
    dashboardToken: string,
  ): Promise<InstanceRecord> {
    // 1. Already provisioned?
    const existing = registry.getSystemInstance();
    if (existing) {
      // Sync dashboard credentials in case they changed
      await SystemInstanceService.syncDashboardToken(
        existing.state_dir,
        dashboardPort,
        dashboardToken,
      );
      // Ensure flows are provisioned (idempotent)
      await SystemInstanceService._provisionFlows(db, SYSTEM_INSTANCE_SLUG);
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
    const result = await provisioner.provision(
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

    // 7. Write dashboard credentials to .env
    await SystemInstanceService.syncDashboardToken(result.stateDir, dashboardPort, dashboardToken);

    // 8. Provision flow definitions
    await SystemInstanceService._provisionFlows(db, SYSTEM_INSTANCE_SLUG);

    logger.info(`[system-instance] Provisioned ${SYSTEM_INSTANCE_SLUG} with key "${key.name}"`);

    return registry.getInstance(SYSTEM_INSTANCE_SLUG)!;
  }

  /**
   * Ensure the system instance is running. If provisioned but stopped, start it.
   * No-op if not provisioned or already running.
   */
  static async ensureRunning(registry: Registry, lifecycle: Lifecycle): Promise<void> {
    const instance = registry.getSystemInstance();
    if (!instance) return;

    if (isRuntimeRunning(instance.state_dir)) return;

    try {
      await lifecycle.start(SYSTEM_INSTANCE_SLUG);
      logger.info("[system-instance] Auto-started cp-system");
    } catch (err) {
      logger.warn("[system-instance] Failed to auto-start cp-system", { error: String(err) });
    }
  }

  /**
   * Write/update CLAW_DASHBOARD_URL and CLAW_DASHBOARD_TOKEN in the system instance .env.
   * Appends if missing, replaces if present.
   */
  static async syncDashboardToken(
    stateDir: string,
    dashboardPort: number,
    dashboardToken: string,
  ): Promise<void> {
    const envPath = path.join(stateDir, ".env");
    let content: string;
    try {
      content = await fs.readFile(envPath, "utf-8");
    } catch (err) {
      logger.debug("[system-instance] .env not found, creating fresh", { error: String(err) });
      content = "";
    }

    const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    // Remove existing dashboard vars
    const filtered = lines.filter(
      (l) => !l.startsWith("CLAW_DASHBOARD_URL=") && !l.startsWith("CLAW_DASHBOARD_TOKEN="),
    );

    filtered.push(`CLAW_DASHBOARD_URL=${dashboardUrl}`);
    filtered.push(`CLAW_DASHBOARD_TOKEN=${dashboardToken}`);

    await fs.writeFile(envPath, filtered.join("\n") + "\n", { mode: 0o600 });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Load and parse the system team YAML from templates. */
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
    return result.data;
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
