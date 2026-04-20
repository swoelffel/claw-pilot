// src/core/repositories/instance-shared-file-repository.ts
//
// CRUD over `instance_shared_files` (schema v38). Symmetrical with the
// agent_files methods on AgentRepository — one shared workspace per instance,
// readable by all agents of that instance.

import type Database from "better-sqlite3";
import { now } from "../../lib/date.js";

export interface InstanceSharedFileRecord {
  id: number;
  instance_id: number;
  filename: string;
  content: string | null;
  content_hash: string | null;
  updated_at: string | null;
}

export class InstanceSharedFileRepository {
  constructor(private db: Database.Database) {}

  listSharedFiles(instanceId: number): InstanceSharedFileRecord[] {
    return this.db
      .prepare("SELECT * FROM instance_shared_files WHERE instance_id = ? ORDER BY filename")
      .all(instanceId) as InstanceSharedFileRecord[];
  }

  getSharedFileContent(instanceId: number, filename: string): InstanceSharedFileRecord | undefined {
    return this.db
      .prepare("SELECT * FROM instance_shared_files WHERE instance_id = ? AND filename = ?")
      .get(instanceId, filename) as InstanceSharedFileRecord | undefined;
  }

  upsertSharedFile(
    instanceId: number,
    data: { filename: string; content: string; contentHash: string },
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO instance_shared_files
           (instance_id, filename, content, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(instanceId, data.filename, data.content, data.contentHash, now());
  }

  deleteSharedFile(instanceId: number, filename: string): void {
    this.db
      .prepare("DELETE FROM instance_shared_files WHERE instance_id = ? AND filename = ?")
      .run(instanceId, filename);
  }
}
