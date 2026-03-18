/**
 * db/__tests__/schema-v11.test.ts
 *
 * Tests for migration v11 — session enrichment columns on rt_sessions:
 *   - session_key, spawn_depth, label, metadata
 *   - Indexes: idx_rt_sessions_key, idx_rt_sessions_parent_state
 *   - Default value for spawn_depth (must be 0, not NULL)
 *
 * Uses a real file-based DB (tmpdir) to test the migration path,
 * following the same pattern as schema.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { initDatabase } from "../schema.js";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-v11-test-"));
  dbPath = path.join(tmpDir, "test.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers (mirrors schema.test.ts)
// ---------------------------------------------------------------------------

/** Return the column names of a table. */
function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

/** Return the index names present in the DB. */
function indexNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((i) => i.name);
}

/** Return the current schema version stored in the DB. */
function schemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

// ---------------------------------------------------------------------------
// Suite — Migration v11: new columns on rt_sessions
// ---------------------------------------------------------------------------

describe("migration v11 — rt_sessions new columns", () => {
  it(// Positive: after initDatabase(), rt_sessions must have the session_key column
  "rt_sessions has the 'session_key' column after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(columnNames(db, "rt_sessions")).toContain("session_key");
    db.close();
  });

  it(// Positive: after initDatabase(), rt_sessions must have the spawn_depth column
  "rt_sessions has the 'spawn_depth' column after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(columnNames(db, "rt_sessions")).toContain("spawn_depth");
    db.close();
  });

  it(// Positive: after initDatabase(), rt_sessions must have the label column
  "rt_sessions has the 'label' column after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(columnNames(db, "rt_sessions")).toContain("label");
    db.close();
  });

  it(// Positive: after initDatabase(), rt_sessions must have the metadata column
  "rt_sessions has the 'metadata' column after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(columnNames(db, "rt_sessions")).toContain("metadata");
    db.close();
  });

  it(// Positive: the unique index on session_key (root sessions only) must exist
  "index 'idx_rt_sessions_key' exists after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(indexNames(db)).toContain("idx_rt_sessions_key");
    db.close();
  });

  it(// Positive: the composite index on (parent_id, state) must exist for countActiveChildren()
  "index 'idx_rt_sessions_parent_state' exists after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(indexNames(db)).toContain("idx_rt_sessions_parent_state");
    db.close();
  });

  it(// Positive: spawn_depth default value is 0 — INSERT without spawn_depth must store 0
  "spawn_depth defaults to 0 when not provided in INSERT", () => {
    // Arrange
    const db = initDatabase(dbPath);

    // Seed a server + instance so the FK on rt_sessions is satisfied
    db.prepare(
      `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
    ).run();
    const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
    db.prepare(
      `INSERT OR IGNORE INTO instances
         (server_id, slug, port, config_path, state_dir, systemd_unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(server.id, "v11-test", 19002, "/tmp/cfg.json", "/tmp/state", "test.service");

    // Act — INSERT without spawn_depth (relies on DEFAULT 0)
    db.prepare(
      `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, created_at, updated_at)
         VALUES ('test-id-v11', 'v11-test', 'main', 'web', datetime('now'), datetime('now'))`,
    ).run();

    // Assert — spawn_depth must be 0, not NULL
    const row = db
      .prepare("SELECT spawn_depth FROM rt_sessions WHERE id = 'test-id-v11'")
      .get() as {
      spawn_depth: number | null;
    };
    expect(row.spawn_depth).toBe(0);
    db.close();
  });

  it(// Negative: a fresh DB without v11 migration must NOT have session_key column
  // (verifies the migration is actually needed — tests the pre-migration state)
  "a pre-v11 database does not have session_key before migration is applied", () => {
    // Arrange — build a DB stopped at version 10 (no v11 migration)
    const preV11Db = new Database(dbPath);
    preV11Db.pragma("journal_mode = WAL");
    preV11Db.pragma("foreign_keys = ON");
    preV11Db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES (10);

        CREATE TABLE servers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hostname TEXT NOT NULL,
          openclaw_home TEXT NOT NULL
        );

        CREATE TABLE instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL REFERENCES servers(id),
          slug TEXT NOT NULL UNIQUE,
          port INTEGER NOT NULL UNIQUE,
          state TEXT DEFAULT 'unknown',
          config_path TEXT NOT NULL,
          state_dir TEXT NOT NULL,
          systemd_unit TEXT NOT NULL,
          instance_type TEXT NOT NULL DEFAULT 'openclaw'
        );

        CREATE TABLE rt_sessions (
          id TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL,
          parent_id TEXT,
          agent_id TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'web',
          peer_id TEXT,
          title TEXT,
          state TEXT NOT NULL DEFAULT 'active',
          permissions TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

    // Act — verify pre-migration state
    const colsBefore = columnNames(preV11Db, "rt_sessions");
    preV11Db.close();

    // Assert — session_key must NOT exist before v11
    expect(colsBefore).not.toContain("session_key");
    expect(colsBefore).not.toContain("spawn_depth");
    expect(colsBefore).not.toContain("label");
    expect(colsBefore).not.toContain("metadata");
  });

  it(// Positive: schema version must be 13 after initDatabase() (latest migration)
  "schema version is 11 after initDatabase()", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert: v16 is the latest migration (agent_blueprints)
    expect(schemaVersion(db)).toBe(16);
    db.close();
  });
});
