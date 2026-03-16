/**
 * db/__tests__/schema-v13.test.ts
 *
 * Tests for migration v13 — persistent sessions + agent creation date:
 *   - rt_sessions.persistent INTEGER NOT NULL DEFAULT 0
 *   - Index idx_rt_sessions_permanent
 *   - agents.created_at TEXT with conditional backfill
 *   - Idempotency (applying twice must not crash)
 *
 * Uses a real file-based DB (tmpdir) to test the migration path,
 * following the same pattern as schema-v11.test.ts.
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-v13-test-"));
  dbPath = path.join(tmpDir, "test.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
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

/** Seed a server + instance so FK constraints on rt_sessions are satisfied. */
function seedServerAndInstance(db: Database.Database, slug: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
       (server_id, slug, port, config_path, state_dir, systemd_unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19002, "/tmp/cfg.json", "/tmp/state", "test.service");
}

/** Seed an agent row (requires an instance to exist). */
function seedAgent(db: Database.Database, instanceSlug: string, agentId: string): void {
  const instance = db.prepare("SELECT id FROM instances WHERE slug = ?").get(instanceSlug) as {
    id: number;
  };
  db.prepare(
    `INSERT OR IGNORE INTO agents (instance_id, agent_id, name, workspace_path)
       VALUES (?, ?, ?, ?)`,
  ).run(instance.id, agentId, "Test Agent", "/workspace/test");
}

// ---------------------------------------------------------------------------
// Suite — Migration v13: rt_sessions.persistent column
// ---------------------------------------------------------------------------

describe("migration v13 — rt_sessions.persistent column", () => {
  it(// Positive: after initDatabase(), rt_sessions must have the 'persistent' column.
  // Verifies the core v13 migration was applied.
  "rt_sessions has the 'persistent' column after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(columnNames(db, "rt_sessions")).toContain("persistent");
    db.close();
  });

  it(// Positive: a session inserted without specifying 'persistent' must default to 0
  // (backward-compat — existing sessions are ephemeral).
  "persistent defaults to 0 when not provided in INSERT", () => {
    // Arrange
    const db = initDatabase(dbPath);
    seedServerAndInstance(db, "v13-test");

    // Act — INSERT without persistent (relies on DEFAULT 0)
    db.prepare(
      `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, created_at, updated_at)
           VALUES ('test-id-v13', 'v13-test', 'main', 'web', datetime('now'), datetime('now'))`,
    ).run();

    // Assert — persistent must be 0, not NULL
    const row = db.prepare("SELECT persistent FROM rt_sessions WHERE id = 'test-id-v13'").get() as {
      persistent: number | null;
    };
    expect(row.persistent).toBe(0);
    db.close();
  });

  it(// Negative: a pre-v13 database (stopped at v12) must NOT have the 'persistent' column.
  // Verifies the migration is actually needed — tests the pre-migration state.
  "a pre-v13 database does not have 'persistent' column before migration", () => {
    // Arrange — build a DB stopped at version 12 (no v13 migration)
    const preV13Db = new Database(dbPath);
    preV13Db.pragma("journal_mode = WAL");
    preV13Db.pragma("foreign_keys = ON");
    preV13Db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES (12);

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

        CREATE TABLE agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL,
          name TEXT NOT NULL,
          workspace_path TEXT NOT NULL,
          UNIQUE(instance_id, agent_id)
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
          session_key TEXT,
          spawn_depth INTEGER NOT NULL DEFAULT 0,
          label TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE rt_pairing_codes (
          code TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'web',
          peer_id TEXT,
          used INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          meta TEXT
        );
      `);

    // Act — verify pre-migration state
    const colsBefore = columnNames(preV13Db, "rt_sessions");
    preV13Db.close();

    // Assert — 'persistent' must NOT exist before v13
    expect(colsBefore).not.toContain("persistent");
  });
});

// ---------------------------------------------------------------------------
// Suite — Migration v13: idx_rt_sessions_permanent index
// ---------------------------------------------------------------------------

describe("migration v13 — idx_rt_sessions_permanent index", () => {
  it(// Positive: the partial index for fast lookup of permanent active sessions must exist.
  "index 'idx_rt_sessions_permanent' exists after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(indexNames(db)).toContain("idx_rt_sessions_permanent");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Suite — Migration v13: agents.created_at column
// ---------------------------------------------------------------------------

describe("migration v13 — agents.created_at column", () => {
  it(// Positive: after initDatabase(), agents table must have the 'created_at' column.
  "agents table has the 'created_at' column after migration", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(columnNames(db, "agents")).toContain("created_at");
    db.close();
  });

  it(// Positive: existing agents (inserted before v13) must have created_at backfilled
  // with a non-NULL value (the migration runs UPDATE ... WHERE created_at IS NULL).
  "agents.created_at is backfilled (non-NULL) for pre-existing agents", () => {
    // Arrange — build a DB at v12 with an existing agent, then run migrations
    const preV13Db = new Database(dbPath);
    preV13Db.pragma("journal_mode = WAL");
    preV13Db.pragma("foreign_keys = ON");
    preV13Db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES (12);

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

        CREATE TABLE agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL,
          name TEXT NOT NULL,
          workspace_path TEXT NOT NULL,
          UNIQUE(instance_id, agent_id)
        );

        CREATE TABLE rt_sessions (
          id TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'web',
          peer_id TEXT,
          state TEXT NOT NULL DEFAULT 'active',
          session_key TEXT,
          spawn_depth INTEGER NOT NULL DEFAULT 0,
          label TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE rt_pairing_codes (
          code TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'web',
          peer_id TEXT,
          used INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          meta TEXT
        );

        -- Seed a server + instance + agent (pre-v13, no created_at column yet)
        INSERT INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw');
        INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
          VALUES (1, 'test-inst', 19003, '/tmp/cfg.json', '/tmp/state', 'test.service');
        INSERT INTO agents (instance_id, agent_id, name, workspace_path)
          VALUES (1, 'main', 'Main Agent', '/workspace/main');
      `);
    preV13Db.close();

    // Act — run migrations (v13 adds created_at and backfills)
    const db = initDatabase(dbPath);

    // Assert — the pre-existing agent must have a non-NULL created_at
    const agent = db.prepare("SELECT created_at FROM agents WHERE agent_id = 'main'").get() as {
      created_at: string | null;
    };
    expect(agent.created_at).not.toBeNull();
    expect(typeof agent.created_at).toBe("string");
    expect(agent.created_at!.length).toBeGreaterThan(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Suite — Migration v13: idempotency
// ---------------------------------------------------------------------------

describe("migration v13 — idempotency", () => {
  it(// Positive: calling initDatabase() twice on the same file must not throw.
  // Verifies CREATE INDEX IF NOT EXISTS and ALTER TABLE guards work correctly.
  "initDatabase() is idempotent — second call does not error", () => {
    // Arrange + Act
    const db1 = initDatabase(dbPath);
    db1.close();

    // Assert — second call must not throw
    expect(() => {
      const db2 = initDatabase(dbPath);
      db2.close();
    }).not.toThrow();
  });

  it(// Positive: schema version must be 13 after initDatabase() (latest migration).
  "schema version is 13 after initDatabase()", () => {
    // Arrange + Act
    const db = initDatabase(dbPath);

    // Assert
    expect(schemaVersion(db)).toBe(13);
    db.close();
  });
});
