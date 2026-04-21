// src/core/audit/sinks/db.ts
//
// Default Community sink: persist each envelope to the `rt_audit_events`
// table (migration v39). Schema is decoupled from the legacy `events`
// table to carry `org_id` natively (Enterprise R2 slot) and to avoid
// polluting the per-instance audit trail with cross-cutting security
// events.
//
// Columns `kind`, `timestamp`, `server_id`, `org_id`, `user_id` are
// extracted as first-class columns to power dashboard queries; the full
// envelope JSON is kept in `payload` as the source of truth.

import type Database from "better-sqlite3";
import type { AuditEventEnvelope } from "../events.js";
import { DEFAULT_SINK_BRAND, type AuditSink } from "../emitter.js";

/** Extract the `userId | by` field if present on the envelope. */
function extractUserId(env: AuditEventEnvelope): string | null {
  if ("userId" in env && env.userId !== undefined) return env.userId;
  if ("by" in env && env.by !== undefined) return env.by;
  return null;
}

export class DbAuditSink implements AuditSink {
  readonly kind = "db";
  readonly [DEFAULT_SINK_BRAND] = true;

  private readonly insert: Database.Statement;

  constructor(db: Database.Database) {
    this.insert = db.prepare(
      `INSERT INTO rt_audit_events
        (kind, timestamp, server_id, org_id, user_id, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
  }

  write(envelope: AuditEventEnvelope): Promise<void> {
    this.insert.run(
      envelope.kind,
      envelope.timestamp,
      envelope.serverId,
      envelope.orgId ?? null,
      extractUserId(envelope),
      JSON.stringify(envelope),
    );
    return Promise.resolve();
  }
}
