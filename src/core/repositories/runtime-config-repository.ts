// src/core/repositories/runtime-config-repository.ts
//
// Read/write RuntimeConfig from the `instances.runtime_config_json` column.
// Single source of truth for all instance configuration (v21+).

import type Database from "better-sqlite3";
import type { RuntimeConfig } from "../../runtime/config/index.js";
import { parseRuntimeConfig } from "../../runtime/config/index.js";
import { now } from "../../lib/date.js";
import { logger } from "../../lib/logger.js";

export class RuntimeConfigRepository {
  constructor(private db: Database.Database) {}

  /**
   * Read and parse the RuntimeConfig for the given instance slug.
   * Returns null if the instance does not exist or has no stored config.
   */
  getRuntimeConfig(slug: string): RuntimeConfig | null {
    const row = this.db
      .prepare("SELECT runtime_config_json FROM instances WHERE slug = ?")
      .get(slug) as { runtime_config_json: string | null } | undefined;

    if (!row?.runtime_config_json) return null;

    try {
      const raw = JSON.parse(row.runtime_config_json) as unknown;
      return parseRuntimeConfig(raw);
    } catch (err) {
      logger.warn(`[runtime-config-repo] Failed to parse runtime_config_json for ${slug}: ${err}`);
      return null;
    }
  }

  /**
   * Overwrite the RuntimeConfig for an instance.
   * Also updates the denormalized `agents.config_json` for each agent in the config.
   */
  saveRuntimeConfig(slug: string, config: RuntimeConfig): void {
    const tx = this.db.transaction(() => {
      // 1. Store the full config blob on the instances row
      this.db
        .prepare("UPDATE instances SET runtime_config_json = ?, updated_at = ? WHERE slug = ?")
        .run(JSON.stringify(config), now(), slug);

      // 2. Sync denormalized agents.config_json
      this._syncAgentConfigJson(slug, config);
    });
    tx();
  }

  /**
   * Atomic read-modify-write: loads the current config, applies the transform
   * function, saves the result, and returns the updated config.
   * Runs inside a single SQLite transaction for atomicity.
   * Throws if the instance has no stored config.
   */
  patchRuntimeConfig(slug: string, fn: (config: RuntimeConfig) => RuntimeConfig): RuntimeConfig {
    let result!: RuntimeConfig;

    const tx = this.db.transaction(() => {
      // 1. Read current config
      const row = this.db
        .prepare("SELECT runtime_config_json FROM instances WHERE slug = ?")
        .get(slug) as { runtime_config_json: string | null } | undefined;

      if (!row?.runtime_config_json) {
        throw new Error(
          `No runtime config found in DB for instance "${slug}". ` +
            `Ensure the instance has been provisioned or migrated to v21+.`,
        );
      }

      const current = parseRuntimeConfig(JSON.parse(row.runtime_config_json) as unknown);

      // 2. Apply the transform
      result = fn(current);

      // 3. Write back
      this.db
        .prepare("UPDATE instances SET runtime_config_json = ?, updated_at = ? WHERE slug = ?")
        .run(JSON.stringify(result), now(), slug);

      // 4. Sync denormalized agents.config_json
      this._syncAgentConfigJson(slug, result);
    });
    tx();

    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Sync `agents.config_json` for each agent defined in the RuntimeConfig.
   * Must be called within an existing transaction.
   */
  private _syncAgentConfigJson(slug: string, config: RuntimeConfig): void {
    // Resolve instance id
    const inst = this.db.prepare("SELECT id FROM instances WHERE slug = ?").get(slug) as
      | { id: number }
      | undefined;
    if (!inst) return;

    const upsert = this.db.prepare(`
      UPDATE agents
      SET config_json = ?, name = ?, model = ?, is_default = ?
      WHERE instance_id = ? AND agent_id = ?
    `);

    for (const agent of config.agents) {
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
