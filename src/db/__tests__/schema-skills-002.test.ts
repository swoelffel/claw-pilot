/**
 * db/__tests__/schema-skills-002.test.ts
 *
 * Tests for SKILLS-002 migration v44 — Structured Skills tables:
 *   - skills, skill_files, agent_skills
 *
 * Uses a real file-based DB (tmpdir), following the existing migration test pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../schema.js";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-skills-002-test-"));
  dbPath = path.join(tmpDir, "test.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SKILLS-002 migration (skills, skill_files, agent_skills)", () => {
  it("creates skills, skill_files, agent_skills tables with expected columns", () => {
    const db = initDatabase(dbPath);

    const skillsCols = db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>;
    const colNames = skillsCols.map((c) => c.name).sort();
    expect(colNames).toEqual(
      [
        "id",
        "instance_slug",
        "name",
        "description",
        "version",
        "source",
        "source_url",
        "config_json",
        "org_id",
        "created_at",
        "updated_at",
      ].sort(),
    );

    const filesCols = (
      db.prepare("PRAGMA table_info(skill_files)").all() as Array<{ name: string }>
    )
      .map((c) => c.name)
      .sort();
    expect(filesCols).toEqual(["id", "skill_id", "path", "content", "hash"].sort());

    const agentSkillsCols = (
      db.prepare("PRAGMA table_info(agent_skills)").all() as Array<{ name: string }>
    )
      .map((c) => c.name)
      .sort();
    expect(agentSkillsCols).toEqual(["agent_id", "skill_id"].sort());

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(indexes).toContain("idx_skills_instance");
    expect(indexes).toContain("idx_skill_files_skill");

    db.close();
  });

  it("cascades skill_files and agent_skills when a skill is deleted", () => {
    const db = initDatabase(dbPath);

    db.prepare(
      "INSERT INTO skills (id, instance_slug, name) VALUES ('s1', 'inst', 'search')",
    ).run();
    db.prepare(
      "INSERT INTO skill_files (skill_id, path, content) VALUES ('s1', 'SKILL.md', '...')",
    ).run();
    db.prepare("INSERT INTO agent_skills (agent_id, skill_id) VALUES ('a1', 's1')").run();

    db.prepare("DELETE FROM skills WHERE id = 's1'").run();

    expect(db.prepare("SELECT COUNT(*) as n FROM skill_files").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) as n FROM agent_skills").get()).toEqual({ n: 0 });

    db.close();
  });

  it("enforces UNIQUE(skill_id, path) on skill_files", () => {
    const db = initDatabase(dbPath);
    db.prepare("INSERT INTO skills (id, instance_slug, name) VALUES ('s1', 'i', 'n')").run();
    db.prepare("INSERT INTO skill_files (skill_id, path, content) VALUES ('s1', 'a', 'x')").run();
    expect(() =>
      db.prepare("INSERT INTO skill_files (skill_id, path, content) VALUES ('s1', 'a', 'y')").run(),
    ).toThrow(/UNIQUE/);
    db.close();
  });
});
