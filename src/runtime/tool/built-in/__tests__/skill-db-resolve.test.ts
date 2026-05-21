import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../../db/schema.js";
import { SkillLoader } from "../../../session/skill-loader.js";
import { SkillTool } from "../skill.js";
import {
  createSkill,
  upsertSkillFile,
  assignSkillToAgent,
} from "../../../../core/repositories/skill-repository.js";
import { disposeBus } from "../../../bus/index.js";
import type { RuntimeAgentConfig } from "../../../config/index.js";

const SLUG = "inst-skill-tool-db";

let tmpDir: string;
let db: Database.Database;
let loader: SkillLoader;

const baseAgent: RuntimeAgentConfig = {
  id: "agent-A",
  name: "Agent A",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 10,
  allowSubAgents: false,
  toolProfile: "executor",
  isDefault: false,
};

beforeEach(() => {
  disposeBus(SLUG);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-003-tool-"));
  db = initDatabase(path.join(tmpDir, "registry.db"));
  loader = new SkillLoader(db, SLUG);
});

afterEach(() => {
  loader.dispose();
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("skill tool — DB resolution", () => {
  it("[positive] resolves an assigned DB skill and returns content + files", async () => {
    const skill = createSkill(db, {
      id: "sk-1",
      instanceSlug: SLUG,
      name: "hello-world",
      description: "Greet",
      source: "blank",
      files: [],
    });
    upsertSkillFile(db, skill.id, "SKILL.md", "# Hello\nDo X then Y.");
    upsertSkillFile(db, skill.id, "examples.md", "# Example\nfoo");
    assignSkillToAgent(db, skill.id, "agent-A");

    const def = await SkillTool.init();
    const result = await def.execute(
      { name: "hello-world" },
      {
        sessionId: "s",
        messageId: "m",
        agentId: "agent-A",
        abort: new AbortController().signal,
        agentConfig: baseAgent,
        skillLoader: loader,
        workDir: tmpDir,
        metadata: () => {},
      },
    );

    expect(result.output).toContain('<skill_content name="hello-world">');
    expect(result.output).toContain("Do X then Y.");
    expect(result.output).toContain("<skill_files>");
    expect(result.output).toContain('path="examples.md"');
  });

  it("[negative] unassigned DB skill is not resolved (FS fallback finds nothing → throws)", async () => {
    const skill = createSkill(db, {
      id: "sk-2",
      instanceSlug: SLUG,
      name: "unassigned",
      description: null,
      source: "blank",
      files: [],
    });
    upsertSkillFile(db, skill.id, "SKILL.md", "body");

    const def = await SkillTool.init();
    await expect(
      def.execute(
        { name: "unassigned" },
        {
          sessionId: "s",
          messageId: "m",
          agentId: "agent-A",
          abort: new AbortController().signal,
          agentConfig: baseAgent,
          skillLoader: loader,
          workDir: tmpDir,
          metadata: () => {},
        },
      ),
    ).rejects.toThrow(/Skill not found/);
  });
});
