// src/db/__tests__/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { initDatabase } from "../schema.js";
import { Registry } from "../../core/registry.js";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-test-"));
  dbPath = path.join(tmpDir, "test.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the list of table names in the DB. */
function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
}

/** Return the column names of a table. */
function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

/** Return the current schema version stored in the DB. */
function schemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

/** Build a v1 database (base schema, no migrations applied). */
function buildV1Db(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (1);

    CREATE TABLE servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      ip TEXT,
      openclaw_home TEXT NOT NULL,
      openclaw_bin TEXT,
      openclaw_version TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL REFERENCES servers(id),
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT,
      port INTEGER NOT NULL UNIQUE,
      state TEXT DEFAULT 'unknown',
      config_path TEXT NOT NULL,
      state_dir TEXT NOT NULL,
      systemd_unit TEXT NOT NULL,
      telegram_bot TEXT,
      default_model TEXT,
      discovered INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      model TEXT,
      workspace_path TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      UNIQUE(instance_id, agent_id)
    );

    CREATE TABLE ports (
      server_id INTEGER NOT NULL REFERENCES servers(id),
      port INTEGER NOT NULL,
      instance_slug TEXT,
      PRIMARY KEY (server_id, port)
    );

    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_slug TEXT,
      event_type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT
    );
  `);
  return db;
}

/** Seed a server + instance + agent into a v1 DB for migration data-integrity tests. */
function seedV1Data(db: Database.Database): {
  serverId: number;
  instanceId: number;
  agentId: number;
} {
  db.prepare(
    "INSERT INTO servers (hostname, openclaw_home, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run("host1", "/opt/openclaw", "2024-01-01", "2024-01-01");
  const serverId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    `INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    serverId,
    "test-inst",
    18789,
    "/opt/openclaw/.openclaw-test-inst/openclaw.json",
    "/run/user/1000/openclaw-test-inst",
    "openclaw-test-inst.service",
    "2024-01-01",
    "2024-01-01",
  );
  const instanceId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO agents (instance_id, agent_id, name, workspace_path) VALUES (?, ?, ?, ?)",
  ).run(instanceId, "agent-1", "Agent One", "/workspace/agent-1");
  const agentId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  return { serverId, instanceId, agentId };
}

// ---------------------------------------------------------------------------
// Tests — fresh database
// ---------------------------------------------------------------------------

describe("initDatabase — fresh database", () => {
  it("creates all expected tables", () => {
    const db = initDatabase(dbPath);
    const names = tableNames(db);
    expect(names).toContain("instances");
    expect(names).toContain("agents");
    expect(names).toContain("servers");
    expect(names).toContain("ports");
    expect(names).toContain("config");
    expect(names).toContain("events");
    expect(names).toContain("agent_files");
    expect(names).toContain("agent_links");
    expect(names).toContain("blueprints");
    // v6: auth tables
    expect(names).toContain("users");
    expect(names).toContain("sessions");
    db.close();
  });

  it("inserts default config values", () => {
    const db = initDatabase(dbPath);
    const registry = new Registry(db);
    expect(registry.getConfig("port_range_start")).toBe("18789");
    expect(registry.getConfig("port_range_end")).toBe("18838");
    expect(registry.getConfig("dashboard_port")).toBe("19000");
    db.close();
  });

  it("reaches the latest schema version (15)", () => {
    const db = initDatabase(dbPath);
    expect(schemaVersion(db)).toBe(18);
    db.close();
  });

  it("agents table has v2 enriched columns", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "agents");
    expect(cols).toContain("role");
    expect(cols).toContain("tags");
    expect(cols).toContain("notes");
    expect(cols).toContain("position_x");
    expect(cols).toContain("position_y");
    expect(cols).toContain("config_hash");
    expect(cols).toContain("synced_at");
    db.close();
  });

  it("agents table has v3 polymorphic FK columns", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "agents");
    expect(cols).toContain("instance_id");
    expect(cols).toContain("blueprint_id");
    db.close();
  });

  it("instances table does NOT have nginx_domain column (v4 removed it)", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "instances");
    expect(cols).not.toContain("nginx_domain");
    db.close();
  });

  it("is idempotent — second call does not error", () => {
    const db1 = initDatabase(dbPath);
    db1.close();
    const db2 = initDatabase(dbPath);
    db2.close();
  });
});

// ---------------------------------------------------------------------------
// Tests — migration v1 → v4
// ---------------------------------------------------------------------------

