// src/core/repositories/agent-blueprint-repository.ts
//
// CRUD operations for agent_blueprints + agent_blueprint_files tables.
// Agent blueprints are standalone reusable agent templates (not tied to
// instances or team blueprints).

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import type { AgentBlueprintRecord, AgentBlueprintFileRecord } from "../registry-types.js";
import { now } from "../../lib/date.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AgentBlueprintRepository {
  constructor(private db: Database.Database) {}

  // --- Agent Blueprints ---

  /** List all agent blueprints with file count. */
  listAgentBlueprints(): AgentBlueprintRecord[] {
    return this.db
      .prepare(
        `
        SELECT ab.*, COUNT(abf.id) as file_count
        FROM agent_blueprints ab
        LEFT JOIN agent_blueprint_files abf ON abf.agent_blueprint_id = ab.id
        GROUP BY ab.id
        ORDER BY ab.name ASC
      `,
      )
      .all() as AgentBlueprintRecord[];
  }

  /** Get a single agent blueprint by ID. */
  getAgentBlueprint(id: string): AgentBlueprintRecord | undefined {
    return this.db.prepare("SELECT * FROM agent_blueprints WHERE id = ?").get(id) as
      | AgentBlueprintRecord
      | undefined;
  }

  /** Create a new agent blueprint. Returns the created record. */
  createAgentBlueprint(data: {
    name: string;
    description?: string;
    category?: "user" | "tool" | "system";
    configJson?: string;
    icon?: string;
    tags?: string;
  }): AgentBlueprintRecord {
    const id = nanoid();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO agent_blueprints (id, name, description, category, config_json, icon, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.name,
        data.description ?? null,
        data.category ?? "user",
        data.configJson ?? "{}",
        data.icon ?? null,
        data.tags ?? null,
        ts,
        ts,
      );
    return this.getAgentBlueprint(id)!;
  }

  /** Update an agent blueprint. Only provided fields are modified. */
  updateAgentBlueprint(
    id: string,
    fields: Partial<{
      name: string;
      description: string | null;
      category: "user" | "tool" | "system";
      configJson: string;
      icon: string | null;
      tags: string | null;
    }>,
  ): AgentBlueprintRecord | undefined {
    const sets: string[] = [];
    const values: unknown[] = [];

    if ("name" in fields) {
      sets.push("name = ?");
      values.push(fields.name);
    }
    if ("description" in fields) {
      sets.push("description = ?");
      values.push(fields.description ?? null);
    }
    if ("category" in fields) {
      sets.push("category = ?");
      values.push(fields.category);
    }
    if ("configJson" in fields) {
      sets.push("config_json = ?");
      values.push(fields.configJson);
    }
    if ("icon" in fields) {
      sets.push("icon = ?");
      values.push(fields.icon ?? null);
    }
    if ("tags" in fields) {
      sets.push("tags = ?");
      values.push(fields.tags ?? null);
    }

    if (sets.length === 0) return this.getAgentBlueprint(id);

    sets.push("updated_at = ?");
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE agent_blueprints SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getAgentBlueprint(id);
  }

  /** Delete an agent blueprint and its files (CASCADE). */
  deleteAgentBlueprint(id: string): void {
    this.db.prepare("DELETE FROM agent_blueprints WHERE id = ?").run(id);
  }

  // --- Agent Blueprint Files ---

  /** List all files for an agent blueprint. */
  listAgentBlueprintFiles(blueprintId: string): AgentBlueprintFileRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM agent_blueprint_files WHERE agent_blueprint_id = ? ORDER BY filename ASC",
      )
      .all(blueprintId) as AgentBlueprintFileRecord[];
  }

  /** Get a single file by blueprint ID and filename. */
  getAgentBlueprintFile(
    blueprintId: string,
    filename: string,
  ): AgentBlueprintFileRecord | undefined {
    return this.db
      .prepare("SELECT * FROM agent_blueprint_files WHERE agent_blueprint_id = ? AND filename = ?")
      .get(blueprintId, filename) as AgentBlueprintFileRecord | undefined;
  }

  /** Upsert a file for an agent blueprint. Creates or updates. */
  upsertAgentBlueprintFile(blueprintId: string, filename: string, content: string): void {
    const hash = contentHash(content);
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO agent_blueprint_files (agent_blueprint_id, filename, content, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_blueprint_id, filename)
         DO UPDATE SET content = excluded.content, content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
      )
      .run(blueprintId, filename, content, hash, ts);
  }

  /** Delete a single file from an agent blueprint. */
  deleteAgentBlueprintFile(blueprintId: string, filename: string): void {
    this.db
      .prepare("DELETE FROM agent_blueprint_files WHERE agent_blueprint_id = ? AND filename = ?")
      .run(blueprintId, filename);
  }

  // --- Clone ---

  /**
   * Clone an agent blueprint (deep copy: metadata + all files).
   * Returns the newly created blueprint.
   */
  cloneAgentBlueprint(sourceId: string, newName?: string): AgentBlueprintRecord | undefined {
    const source = this.getAgentBlueprint(sourceId);
    if (!source) return undefined;

    const clonedName = newName ?? `${source.name} (copy)`;
    const clone = this.createAgentBlueprint({
      name: clonedName,
      ...(source.description !== null ? { description: source.description } : {}),
      category: source.category,
      configJson: source.config_json,
      ...(source.icon !== null ? { icon: source.icon } : {}),
      ...(source.tags !== null ? { tags: source.tags } : {}),
    });

    // Copy all files
    const files = this.listAgentBlueprintFiles(sourceId);
    for (const file of files) {
      this.upsertAgentBlueprintFile(clone.id, file.filename, file.content);
    }

    return this.getAgentBlueprint(clone.id);
  }
}
