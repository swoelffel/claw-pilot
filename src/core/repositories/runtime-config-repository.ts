// src/core/repositories/runtime-config-repository.ts
//
// Read/write RuntimeConfig from DB.
// Since this refactoring, agents.config_json is the source of truth for agent
// configs. instances.runtime_config_json stores only global config. On read,
// getRuntimeConfig() reconstructs config.agents[] from the agents table.

import type Database from "better-sqlite3";
import type { RuntimeConfig, RuntimeAgentConfig } from "../../runtime/config/index.js";
import { parseRuntimeConfig, parseAgentConfig } from "../../runtime/config/index.js";
import { now } from "../../lib/date.js";
import { logger } from "../../lib/logger.js";

export class RuntimeConfigRepository {
  constructor(private db: Database.Database) {}

  /**
   * Read and parse the RuntimeConfig for the given instance slug.
   * Reconstructs config.agents[] from the agents table (source of truth).
   * Returns null if the instance does not exist or has no stored config.
   */
  getRuntimeConfig(slug: string): RuntimeConfig | null {
    const row = this.db
      .prepare("SELECT id, runtime_config_json FROM instances WHERE slug = ?")
      .get(slug) as { id: number; runtime_config_json: string | null } | undefined;

    if (!row?.runtime_config_json) return null;

    try {
      const raw = JSON.parse(row.runtime_config_json) as unknown;
      const config = parseRuntimeConfig(raw);

      // Reconstruct agents[] from the agents table (source of truth)
      config.agents = this._loadAgentConfigs(row.id);

      return config;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[runtime-config-repo] Failed to parse runtime_config_json for ${slug}: ${msg}`);
      return null;
    }
  }

  /**
   * Overwrite the RuntimeConfig for an instance.
   * Writes global config to instances.runtime_config_json (dual-write: keeps
   * agents[] in the blob for rollback compatibility).
   * Writes each agent config to agents.config_json (source of truth).
   */
  saveRuntimeConfig(slug: string, config: RuntimeConfig): void {
    const tx = this.db.transaction(() => {
      // 1. Store full config blob (dual-write — agents[] kept for rollback)
      this.db
        .prepare("UPDATE instances SET runtime_config_json = ?, updated_at = ? WHERE slug = ?")
        .run(JSON.stringify(config), now(), slug);

      // 2. Write each agent's config to agents.config_json (source of truth)
      this._writeAgentConfigs(slug, config.agents);
    });
    tx();
  }

  /**
   * Atomic read-modify-write: loads the current config (with agents
   * reconstructed from the agents table), applies the transform function,
   * saves the result, and returns the updated config.
   * Runs inside a single SQLite transaction for atomicity.
   * Throws if the instance has no stored config.
   */
  patchRuntimeConfig(slug: string, fn: (config: RuntimeConfig) => RuntimeConfig): RuntimeConfig {
    let result!: RuntimeConfig;

    const tx = this.db.transaction(() => {
      // 1. Read current config (global from blob, agents from table)
      const row = this.db
        .prepare("SELECT id, runtime_config_json FROM instances WHERE slug = ?")
        .get(slug) as { id: number; runtime_config_json: string | null } | undefined;

      if (!row?.runtime_config_json) {
        throw new Error(
          `No runtime config found in DB for instance "${slug}". ` +
            `Ensure the instance has been provisioned or migrated to v21+.`,
        );
      }

      const current = parseRuntimeConfig(JSON.parse(row.runtime_config_json) as unknown);
      current.agents = this._loadAgentConfigs(row.id);

      // 2. Apply the transform
      result = fn(current);

      // 3. Write global config back (dual-write — agents[] kept for rollback)
      this.db
        .prepare("UPDATE instances SET runtime_config_json = ?, updated_at = ? WHERE slug = ?")
        .run(JSON.stringify(result), now(), slug);

      // 4. Detect and write agent config changes
      this._writeAgentConfigs(slug, result.agents);
    });
    tx();

    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Load agent configs from the agents table for the given instance.
   * This is the source of truth for agent runtime configuration.
   */
  private _loadAgentConfigs(instanceId: number): RuntimeAgentConfig[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id, name, model, is_default, config_json
         FROM agents
         WHERE instance_id = ?
         ORDER BY is_default DESC, agent_id ASC`,
      )
      .all(instanceId) as Array<{
      agent_id: string;
      name: string;
      model: string | null;
      is_default: number;
      config_json: string | null;
    }>;

    const configs: RuntimeAgentConfig[] = [];
    for (const row of rows) {
      if (row.config_json) {
        try {
          configs.push(parseAgentConfig(JSON.parse(row.config_json) as unknown));
          continue;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          logger.warn(
            `[runtime-config-repo] Invalid config_json for agent "${row.agent_id}", using fallback: ${detail}`,
          );
        }
      }
      // Fallback: build minimal config from columns (pre-v20 rows)
      configs.push(
        parseAgentConfig({
          id: row.agent_id,
          name: row.name,
          model: row.model ?? "anthropic/claude-sonnet-4-5",
          isDefault: row.is_default === 1,
        }),
      );
    }
    return configs;
  }

  /**
   * Write agent configs to agents.config_json (source of truth).
   * Updates existing rows and syncs denormalized columns (name, model, is_default).
   */
  private _writeAgentConfigs(slug: string, agents: RuntimeAgentConfig[]): void {
    const inst = this.db.prepare("SELECT id FROM instances WHERE slug = ?").get(slug) as
      | { id: number }
      | undefined;
    if (!inst) return;

    const upsert = this.db.prepare(`
      UPDATE agents
      SET config_json = ?, name = ?, model = ?, is_default = ?
      WHERE instance_id = ? AND agent_id = ?
    `);

    for (const agent of agents) {
      upsert.run(
        JSON.stringify(agent),
        agent.name,
        agent.model,
        agent.isDefault ? 1 : 0,
        inst.id,
        agent.id,
      );
    }
  }
}
