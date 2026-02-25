// src/core/registry.ts
import type Database from "better-sqlite3";

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export interface ServerRecord {
  id: number;
  hostname: string;
  ip: string | null;
  openclaw_home: string;
  openclaw_bin: string | null;
  openclaw_version: string | null;
}

export interface InstanceRecord {
  id: number;
  server_id: number;
  slug: string;
  display_name: string | null;
  port: number;
  state: "running" | "stopped" | "error" | "unknown";
  config_path: string;
  state_dir: string;
  systemd_unit: string;
  telegram_bot: string | null;
  nginx_domain: string | null;
  default_model: string | null;
  discovered: number;
  created_at: string;
  updated_at: string;
}

export interface AgentRecord {
  id: number;
  instance_id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: number;
  // v2 enriched fields (nullable — added by migration)
  role: string | null;
  tags: string | null;
  notes: string | null;
  position_x: number | null;
  position_y: number | null;
  config_hash: string | null;
  synced_at: string | null;
}

export interface AgentFileRecord {
  id: number;
  /** FK to agents.id (the DB primary key, not agent_id string) */
  agent_id: number;
  filename: string;
  content: string | null;
  content_hash: string | null;
  updated_at: string | null;
}

export interface AgentLinkRecord {
  id: number;
  instance_id: number;
  source_agent_id: string;
  target_agent_id: string;
  link_type: "a2a" | "spawn";
}

export class Registry {
  constructor(private db: Database.Database) {}

  // --- Servers ---

  getLocalServer(): ServerRecord | undefined {
    return this.db
      .prepare("SELECT * FROM servers WHERE id = 1")
      .get() as ServerRecord | undefined;
  }

  upsertLocalServer(
    hostname: string,
    openclawHome: string,
    ip?: string,
  ): ServerRecord {
    const existing = this.getLocalServer();
    if (existing) {
      this.db
        .prepare(
          `UPDATE servers SET hostname=?, openclaw_home=?, ip=?, updated_at=? WHERE id=1`,
        )
        .run(hostname, openclawHome, ip ?? null, now());
    } else {
      this.db
        .prepare(
          "INSERT INTO servers (hostname, openclaw_home, ip, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(hostname, openclawHome, ip ?? null, now(), now());
    }
    return this.getLocalServer()!;
  }

  updateServerBin(bin: string, version: string): void {
    this.db
      .prepare(
        `UPDATE servers SET openclaw_bin=?, openclaw_version=?, updated_at=? WHERE id=1`,
      )
      .run(bin, version, now());
  }

  // --- Instances ---

  listInstances(): InstanceRecord[] {
    return this.db
      .prepare("SELECT * FROM instances ORDER BY port ASC")
      .all() as InstanceRecord[];
  }

  getInstance(slug: string): InstanceRecord | undefined {
    return this.db
      .prepare("SELECT * FROM instances WHERE slug = ?")
      .get(slug) as InstanceRecord | undefined;
  }

  createInstance(data: {
    serverId: number;
    slug: string;
    displayName?: string;
    port: number;
    configPath: string;
    stateDir: string;
    systemdUnit: string;
    telegramBot?: string;
    nginxDomain?: string;
    defaultModel?: string;
    discovered?: boolean;
  }): InstanceRecord {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO instances (server_id, slug, display_name, port, config_path, state_dir,
         systemd_unit, telegram_bot, nginx_domain, default_model, discovered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.serverId,
        data.slug,
        data.displayName ?? null,
        data.port,
        data.configPath,
        data.stateDir,
        data.systemdUnit,
        data.telegramBot ?? null,
        data.nginxDomain ?? null,
        data.defaultModel ?? null,
        data.discovered ? 1 : 0,
        now(),
        now(),
      );
    return this.getInstance(data.slug)!;
  }

  updateInstanceState(slug: string, state: InstanceRecord["state"]): void {
    this.db
      .prepare(
        `UPDATE instances SET state=?, updated_at=? WHERE slug=?`,
      )
      .run(state, now(), slug);
  }

  updateInstance(
    slug: string,
    fields: Partial<{
      displayName: string;
      telegramBot: string;
      nginxDomain: string;
      defaultModel: string;
    }>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.displayName !== undefined) {
      sets.push("display_name=?");
      values.push(fields.displayName);
    }
    if (fields.telegramBot !== undefined) {
      sets.push("telegram_bot=?");
      values.push(fields.telegramBot);
    }
    if (fields.nginxDomain !== undefined) {
      sets.push("nginx_domain=?");
      values.push(fields.nginxDomain);
    }
    if (fields.defaultModel !== undefined) {
      sets.push("default_model=?");
      values.push(fields.defaultModel);
    }

    if (sets.length === 0) return;
    sets.push("updated_at=?");
    values.push(now());
    values.push(slug);

    this.db
      .prepare(`UPDATE instances SET ${sets.join(", ")} WHERE slug=?`)
      .run(...values);
  }

