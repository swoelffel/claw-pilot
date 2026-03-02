// src/core/repositories/server-repository.ts
import type Database from "better-sqlite3";
import type { ServerRecord } from "../registry.js";

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export class ServerRepository {
  constructor(private db: Database.Database) {}

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
}
