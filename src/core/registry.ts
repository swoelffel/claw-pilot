// src/core/registry.ts
import type Database from "better-sqlite3";

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
          `UPDATE servers SET hostname=?, openclaw_home=?, ip=?, updated_at=datetime('now') WHERE id=1`,
        )
        .run(hostname, openclawHome, ip ?? null);
    } else {
      this.db
        .prepare(
          "INSERT INTO servers (hostname, openclaw_home, ip) VALUES (?, ?, ?)",
        )
        .run(hostname, openclawHome, ip ?? null);
    }
    return this.getLocalServer()!;
  }

  updateServerBin(bin: string, version: string): void {
    this.db
      .prepare(
        `UPDATE servers SET openclaw_bin=?, openclaw_version=?, updated_at=datetime('now') WHERE id=1`,
      )
      .run(bin, version);
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
        `INSERT INTO instances (server_id, slug, display_name, port, config_path, state_dir,
         systemd_unit, telegram_bot, nginx_domain, default_model, discovered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return this.getInstance(data.slug)!;
  }

  updateInstanceState(slug: string, state: InstanceRecord["state"]): void {
    this.db
      .prepare(
        `UPDATE instances SET state=?, updated_at=datetime('now') WHERE slug=?`,
      )
      .run(state, slug);
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
    sets.push("updated_at=datetime('now')");
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
        `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default)
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
        "INSERT INTO events (instance_slug, event_type, detail) VALUES (?, ?, ?)",
      )
      .run(instanceSlug, eventType, detail ?? null);
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
