import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import {
  createSkill,
  getSkillWithFiles,
  listSkillsByInstance,
  updateSkillMeta,
  upsertSkillFile,
  deleteSkillFile,
  deleteSkill,
  assignSkillToAgent,
  unassignSkillFromAgent,
  listSkillsByAgent,
} from "../skill-repository.js";

function freshDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-repo-"));
  const dbPath = path.join(dir, "registry.db");
  return initDatabase(dbPath);
}

describe("skill-repository", () => {
  it("creates a skill with files and reads it back", () => {
    const db = freshDb();
    const skill = createSkill(db, {
      id: "s1",
      instanceSlug: "inst",
      name: "search",
      description: "Web search",
      version: "1.0.0",
      source: "blank",
      configJson: null,
      files: [
        { path: "SKILL.md", content: "---\nname: search\n---\nbody" },
        { path: "tools/x.ts", content: "export const x = 1;" },
      ],
    });
    expect(skill.id).toBe("s1");

    const got = getSkillWithFiles(db, "s1");
    expect(got?.skill.name).toBe("search");
    expect(got?.files.length).toBe(2);
    expect(got?.files[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lists skills scoped by instance with fileCount and agentCount", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "a",
      name: "x",
      files: [{ path: "SKILL.md", content: "x" }],
    });
    createSkill(db, {
      id: "s2",
      instanceSlug: "b",
      name: "y",
      files: [{ path: "SKILL.md", content: "y" }],
    });
    assignSkillToAgent(db, "s1", "agent-1");

    const a = listSkillsByInstance(db, "a");
    expect(a.length).toBe(1);
    expect(a[0]?.fileCount).toBe(1);
    expect(a[0]?.agentCount).toBe(1);

    const b = listSkillsByInstance(db, "b");
    expect(b[0]?.agentCount).toBe(0);
  });

  it("upsertSkillFile creates then updates content + hash + touches skills.updated_at", async () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "i",
      name: "n",
      files: [{ path: "SKILL.md", content: "a" }],
    });
    const before = (
      db.prepare("SELECT updated_at FROM skills WHERE id='s1'").get() as {
        updated_at: string;
      }
    ).updated_at;
    await new Promise((r) => setTimeout(r, 1100));

    upsertSkillFile(db, "s1", "SKILL.md", "b");
    const f = db
      .prepare("SELECT content, hash FROM skill_files WHERE skill_id='s1' AND path='SKILL.md'")
      .get() as { content: string; hash: string };
    expect(f.content).toBe("b");

    const after = (
      db.prepare("SELECT updated_at FROM skills WHERE id='s1'").get() as {
        updated_at: string;
      }
    ).updated_at;
    expect(after).not.toBe(before);
  });

  it("deleteSkill cascades skill_files and agent_skills", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "i",
      name: "n",
      files: [{ path: "SKILL.md", content: "x" }],
    });
    assignSkillToAgent(db, "s1", "a1");
    deleteSkill(db, "s1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM skill_files").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_skills").get()).toEqual({ n: 0 });
  });

  it("listSkillsByAgent returns only assigned skills with files", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "i",
      name: "n1",
      files: [{ path: "SKILL.md", content: "1" }],
    });
    createSkill(db, {
      id: "s2",
      instanceSlug: "i",
      name: "n2",
      files: [{ path: "SKILL.md", content: "2" }],
    });
    assignSkillToAgent(db, "s2", "a1");

    const got = listSkillsByAgent(db, "a1");
    expect(got.length).toBe(1);
    expect(got[0]?.skill.id).toBe("s2");
  });

  it("rejects file content larger than 1 MB", () => {
    const db = freshDb();
    const big = "x".repeat(1_048_577);
    expect(() =>
      createSkill(db, {
        id: "s1",
        instanceSlug: "i",
        name: "n",
        files: [{ path: "SKILL.md", content: big }],
      }),
    ).toThrow(/1 MB|too large/i);
  });

  it("deleteSkillFile removes a single file and touches updated_at", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "i",
      name: "n",
      files: [
        { path: "SKILL.md", content: "a" },
        { path: "extra.txt", content: "b" },
      ],
    });
    deleteSkillFile(db, "s1", "extra.txt");
    const got = getSkillWithFiles(db, "s1");
    expect(got?.files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });

  it("unassignSkillFromAgent removes the link", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "i",
      name: "n",
      files: [{ path: "SKILL.md", content: "x" }],
    });
    assignSkillToAgent(db, "s1", "a1");
    unassignSkillFromAgent(db, "s1", "a1");
    expect(listSkillsByAgent(db, "a1")).toEqual([]);
  });

  it("updateSkillMeta updates name/description and bumps updated_at", async () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: "i",
      name: "old",
      files: [{ path: "SKILL.md", content: "x" }],
    });
    const before = (
      db.prepare("SELECT updated_at FROM skills WHERE id='s1'").get() as {
        updated_at: string;
      }
    ).updated_at;
    await new Promise((r) => setTimeout(r, 1100));
    const updated = updateSkillMeta(db, "s1", { name: "new", description: "d" });
    expect(updated?.name).toBe("new");
    expect(updated?.description).toBe("d");
    const after = (
      db.prepare("SELECT updated_at FROM skills WHERE id='s1'").get() as {
        updated_at: string;
      }
    ).updated_at;
    expect(after).not.toBe(before);
  });
});
