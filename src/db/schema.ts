// src/db/schema.ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

// Bump this when adding new migrations — base schema version (migrations tracked separately)
const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- Physical server (V1: always a single "local" record)
CREATE TABLE IF NOT EXISTS servers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname        TEXT NOT NULL,
  ip              TEXT,
  ssh_user        TEXT,
  ssh_port        INTEGER DEFAULT 22,
  openclaw_home   TEXT NOT NULL,
  openclaw_bin    TEXT,
  openclaw_version TEXT,
  os              TEXT,
  created_at      TEXT,
  updated_at      TEXT
);

-- OpenClaw instance
CREATE TABLE IF NOT EXISTS instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id       INTEGER NOT NULL REFERENCES servers(id),
  slug            TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  port            INTEGER NOT NULL UNIQUE,
  state           TEXT DEFAULT 'unknown' CHECK(state IN ('running','stopped','error','unknown')),
  config_path     TEXT NOT NULL,
  state_dir       TEXT NOT NULL,
  systemd_unit    TEXT NOT NULL,
  telegram_bot    TEXT,
  default_model   TEXT,
  discovered      INTEGER DEFAULT 0,
  created_at      TEXT,
  updated_at      TEXT
);

-- Instance agents
CREATE TABLE IF NOT EXISTS agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  model           TEXT,
  workspace_path  TEXT NOT NULL,
  is_default      INTEGER DEFAULT 0,
  UNIQUE(instance_id, agent_id)
);

-- Allocated port registry
CREATE TABLE IF NOT EXISTS ports (
  server_id       INTEGER NOT NULL REFERENCES servers(id),
  port            INTEGER NOT NULL,
  instance_slug   TEXT,
  PRIMARY KEY (server_id, port)
);

-- Global key-value configuration
CREATE TABLE IF NOT EXISTS config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);

