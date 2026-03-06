// src/core/repositories/agent-repository.ts
import type Database from "better-sqlite3";
import type { AgentRecord, AgentFileRecord, AgentLinkRecord } from "../registry.js";
import { now } from "../../lib/date.js";

export class AgentRepository {
  constructor(private db: Database.Database) {}

  // --- Agents ---

  listAgents(instanceSlug: string): AgentRecord[] {
    return this.db
      .prepare(
        `SELECT a.* FROM agents a
         JOIN instances i ON a.instance_id = i.id
         WHERE i.slug = ?
         ORDER BY a.is_default DESC, a.agent_id ASC`,
      )
      .all(instanceSlug) as AgentRecord[];
  }

  createAgent(
    instanceId: number,
    data: {
      agentId: string;
      name: string;
      model?: string;
      workspacePath: string;
      isDefault?: boolean;
    },
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO agents (instance_id, agent_id, name, model, workspace_path, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        instanceId,
        data.agentId,
        data.name,
        data.model ?? null,
        data.workspacePath,
        data.isDefault ? 1 : 0,
      );
  }

  deleteAgents(instanceId: number): void {
    this.db.prepare("DELETE FROM agents WHERE instance_id = ?").run(instanceId);
  }

  deleteAgentById(agentDbId: number): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(agentDbId);
  }

  upsertAgent(
    instanceId: number,
    data: {
      agentId: string;
      name: string;
      model?: string;
      workspacePath: string;
      isDefault?: boolean;
    },
  ): AgentRecord {
    this.db
      .prepare(
        `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(instance_id, agent_id) DO UPDATE SET
           name          = excluded.name,
           model         = excluded.model,
           workspace_path = excluded.workspace_path,
           is_default    = excluded.is_default`,
      )
      .run(
        instanceId,
        data.agentId,
        data.name,
        data.model ?? null,
        data.workspacePath,
        data.isDefault ? 1 : 0,
      );
    return this.getAgentByAgentId(instanceId, data.agentId)!;
  }

  getAgentByAgentId(instanceId: number, agentId: string): AgentRecord | undefined {
    return this.db
      .prepare("SELECT * FROM agents WHERE instance_id = ? AND agent_id = ?")
      .get(instanceId, agentId) as AgentRecord | undefined;
  }

  updateAgentMeta(
    agentDbId: number,
    fields: Partial<{
      role: string | null;
      tags: string | null;
      notes: string | null;
    }>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if ("role" in fields) { sets.push("role=?"); values.push(fields.role ?? null); }
    if ("tags" in fields) { sets.push("tags=?"); values.push(fields.tags ?? null); }
    if ("notes" in fields) { sets.push("notes=?"); values.push(fields.notes ?? null); }

    if (sets.length === 0) return;
    values.push(agentDbId);

    this.db
      .prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id=?`)
      .run(...values);
  }

  updateAgentPosition(agentDbId: number, x: number, y: number): void {
    this.db
      .prepare("UPDATE agents SET position_x=?, position_y=? WHERE id=?")
      .run(x, y, agentDbId);
  }

  updateAgentSync(
    agentDbId: number,
    fields: { configHash: string; syncedAt: string },
  ): void {
    this.db
      .prepare("UPDATE agents SET config_hash=?, synced_at=? WHERE id=?")
      .run(fields.configHash, fields.syncedAt, agentDbId);
  }

  // --- Agent Files ---

  listAgentFiles(agentDbId: number): AgentFileRecord[] {
    return this.db
      .prepare("SELECT * FROM agent_files WHERE agent_id = ?")
      .all(agentDbId) as AgentFileRecord[];
  }

  upsertAgentFile(
    agentDbId: number,
    data: { filename: string; content: string; contentHash: string },
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_files
           (agent_id, filename, content, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(agentDbId, data.filename, data.content, data.contentHash, now());
  }

  deleteAgentFile(agentDbId: number, filename: string): void {
    this.db
      .prepare("DELETE FROM agent_files WHERE agent_id = ? AND filename = ?")
      .run(agentDbId, filename);
  }

  getAgentFileContent(agentDbId: number, filename: string): AgentFileRecord | undefined {
    return this.db
      .prepare("SELECT * FROM agent_files WHERE agent_id = ? AND filename = ?")
      .get(agentDbId, filename) as AgentFileRecord | undefined;
  }

  // --- Agent Links ---

  listAgentLinks(instanceId: number): AgentLinkRecord[] {
    return this.db
      .prepare("SELECT * FROM agent_links WHERE instance_id = ?")
      .all(instanceId) as AgentLinkRecord[];
  }

  replaceAgentLinks(
    instanceId: number,
    links: Array<{
      sourceAgentId: string;
      targetAgentId: string;
      linkType: "a2a" | "spawn";
    }>,
  ): void {
    const del = this.db.prepare("DELETE FROM agent_links WHERE instance_id = ?");
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO agent_links
         (instance_id, source_agent_id, target_agent_id, link_type)
       VALUES (?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      del.run(instanceId);
      for (const link of links) {
        ins.run(instanceId, link.sourceAgentId, link.targetAgentId, link.linkType);
      }
    })();
  }
}
