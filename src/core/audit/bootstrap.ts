// src/core/audit/bootstrap.ts
import type Database from "better-sqlite3";
import { getDataDir } from "../../lib/platform.js";
import { isAuditBusRegistered, registerAuditSink } from "./emitter.js";
import { FileAuditSink } from "./sinks/file.js";
import { DbAuditSink } from "./sinks/db.js";

/**
 * Idempotent bootstrap used by every process entry point (`withContext`,
 * dashboard command, runtime command). Registers the two default Community
 * sinks (file + db) if nothing has been registered yet.
 *
 * Extension point: Enterprise calls `registerAuditSink(new SplunkSink(...))`
 * AFTER this function runs — the default sinks stay in place and Splunk
 * receives a mirrored copy of every envelope.
 */
export function bootstrapAuditBus(db: Database.Database, stateDir: string = getDataDir()): void {
  if (isAuditBusRegistered()) return;
  registerAuditSink(new FileAuditSink(stateDir));
  registerAuditSink(new DbAuditSink(db));
}
