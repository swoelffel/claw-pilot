// src/core/skills/__tests__/_skill-migration.test.ts
//
// Tests for the one-shot legacy `agent_files` → structured skills migration.
// Uses real on-disk DBs via `initDatabase` so we exercise the full migration
// stack (including the v45 wiring).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { migrateLegacySkills } from "../_skill-migration.js";

function freshDbWithLegacyFiles(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-mig-"));
  const db = initDatabase(path.join(dir, "registry.db"));

  db.prepare("INSERT INTO servers (hostname, openclaw_home) VALUES ('h','/o')").run();
  db.prepare(
    `INSERT INTO instances
       (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (1, 'inst', 19010, '/c', '/s', 'u')`,
  ).run();
  db.prepare(
    `INSERT INTO agents (instance_id, agent_id, name, workspace_path)
     VALUES (1, 'a1', 'A', '/w')`,
  ).run();

  const agentRowId = (
    db.prepare("SELECT id FROM agents WHERE agent_id = ?").get("a1") as { id: number }
  ).id;

  db.prepare("INSERT INTO agent_files (agent_id, filename, content) VALUES (?, ?, ?)").run(
    agentRowId,
    ".opencode/skill/search/SKILL.md",
    "---\nname: search\nversion: 1.0.0\n---\nbody",
  );
  db.prepare("INSERT INTO agent_files (agent_id, filename, content) VALUES (?, ?, ?)").run(
    agentRowId,
    ".opencode/skill/search/tools/x.ts",
    "export const x = 1;",
  );

  // Pre-clean any audit rows the migration itself may have written when the
  // DB was first opened (depending on wiring order). The migration we exercise
  // here is the explicit one-shot call.
  db.prepare("DELETE FROM rt_audit_events WHERE kind = 'skills_migration'").run();

  return db;
}

describe("migrateLegacySkills", () => {
  it("creates a skills row and assigns it to the owning agent", () => {
    const db = freshDbWithLegacyFiles();
    // Reset any pre-existing skill rows the boot-time wiring may have created.
    db.prepare("DELETE FROM agent_skills").run();
    db.prepare("DELETE FROM skill_files").run();
    db.prepare("DELETE FROM skills").run();

    const report = migrateLegacySkills(db);
    expect(report.migrated).toBe(1);
    expect(report.skipped).toBe(0);

    const skill = db.prepare("SELECT name, instance_slug FROM skills").get();
    expect(skill).toEqual({ name: "search", instance_slug: "inst" });
    const files = db.prepare("SELECT path FROM skill_files ORDER BY path").all();
    expect(files).toEqual([{ path: "SKILL.md" }, { path: "tools/x.ts" }]);
    const link = db.prepare("SELECT agent_id FROM agent_skills").get();
    expect(link).toEqual({ agent_id: "a1" });
  });

  it("is idempotent — running twice does not duplicate", () => {
    const db = freshDbWithLegacyFiles();
    db.prepare("DELETE FROM agent_skills").run();
    db.prepare("DELETE FROM skill_files").run();
    db.prepare("DELETE FROM skills").run();

    migrateLegacySkills(db);
    migrateLegacySkills(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM skills").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM skill_files").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_skills").get()).toEqual({ n: 1 });
  });

  it("skips a directory without SKILL.md and logs it in the report", () => {
    const db = freshDbWithLegacyFiles();
    db.prepare("DELETE FROM agent_skills").run();
    db.prepare("DELETE FROM skill_files").run();
    db.prepare("DELETE FROM skills").run();

    const agentRowId = (
      db.prepare("SELECT id FROM agents WHERE agent_id = ?").get("a1") as { id: number }
    ).id;
    db.prepare("INSERT INTO agent_files (agent_id, filename, content) VALUES (?, ?, ?)").run(
      agentRowId,
      ".opencode/skill/broken/README.md",
      "no manifest",
    );

    const report = migrateLegacySkills(db);
    expect(report.migrated).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/SKILL\.md/);
  });

  it("writes an audit row in rt_audit_events when audit_events table exists", () => {
    const db = freshDbWithLegacyFiles();
    db.prepare("DELETE FROM agent_skills").run();
    db.prepare("DELETE FROM skill_files").run();
    db.prepare("DELETE FROM skills").run();

    migrateLegacySkills(db);
    const audit = db
      .prepare("SELECT kind FROM rt_audit_events WHERE kind = 'skills_migration'")
      .get();
    expect(audit).toBeDefined();
  });
});
