// src/core/repositories/instance-repository.ts
import type Database from "better-sqlite3";
import type { InstanceRecord } from "../registry.js";
import { now } from "../../lib/date.js";

export class InstanceRepository {
  constructor(private db: Database.Database) {}

  listInstances(): InstanceRecord[] {
    return this.db.prepare("SELECT * FROM instances ORDER BY port ASC").all() as InstanceRecord[];
  }

  getInstance(slug: string): InstanceRecord | undefined {
    return this.db.prepare("SELECT * FROM instances WHERE slug = ?").get(slug) as
      | InstanceRecord
      | undefined;
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
    defaultModel?: string;
    discovered?: boolean;
  }): InstanceRecord {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO instances (server_id, slug, display_name, port, config_path, state_dir,
         systemd_unit, telegram_bot, default_model, discovered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        data.defaultModel ?? null,
        data.discovered ? 1 : 0,
        now(),
        now(),
      );
    return this.getInstance(data.slug)!;
  }

  updateInstanceState(slug: string, state: InstanceRecord["state"]): void {
    this.db
      .prepare(`UPDATE instances SET state=?, updated_at=? WHERE slug=?`)
      .run(state, now(), slug);
  }

  updateInstance(
    slug: string,
    fields: Partial<{
      displayName: string;
      telegramBot: string;
      defaultModel: string;
      port: number;
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
    if (fields.defaultModel !== undefined) {
      sets.push("default_model=?");
      values.push(fields.defaultModel);
    }
    if (fields.port !== undefined) {
      sets.push("port=?");
      values.push(fields.port);
    }

    if (sets.length === 0) return;
    sets.push("updated_at=?");
    values.push(now());
    values.push(slug);

    this.db.prepare(`UPDATE instances SET ${sets.join(", ")} WHERE slug=?`).run(...values);
  }

  deleteInstance(slug: string): void {
    this.db.prepare("DELETE FROM instances WHERE slug = ?").run(slug);
  }
}