  deleteInstance(slug: string): void {
    this.db.prepare("DELETE FROM instances WHERE slug = ?").run(slug);
  }

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

  /** Delete a single agent row by its DB primary key (cascade removes agent_files). */
  deleteAgentById(agentDbId: number): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(agentDbId);
  }

  /**
   * Insert or update an agent row, returning the persisted record.
   *
   * Uses INSERT ... ON CONFLICT DO UPDATE so that v2 enriched fields
   * (role, tags, notes, position_x/y, config_hash, synced_at) are preserved
   * when updating an existing row — unlike INSERT OR REPLACE which would
   * delete and re-insert, losing those columns.
   */
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

  /** Look up an agent by its string agent_id within an instance. */
  getAgentByAgentId(
    instanceId: number,
    agentId: string,
  ): AgentRecord | undefined {
    return this.db
      .prepare(
        "SELECT * FROM agents WHERE instance_id = ? AND agent_id = ?",
      )
      .get(instanceId, agentId) as AgentRecord | undefined;
  }

  /**
   * Update human-readable metadata fields on an agent.
   * Only the provided keys are updated (undefined = skip).
   */
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

  /** Persist the canvas position of an agent. */
  updateAgentPosition(agentDbId: number, x: number, y: number): void {
    this.db
      .prepare("UPDATE agents SET position_x=?, position_y=? WHERE id=?")
      .run(x, y, agentDbId);
  }

  /** Record the last sync hash and timestamp for an agent. */
  updateAgentSync(
    agentDbId: number,
    fields: { configHash: string; syncedAt: string },
  ): void {
    this.db
      .prepare(
        "UPDATE agents SET config_hash=?, synced_at=? WHERE id=?",
      )
      .run(fields.configHash, fields.syncedAt, agentDbId);
  }

  // --- Agent Files ---

  /** List all workspace files cached for a given agent (by DB id). */
  listAgentFiles(agentDbId: number): AgentFileRecord[] {
    return this.db
      .prepare("SELECT * FROM agent_files WHERE agent_id = ?")
      .all(agentDbId) as AgentFileRecord[];
  }

  /** Insert or update a workspace file record. */
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

  /** Delete a single workspace file record. */
  deleteAgentFile(agentDbId: number, filename: string): void {
    this.db
      .prepare(
        "DELETE FROM agent_files WHERE agent_id = ? AND filename = ?",
      )
      .run(agentDbId, filename);
  }

  /** Retrieve a single workspace file record including its content. */
  getAgentFileContent(
    agentDbId: number,
    filename: string,
  ): AgentFileRecord | undefined {
    return this.db
      .prepare(
        "SELECT * FROM agent_files WHERE agent_id = ? AND filename = ?",
      )
      .get(agentDbId, filename) as AgentFileRecord | undefined;
  }

  // --- Agent Links ---

  /** List all agent links for an instance. */
  listAgentLinks(instanceId: number): AgentLinkRecord[] {
    return this.db
      .prepare("SELECT * FROM agent_links WHERE instance_id = ?")
      .all(instanceId) as AgentLinkRecord[];
  }

  /**
   * Atomically replace all agent links for an instance.
   * Deletes existing links then inserts the new set in a single transaction.
   */
  replaceAgentLinks(
    instanceId: number,
    links: Array<{
      sourceAgentId: string;
      targetAgentId: string;
      linkType: "a2a" | "spawn";
    }>,
  ): void {
    const del = this.db.prepare(
      "DELETE FROM agent_links WHERE instance_id = ?",
    );
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

  // --- Ports ---

  allocatePort(
    serverId: number,
    port: number,
    instanceSlug: string,
  ): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ports (server_id, port, instance_slug) VALUES (?, ?, ?)",
      )
      .run(serverId, port, instanceSlug);
  }

  releasePort(serverId: number, port: number): void {
    this.db
      .prepare("DELETE FROM ports WHERE server_id = ? AND port = ?")
      .run(serverId, port);
  }

  getUsedPorts(serverId: number): number[] {
    const rows = this.db
      .prepare(
        "SELECT port FROM ports WHERE server_id = ? ORDER BY port",
      )
      .all(serverId) as { port: number }[];
    return rows.map((r) => r.port);
  }

  // --- Config ---

  getConfig(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  // --- Events ---

  logEvent(
    instanceSlug: string | null,
    eventType: string,
    detail?: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO events (instance_slug, event_type, detail, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(instanceSlug, eventType, detail ?? null, now());
  }

  listEvents(instanceSlug?: string, limit = 50): Array<{
    id: number;
    instance_slug: string | null;
    event_type: string;
    detail: string | null;
    created_at: string;
  }> {
    if (instanceSlug) {
      return this.db
        .prepare(
          "SELECT * FROM events WHERE instance_slug = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(instanceSlug, limit) as ReturnType<typeof this.listEvents>;
    }
    return this.db
      .prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?")
      .all(limit) as ReturnType<typeof this.listEvents>;
  }
}
