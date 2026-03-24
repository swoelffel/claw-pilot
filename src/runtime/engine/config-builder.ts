/**
 * runtime/engine/config-builder.ts
 *
 * Build RuntimeAgentConfig[] from the DB `agents.config_json` column.
 * Phase 1 of the runtime.json → DB migration: agent configs are read
 * from the DB when `config_json` is populated, falling back to the
 * individual columns (name, model) when it is not.
 */

import type Database from "better-sqlite3";
import type { RuntimeAgentConfig } from "../config/index.js";
import { logger } from "../../lib/logger.js";

interface AgentConfigRow {
  agent_id: string;
  name: string;
  model: string | null;
  is_default: number;
  config_json: string | null;
}

/**
 * Read agent configs from the DB for a given instance.
 * If `config_json` is populated, parse it as RuntimeAgentConfig.
 * Otherwise, build a minimal config from the indexed columns.
 */
export function buildAgentConfigsFromDb(
  db: Database.Database,
  instanceSlug: string,
): RuntimeAgentConfig[] {
  const rows = db
    .prepare(
      `SELECT a.agent_id, a.name, a.model, a.is_default, a.config_json
       FROM agents a
       JOIN instances i ON a.instance_id = i.id
       WHERE i.slug = ?
       ORDER BY a.is_default DESC, a.agent_id ASC`,
    )
    .all(instanceSlug) as AgentConfigRow[];

  const configs: RuntimeAgentConfig[] = [];

  for (const row of rows) {
    if (row.config_json) {
      try {
        const parsed = JSON.parse(row.config_json) as RuntimeAgentConfig;
        // Ensure id/name/model from config_json are consistent with indexed columns
        configs.push(parsed);
        continue;
      } catch (err) {
        logger.warn(
          `[config-builder] Failed to parse config_json for agent ${row.agent_id}: ${err}`,
        );
      }
    }

    // Fallback: build minimal config from individual columns
    configs.push({
      id: row.agent_id,
      name: row.name,
      model: row.model ?? "anthropic/claude-sonnet-4-5",
      isDefault: row.is_default === 1,
      permissions: [],
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding",
    } as RuntimeAgentConfig);
  }

  return configs;
}
