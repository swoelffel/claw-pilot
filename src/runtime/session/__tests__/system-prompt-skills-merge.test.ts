import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../db/schema.js";
import { SkillLoader } from "../skill-loader.js";
import { buildSkillsBlock } from "../system-prompt.js";
import {
  createSkill,
  upsertSkillFile,
  assignSkillToAgent,
} from "../../../core/repositories/skill-repository.js";
import { disposeBus } from "../../bus/index.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

const SLUG = "inst-skills-merge";

let tmpDir: string;
let db: Database.Database;
let loader: SkillLoader;

const baseAgent: RuntimeAgentConfig = {
  id: "agent-A",
  name: "Agent A",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: false,
  toolProfile: "executor",
  isDefault: false,
};

beforeEach(() => {
  disposeBus(SLUG);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-003-merge-"));
  const dbPath = path.join(tmpDir, "registry.db");
  db = initDatabase(dbPath);
  loader = new SkillLoader(db, SLUG);
});

afterEach(() => {
  loader.dispose();
  db.close();
  disposeBus(SLUG);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildSkillsBlock — DB merge", () => {
  it("[positive] DB skill assigned to agent appears in <available_skills>", async () => {
    const skill = createSkill(db, {
      id: "sk-1",
      instanceSlug: SLUG,
      name: "hello-world",
      description: "Say hello",
      source: "blank",
      files: [],
    });
    upsertSkillFile(db, skill.id, "SKILL.md", "---\nname: hello-world\n---\nGreet the user.");
    assignSkillToAgent(db, skill.id, "agent-A");

    const block = await buildSkillsBlock(tmpDir, baseAgent, "hi", loader);

    expect(block).toBeDefined();
    expect(block).toContain("<available_skills>");
    expect(block).toContain('name="hello-world"');
    expect(block).toContain('description="Say hello"');
  });

  it("[negative] DB skill NOT assigned is absent from the block", async () => {
    const skill = createSkill(db, {
      id: "sk-2",
      instanceSlug: SLUG,
      name: "unassigned-skill",
      description: "Should not appear",
      source: "blank",
      files: [],
    });
    upsertSkillFile(db, skill.id, "SKILL.md", "---\nname: unassigned-skill\n---\nbody");

    const block = await buildSkillsBlock(tmpDir, baseAgent, "hi", loader);
    expect(block).toBeUndefined();
  });

  it("[positive] FS skill + DB skill — both listed, DB wins on name collision", async () => {
    const fsSkillDir = path.join(tmpDir, "skills", "hello-world");
    fs.mkdirSync(fsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(fsSkillDir, "SKILL.md"),
      "---\nname: hello-world\ndescription: FS version\n---\n",
    );

    const skill = createSkill(db, {
      id: "sk-3",
      instanceSlug: SLUG,
      name: "hello-world",
      description: "DB version",
      source: "blank",
      files: [],
    });
    upsertSkillFile(db, skill.id, "SKILL.md", "---\nname: hello-world\n---\nbody");
    assignSkillToAgent(db, skill.id, "agent-A");

    const block = await buildSkillsBlock(tmpDir, baseAgent, "hi", loader);
    expect(block).toContain('description="DB version"');
    expect(block).not.toContain('description="FS version"');
  });
});
