// src/core/repositories/server-repository.ts
import type Database from "better-sqlite3";
import type { ServerRecord } from "../registry-types.js";
import { now } from "../../lib/date.js";

export class ServerRepository {
  constructor(private db: Database.Database) {}

  getLocalServer(): ServerRecord | undefined {
    // DB column is still `openclaw_home` (additive-only schema) — alias to `home_dir` for TS.
    const row = this.db
      .prepare("SELECT id, hostname, ip, openclaw_home AS home_dir FROM servers WHERE id = 1")
      .get() as ServerRecord | undefined;
    return row;
  }

  upsertLocalServer(hostname: string, homeDir: string, ip?: string): ServerRecord {
    const existing = this.getLocalServer();
    if (existing) {
      this.db
        .prepare(`UPDATE servers SET hostname=?, openclaw_home=?, ip=?, updated_at=? WHERE id=1`)
        .run(hostname, homeDir, ip ?? null, now());
    } else {
      this.db
        .prepare(
          "INSERT INTO servers (hostname, openclaw_home, ip, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(hostname, homeDir, ip ?? null, now(), now());
    }
    return this.getLocalServer()!;
  }
}
