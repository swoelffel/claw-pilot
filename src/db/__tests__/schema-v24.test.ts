/**
 * db/__tests__/schema-v24.test.ts
 *
 * Tests for migrations v24–v26:
 *   - v24: Named API keys (named_api_keys, instance_named_keys, agents.named_key_id)
 *   - v25: Simplify named keys (instances.default_named_key_id + backfill)
 *   - v26: System prompt snapshots (rt_system_prompts + index)
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-v24-test-"));
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

/** Return all table names in the DB. */
function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
}

/** Return the current schema version stored in the DB. */
function schemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

// ---------------------------------------------------------------------------
// Suite — Migration v24: Named API keys
// ---------------------------------------------------------------------------

describe("migration v24 — named API keys", () => {
  it("named_api_keys table exists after initDatabase", () => {
    const db = initDatabase(dbPath);
    expect(tableNames(db)).toContain("named_api_keys");
    db.close();
  });

  it("named_api_keys has expected columns", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "named_api_keys");

    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("provider_id");
    expect(cols).toContain("encrypted_api_key");
    expect(cols).toContain("default_model");
    expect(cols).toContain("base_url");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");

    db.close();
  });

  it("instance_named_keys table exists after initDatabase", () => {
    const db = initDatabase(dbPath);
    expect(tableNames(db)).toContain("instance_named_keys");
    db.close();
  });

  it("agents table has named_key_id column", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "agents");
    expect(cols).toContain("named_key_id");
    db.close();
  });

  it("can insert and query a named API key", () => {
    const db = initDatabase(dbPath);

    db.prepare(
      `INSERT INTO named_api_keys (name, provider_id, encrypted_api_key, default_model, base_url)
         VALUES (?, ?, ?, ?, ?)`,
    ).run("my-openai-key", "openai", "enc:aes256gcm:abc123", "gpt-4o", "https://api.openai.com");

    const row = db
      .prepare(
        "SELECT name, provider_id, default_model, base_url FROM named_api_keys WHERE name = ?",
      )
      .get("my-openai-key") as {
      name: string;
      provider_id: string;
      default_model: string;
      base_url: string;
    };

    expect(row.name).toBe("my-openai-key");
    expect(row.provider_id).toBe("openai");
    expect(row.default_model).toBe("gpt-4o");
    expect(row.base_url).toBe("https://api.openai.com");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Suite — Migration v25: instances.default_named_key_id
// ---------------------------------------------------------------------------

describe("migration v25 — instances.default_named_key_id", () => {
  it("instances table has default_named_key_id column", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "instances");
    expect(cols).toContain("default_named_key_id");
    db.close();
  });

  it("default_named_key_id is nullable (defaults to NULL)", () => {
    const db = initDatabase(dbPath);

    // Seed a server + instance without specifying default_named_key_id
    db.prepare(
      `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
    ).run();
    const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
    db.prepare(
      `INSERT OR IGNORE INTO instances
         (server_id, slug, port, config_path, state_dir, systemd_unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(server.id, "v25-test", 19002, "/tmp/cfg.json", "/tmp/state", "test.service");

    const row = db
      .prepare("SELECT default_named_key_id FROM instances WHERE slug = ?")
      .get("v25-test") as { default_named_key_id: number | null };

    expect(row.default_named_key_id).toBeNull();

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Suite — Migration v26: rt_system_prompts
// ---------------------------------------------------------------------------

describe("migration v26 — rt_system_prompts", () => {
  it("rt_system_prompts table exists after initDatabase", () => {
    const db = initDatabase(dbPath);
    expect(tableNames(db)).toContain("rt_system_prompts");
    db.close();
  });

  it("rt_system_prompts has expected columns", () => {
    const db = initDatabase(dbPath);
    const cols = columnNames(db, "rt_system_prompts");

    expect(cols).toContain("id");
    expect(cols).toContain("session_id");
    expect(cols).toContain("prompt_hash");
    expect(cols).toContain("system_prompt");
    expect(cols).toContain("built_at");

    db.close();
  });

  it("idx_rt_system_prompts_session index exists", () => {
    const db = initDatabase(dbPath);
    expect(indexNames(db)).toContain("idx_rt_system_prompts_session");
    db.close();
  });

  it("schema version is 26 after initDatabase", () => {
    const db = initDatabase(dbPath);
    expect(schemaVersion(db)).toBe(30);
    db.close();
  });
});
