// src/core/repositories/config-repository.ts
import type Database from "better-sqlite3";

export class ConfigRepository {
  constructor(private db: Database.Database) {}

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
}
