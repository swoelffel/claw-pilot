// src/db/schema.ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

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
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
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
  nginx_domain    TEXT,
  default_model   TEXT,
  discovered      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
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
  created_at      TEXT DEFAULT (datetime('now'))
);
`;

const DEFAULT_CONFIG: Record<string, string> = {
  port_range_start: "18789",
  port_range_end: "18799",
  dashboard_port: "19000",
  health_check_interval_ms: "10000",
  openclaw_user: "openclaw",
};

export function initDatabase(dbPath: string): Database.Database {
  // Ensure parent directory exists
  const dirPath = path.dirname(dbPath);
  try {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  } catch {
    // Ignore if already exists
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if schema exists
  const hasSchema = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();

  if (!hasSchema) {
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

  return db;
}