describe("migration v1 → v4", () => {
  it("applies all migrations and reaches version 14", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    expect(schemaVersion(db)).toBe(18);
    db.close();
  });

  it("v2: creates agent_files and agent_links tables", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    const names = tableNames(db);
    expect(names).toContain("agent_files");
    expect(names).toContain("agent_links");
    db.close();
  });

  it("v2: adds enriched columns to agents", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    const cols = columnNames(db, "agents");
    expect(cols).toContain("role");
    expect(cols).toContain("tags");
    expect(cols).toContain("notes");
    expect(cols).toContain("config_hash");
    expect(cols).toContain("synced_at");
    db.close();
  });

  it("v3: creates blueprints table", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    expect(tableNames(db)).toContain("blueprints");
    db.close();
  });

  it("v3: agents table has polymorphic blueprint_id column", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    expect(columnNames(db, "agents")).toContain("blueprint_id");
    db.close();
  });

  it("v4: instances table does not have nginx_domain", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    expect(columnNames(db, "instances")).not.toContain("nginx_domain");
    db.close();
  });

  it("preserves existing instance data through all migrations", () => {
    const v1 = buildV1Db(dbPath);
    seedV1Data(v1);
    v1.close();

    const db = initDatabase(dbPath);
    const registry = new Registry(db);
    const instance = registry.getInstance("test-inst");
    expect(instance).toBeDefined();
    expect(instance!.slug).toBe("test-inst");
    expect(instance!.port).toBe(18789);
    db.close();
  });

  it("preserves existing agent data through all migrations", () => {
    const v1 = buildV1Db(dbPath);
    seedV1Data(v1);
    v1.close();

    const db = initDatabase(dbPath);
    const registry = new Registry(db);
    const agents = registry.listAgents("test-inst");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.agent_id).toBe("agent-1");
    expect(agents[0]!.name).toBe("Agent One");
    // v2 enriched columns should be null (not set before migration)
    expect(agents[0]!.role).toBeNull();
    expect(agents[0]!.config_hash).toBeNull();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Tests — migration v2 → v4 (partial migration path)
// ---------------------------------------------------------------------------

describe("migration v2 → v4", () => {
  it("v12: rt_pairing_codes table has meta column", () => {
    const v1 = buildV1Db(dbPath);
    v1.close();

    const db = initDatabase(dbPath);
    const cols = columnNames(db, "rt_pairing_codes");
    expect(cols).toContain("meta");
    db.close();
  });

  it("applies only v3, v4, v5, v6 and v7 migrations when starting from v2", () => {
    // Build v1 then apply v2 manually
    const v1 = buildV1Db(dbPath);
    seedV1Data(v1);
    v1.exec(`
      CREATE TABLE IF NOT EXISTS agent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content TEXT,
        content_hash TEXT,
        updated_at TEXT,
        UNIQUE(agent_id, filename)
      );
      CREATE TABLE IF NOT EXISTS agent_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
        source_agent_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        link_type TEXT NOT NULL CHECK(link_type IN ('a2a', 'spawn')),
        UNIQUE(instance_id, source_agent_id, target_agent_id, link_type)
      );
      ALTER TABLE agents ADD COLUMN role TEXT;
      ALTER TABLE agents ADD COLUMN tags TEXT;
      ALTER TABLE agents ADD COLUMN notes TEXT;
      ALTER TABLE agents ADD COLUMN position_x REAL;
      ALTER TABLE agents ADD COLUMN position_y REAL;
      ALTER TABLE agents ADD COLUMN config_hash TEXT;
      ALTER TABLE agents ADD COLUMN synced_at TEXT;
      UPDATE schema_version SET version = 2;
    `);
    v1.close();

    const db = initDatabase(dbPath);
    expect(schemaVersion(db)).toBe(18);
    expect(tableNames(db)).toContain("blueprints");
    expect(tableNames(db)).toContain("users");
    expect(tableNames(db)).toContain("sessions");
    expect(columnNames(db, "agents")).toContain("blueprint_id");
    expect(columnNames(db, "agents")).toContain("skills");
    expect(columnNames(db, "instances")).not.toContain("nginx_domain");
    expect(columnNames(db, "rt_pairing_codes")).toContain("meta");

    // Data preserved
    const registry = new Registry(db);
    const instance = registry.getInstance("test-inst");
    expect(instance).toBeDefined();
    const agents = registry.listAgents("test-inst");
    expect(agents).toHaveLength(1);
    db.close();
  });
});
