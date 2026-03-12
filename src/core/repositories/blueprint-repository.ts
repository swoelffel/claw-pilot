// src/core/repositories/blueprint-repository.ts
import type Database from "better-sqlite3";
import type {
  BlueprintRecord,
  BlueprintAgentRecord,
  BlueprintLinkRecord,
} from "../registry-types.js";
import { now } from "../../lib/date.js";

export class BlueprintRepository {
  constructor(private db: Database.Database) {}

  // --- Blueprints ---

  listBlueprints(): BlueprintRecord[] {
    return this.db
      .prepare(
        `
      SELECT b.*, COUNT(a.id) as agent_count
      FROM blueprints b
      LEFT JOIN agents a ON a.blueprint_id = b.id
      GROUP BY b.id
      ORDER BY b.name ASC
    `,
      )
      .all() as BlueprintRecord[];
  }

  getBlueprint(id: number): BlueprintRecord | undefined {
    return this.db.prepare("SELECT * FROM blueprints WHERE id = ?").get(id) as
      | BlueprintRecord
      | undefined;
  }

  createBlueprint(data: {
    name: string;
    description?: string;
    icon?: string;
    tags?: string;
    color?: string;
  }): BlueprintRecord {
    const result = this.db
      .prepare(
        `INSERT INTO blueprints (name, description, icon, tags, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.description ?? null,
        data.icon ?? null,
        data.tags ?? null,
        data.color ?? null,
        now(),
        now(),
      );
    return this.getBlueprint(result.lastInsertRowid as number)!;
  }

  updateBlueprint(
    id: number,
    fields: Partial<{
      name: string;
      description: string | null;
      icon: string | null;
      tags: string | null;
      color: string | null;
    }>,
  ): BlueprintRecord | undefined {
    const sets: string[] = [];
    const values: unknown[] = [];

    if ("name" in fields) {
      sets.push("name=?");
      values.push(fields.name);
    }
    if ("description" in fields) {
      sets.push("description=?");
      values.push(fields.description ?? null);
    }
    if ("icon" in fields) {
      sets.push("icon=?");
      values.push(fields.icon ?? null);
    }
    if ("tags" in fields) {
      sets.push("tags=?");
      values.push(fields.tags ?? null);
    }
    if ("color" in fields) {
      sets.push("color=?");
      values.push(fields.color ?? null);
    }

    if (sets.length === 0) return this.getBlueprint(id);
    sets.push("updated_at=?");
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE blueprints SET ${sets.join(", ")} WHERE id=?`).run(...values);
    return this.getBlueprint(id);
  }

  deleteBlueprint(id: number): void {
    this.db.prepare("DELETE FROM blueprints WHERE id = ?").run(id);
  }

  // --- Blueprint Agents ---

  listBlueprintAgents(blueprintId: number): BlueprintAgentRecord[] {
    return this.db
      .prepare(`SELECT * FROM agents WHERE blueprint_id = ? ORDER BY is_default DESC, agent_id ASC`)
      .all(blueprintId) as BlueprintAgentRecord[];
  }

  getBlueprintAgent(blueprintId: number, agentId: string): BlueprintAgentRecord | undefined {
    return this.db
      .prepare("SELECT * FROM agents WHERE blueprint_id = ? AND agent_id = ?")
      .get(blueprintId, agentId) as BlueprintAgentRecord | undefined;
  }

  createBlueprintAgent(
    blueprintId: number,
    data: {
      agentId: string;
      name: string;
      model?: string;
      isDefault?: boolean;
    },
  ): BlueprintAgentRecord {
    const workspacePath = `blueprint://${blueprintId}/${data.agentId}`;
    this.db
      .prepare(
        `INSERT INTO agents (blueprint_id, agent_id, name, model, workspace_path, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        blueprintId,
        data.agentId,
        data.name,
        data.model ?? null,
        workspacePath,
        data.isDefault ? 1 : 0,
      );
    return this.getBlueprintAgent(blueprintId, data.agentId)!;
  }

  deleteBlueprintAgent(blueprintId: number, agentId: string): void {
    this.db
      .prepare("DELETE FROM agents WHERE blueprint_id = ? AND agent_id = ?")
      .run(blueprintId, agentId);
  }

  updateBlueprintAgentPosition(agentDbId: number, x: number, y: number): void {
    this.db.prepare("UPDATE agents SET position_x=?, position_y=? WHERE id=?").run(x, y, agentDbId);
  }

  // --- Blueprint Links ---

  listBlueprintLinks(blueprintId: number): BlueprintLinkRecord[] {
    return this.db
      .prepare("SELECT * FROM agent_links WHERE blueprint_id = ?")
      .all(blueprintId) as BlueprintLinkRecord[];
  }

  replaceBlueprintLinks(
    blueprintId: number,
    links: Array<{
      sourceAgentId: string;
      targetAgentId: string;
      linkType: "a2a" | "spawn";
    }>,
  ): void {
    const del = this.db.prepare("DELETE FROM agent_links WHERE blueprint_id = ?");
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO agent_links
         (blueprint_id, source_agent_id, target_agent_id, link_type)
       VALUES (?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      del.run(blueprintId);
      for (const link of links) {
        ins.run(blueprintId, link.sourceAgentId, link.targetAgentId, link.linkType);
      }
    })();
  }

  // --- Blueprint Builder Data ---

  getBlueprintBuilderData(blueprintId: number):
    | {
        blueprint: BlueprintRecord;
        agents: BlueprintAgentRecord[];
        links: BlueprintLinkRecord[];
      }
    | undefined {
    const blueprint = this.getBlueprint(blueprintId);
    if (!blueprint) return undefined;
    const agents = this.listBlueprintAgents(blueprintId);
    const links = this.listBlueprintLinks(blueprintId);
    return { blueprint, agents, links };
  }
}
