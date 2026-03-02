// src/core/repositories/port-repository.ts
import type Database from "better-sqlite3";

export class PortRepository {
  constructor(private db: Database.Database) {}

  allocatePort(serverId: number, port: number, instanceSlug: string): void {
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
      .prepare("SELECT port FROM ports WHERE server_id = ? ORDER BY port")
      .all(serverId) as { port: number }[];
    return rows.map((r) => r.port);
  }
}