-- Event/history log (audit trail)
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_slug   TEXT,
  event_type      TEXT NOT NULL,
  detail          TEXT,
  created_at      TEXT
);
`;

const DEFAULT_CONFIG: Record<string, string> = {
  port_range_start: "18789",
  port_range_end: "18799",
  dashboard_port: "19000",
  health_check_interval_ms: "10000",
  openclaw_user: "openclaw",
};

// ---------------------------------------------------------------------------
// Migration framework
// ---------------------------------------------------------------------------

interface Migration {
  version: number;
  up(db: Database.Database): void;
}

/**
 * Ordered list of migrations. Each migration must have a unique, monotonically
 * increasing version number greater than SCHEMA_VERSION (1).
 * Migrations are applied in order, inside individual transactions.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 2,
    up(db) {
      db.exec(`
        -- Agent workspace files (AGENTS.md, SOUL.md, etc.)
        CREATE TABLE IF NOT EXISTS agent_files (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          filename        TEXT NOT NULL,
          content         TEXT,
          content_hash    TEXT,
          updated_at      TEXT,
          UNIQUE(agent_id, filename)
        );

        -- Agent-to-agent links (a2a or spawn) scoped to an instance
        CREATE TABLE IF NOT EXISTS agent_links (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
          source_agent_id TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          link_type       TEXT NOT NULL CHECK(link_type IN ('a2a', 'spawn')),
          UNIQUE(instance_id, source_agent_id, target_agent_id, link_type)
        );

        -- Enriched agent metadata columns (added by v2 migration)
        ALTER TABLE agents ADD COLUMN role         TEXT;
        ALTER TABLE agents ADD COLUMN tags         TEXT;
        ALTER TABLE agents ADD COLUMN notes        TEXT;
        ALTER TABLE agents ADD COLUMN position_x   REAL;
        ALTER TABLE agents ADD COLUMN position_y   REAL;
        ALTER TABLE agents ADD COLUMN config_hash  TEXT;
        ALTER TABLE agents ADD COLUMN synced_at    TEXT;
      `);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        -- 1. Table blueprints
        CREATE TABLE IF NOT EXISTS blueprints (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          name         TEXT NOT NULL UNIQUE,
          description  TEXT,
          icon         TEXT,
          tags         TEXT,
          color        TEXT,
          created_at   TEXT,
          updated_at   TEXT
        );

        -- 2. Recréer agents avec FK polymorphe
        CREATE TABLE agents_v3 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id     INTEGER REFERENCES instances(id) ON DELETE CASCADE,
          blueprint_id    INTEGER REFERENCES blueprints(id) ON DELETE CASCADE,
          agent_id        TEXT NOT NULL,
          name            TEXT NOT NULL,
          model           TEXT,
          workspace_path  TEXT NOT NULL,
          is_default      INTEGER DEFAULT 0,
          role            TEXT,
          tags            TEXT,
          notes           TEXT,
          position_x      REAL,
          position_y      REAL,
          config_hash     TEXT,
          synced_at       TEXT,
          CHECK (
            (instance_id IS NOT NULL AND blueprint_id IS NULL) OR
            (instance_id IS NULL AND blueprint_id IS NOT NULL)
          ),
          UNIQUE(instance_id, agent_id),
          UNIQUE(blueprint_id, agent_id)
        );

        INSERT INTO agents_v3
          SELECT id, instance_id, NULL, agent_id, name, model, workspace_path,
                 is_default, role, tags, notes, position_x, position_y,
                 config_hash, synced_at
          FROM agents;

        DROP TABLE agents;
        ALTER TABLE agents_v3 RENAME TO agents;

        -- 3. Recréer agent_links avec FK polymorphe
        CREATE TABLE agent_links_v3 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id     INTEGER REFERENCES instances(id) ON DELETE CASCADE,
          blueprint_id    INTEGER REFERENCES blueprints(id) ON DELETE CASCADE,
          source_agent_id TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          link_type       TEXT NOT NULL CHECK(link_type IN ('a2a', 'spawn')),
          CHECK (
            (instance_id IS NOT NULL AND blueprint_id IS NULL) OR
            (instance_id IS NULL AND blueprint_id IS NOT NULL)
          ),
          UNIQUE(instance_id, source_agent_id, target_agent_id, link_type),
          UNIQUE(blueprint_id, source_agent_id, target_agent_id, link_type)
        );

        INSERT INTO agent_links_v3
          SELECT id, instance_id, NULL, source_agent_id, target_agent_id, link_type
          FROM agent_links;

        DROP TABLE agent_links;
        ALTER TABLE agent_links_v3 RENAME TO agent_links;
      `);
    },
  },
  {
    // v4: remove nginx_domain column from instances table.
    // SQLite < 3.35.0 does not support DROP COLUMN, so we recreate the table.
    // FK enforcement is temporarily disabled to allow DROP TABLE instances
    // (agents and agent_links reference it via ON DELETE CASCADE).
    version: 4,
    up(db) {
      // Disable FK enforcement for the duration of the table swap
      db.pragma("foreign_keys = OFF");
      db.exec(`
        CREATE TABLE instances_v4 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id       INTEGER NOT NULL REFERENCES servers(id),
          slug            TEXT NOT NULL UNIQUE,
          display_name    TEXT,
          port            INTEGER NOT NULL UNIQUE,
          state           TEXT DEFAULT 'unknown' CHECK(state IN ('running','stopped','error','unknown')),
          config_path     TEXT NOT NULL,
          state_dir       TEXT NOT NULL,
          systemd_unit    TEXT NOT NULL,
          telegram_bot    TEXT,
          default_model   TEXT,
          discovered      INTEGER DEFAULT 0,
          created_at      TEXT,
          updated_at      TEXT
        );
        INSERT INTO instances_v4
          SELECT id, server_id, slug, display_name, port, state,
                 config_path, state_dir, systemd_unit, telegram_bot,
                 default_model, discovered, created_at, updated_at
          FROM instances;
        DROP TABLE instances;
        ALTER TABLE instances_v4 RENAME TO instances;
      `);
      // Re-enable FK enforcement
      db.pragma("foreign_keys = ON");
    },
  },
];

// ---------------------------------------------------------------------------
// initDatabase
// ---------------------------------------------------------------------------

export function initDatabase(dbPath: string): Database.Database {
  // Ensure parent directory exists
  const dirPath = path.dirname(dbPath);
  try {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  } catch {
    // Directory already exists
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if schema exists (fresh DB vs existing DB)
  const hasSchema = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();

  if (!hasSchema) {
    // --- Fresh database: create base schema + seed config ---
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION,
    );

    // Insert default config
    const insert = db.prepare(
      "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)",
    );
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      insert.run(key, value);
    }
  }

  // --- Run pending migrations (applies to both fresh and existing DBs) ---
  const row = db
    .prepare("SELECT version FROM schema_version")
    .get() as { version: number } | undefined;
  const currentVersion = row?.version ?? SCHEMA_VERSION;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    // Each migration runs in its own transaction so a failure is atomic
    db.transaction(() => {
      migration.up(db);
      db.prepare("UPDATE schema_version SET version = ?").run(migration.version);
    })();
  }

  return db;
}
