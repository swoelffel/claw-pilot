// src/core/audit/__tests__/sinks.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { FileAuditSink } from "../sinks/file.js";
import { DbAuditSink } from "../sinks/db.js";
import type { AuditEventEnvelope } from "../events.js";

function envelope(overrides: Partial<AuditEventEnvelope> = {}): AuditEventEnvelope {
  return {
    kind: "auth.logout",
    userId: "u1",
    timestamp: "2026-04-21T10:00:00.000Z",
    serverId: "srv-1",
    ...overrides,
  } as AuditEventEnvelope;
}

describe("FileAuditSink", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "audit-file-"));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("writes one JSON object per line, named by UTC day", async () => {
    const sink = new FileAuditSink(stateDir);
    await sink.write(envelope({ timestamp: "2026-04-21T10:00:00.000Z" }));
    await sink.write(envelope({ timestamp: "2026-04-21T23:59:59.999Z", userId: "u2" }));

    const files = readdirSync(path.join(stateDir, "audit"));
    expect(files).toContain("2026-04-21.jsonl");

    const content = readFileSync(path.join(stateDir, "audit", "2026-04-21.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ userId: "u1" });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ userId: "u2" });
  });

  it("splits across days at UTC midnight", async () => {
    const sink = new FileAuditSink(stateDir);
    await sink.write(envelope({ timestamp: "2026-04-21T23:59:59.999Z" }));
    await sink.write(envelope({ timestamp: "2026-04-22T00:00:00.001Z" }));

    const files = new Set(readdirSync(path.join(stateDir, "audit")));
    expect(files.has("2026-04-21.jsonl")).toBe(true);
    expect(files.has("2026-04-22.jsonl")).toBe(true);
  });
});

describe("DbAuditSink", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE rt_audit_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT NOT NULL,
        timestamp  TEXT NOT NULL,
        server_id  TEXT NOT NULL,
        org_id     TEXT NULL,
        user_id    TEXT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("stores first-class columns and full payload", async () => {
    const sink = new DbAuditSink(db);
    await sink.write(
      envelope({
        kind: "permission.denied",
        userId: "u42",
        action: "agent.delete",
        resource: "agent:abc",
        reason: "role=viewer",
      } as AuditEventEnvelope),
    );

    const row = db.prepare("SELECT * FROM rt_audit_events").get() as Record<string, unknown>;
    expect(row).toMatchObject({
      kind: "permission.denied",
      timestamp: "2026-04-21T10:00:00.000Z",
      server_id: "srv-1",
      org_id: null,
      user_id: "u42",
    });
    const payload = JSON.parse(row.payload as string);
    expect(payload.action).toBe("agent.delete");
    expect(payload.resource).toBe("agent:abc");
  });

  it("extracts `by` into user_id when userId is absent", async () => {
    const sink = new DbAuditSink(db);
    await sink.write(
      envelope({
        kind: "named_key.mutation",
        action: "create",
        keyId: "7",
        by: "u1",
      } as unknown as AuditEventEnvelope),
    );
    const row = db.prepare("SELECT user_id FROM rt_audit_events").get() as { user_id: string };
    expect(row.user_id).toBe("u1");
  });
});
