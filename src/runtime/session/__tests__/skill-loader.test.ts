import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { createSkill, assignSkillToAgent } from "../../../core/repositories/skill-repository.js";
import { SkillLoader } from "../skill-loader.js";
import { getBus, disposeBus } from "../../bus/index.js";
import { SkillFileUpserted, AgentSkillAssigned } from "../../bus/events.js";

const SLUG = "inst-skill-loader-test";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-loader-"));
  return initDatabase(path.join(dir, "registry.db"));
}

describe("SkillLoader", () => {
  beforeEach(() => disposeBus(SLUG));

  it("returns empty entries when no skills assigned", () => {
    const db = freshDb();
    const loader = new SkillLoader(db, SLUG);
    expect(loader.getEntriesForAgent("a1")).toEqual([]);
    loader.dispose();
  });

  it("returns DB-backed entries for the agent's assigned skills", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: SLUG,
      name: "search",
      files: [{ path: "SKILL.md", content: "---\nname: search\n---\nbody" }],
    });
    assignSkillToAgent(db, "s1", "a1");
    const loader = new SkillLoader(db, SLUG);
    const entries = loader.getEntriesForAgent("a1");
    expect(entries.length).toBe(1);
    expect(entries[0]?.name).toBe("search");
    expect(entries[0]?.content).toContain("body");
    loader.dispose();
  });

  it("caches per agent and invalidates on skill.file.upserted", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: SLUG,
      name: "s",
      files: [{ path: "SKILL.md", content: "---\nname: s\n---\nv1" }],
    });
    assignSkillToAgent(db, "s1", "a1");
    const loader = new SkillLoader(db, SLUG);
    expect(loader.getEntriesForAgent("a1")[0]?.content).toContain("v1");

    db.prepare("UPDATE skill_files SET content = ? WHERE skill_id='s1'").run(
      "---\nname: s\n---\nv2",
    );
    // Without invalidation: cache still serves v1
    expect(loader.getEntriesForAgent("a1")[0]?.content).toContain("v1");

    getBus(SLUG).publish(SkillFileUpserted, {
      instanceSlug: SLUG,
      skillId: "s1",
      path: "SKILL.md",
    });
    expect(loader.getEntriesForAgent("a1")[0]?.content).toContain("v2");
    loader.dispose();
  });

  it("invalidates on agent_skill.assigned", () => {
    const db = freshDb();
    createSkill(db, {
      id: "s1",
      instanceSlug: SLUG,
      name: "s",
      files: [{ path: "SKILL.md", content: "---\nname: s\n---\nx" }],
    });
    const loader = new SkillLoader(db, SLUG);
    expect(loader.getEntriesForAgent("a1").length).toBe(0);

    assignSkillToAgent(db, "s1", "a1");
    getBus(SLUG).publish(AgentSkillAssigned, {
      instanceSlug: SLUG,
      skillId: "s1",
      agentId: "a1",
    });
    expect(loader.getEntriesForAgent("a1").length).toBe(1);
    loader.dispose();
  });
});
