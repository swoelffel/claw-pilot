/**
 * runtime/tool/built-in/skill.ts
 *
 * Skill tool — loads a skill file and injects its content into the conversation.
 * Skills are markdown files in .opencode/skill/ directories.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../tool.js";

/** Directories to search for skills (in priority order) */
const SKILL_DIRS = [
  path.join(process.cwd(), ".opencode", "skill"),
  path.join(process.env["HOME"] ?? "~", ".opencode", "skill"),
];

export const SkillTool = Tool.define("skill", {
  description:
    "Load a specialized skill that provides domain-specific instructions and workflows. " +
    "Skills are markdown files stored in .opencode/skill/ directories. " +
    "Use this when a task matches a known skill (e.g. 'web-artifacts-builder', 'docx', etc.).",
  parameters: z.object({
    name: z
      .string()
      .describe(
        "The name of the skill to load (e.g. 'web-artifacts-builder', 'docx'). " +
          "This corresponds to a directory name in .opencode/skill/.",
      ),
  }),
  async execute(params) {
    const skillName = params.name.replace(/[^a-zA-Z0-9_-]/g, "");

    for (const dir of SKILL_DIRS) {
      const skillFile = path.join(dir, skillName, "SKILL.md");
      try {
        const content = await fs.readFile(skillFile, "utf-8");
        return {
          title: `Skill: ${skillName}`,
          output: `<skill_content name="${skillName}">\n${content}\n</skill_content>`,
          truncated: false,
        };
      } catch {
        // Try next directory
      }
    }

    // List available skills
    const available: string[] = [];
    for (const dir of SKILL_DIRS) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) available.push(entry.name);
        }
      } catch {
        // ignore
      }
    }

    const hint =
      available.length > 0
        ? `\n\nAvailable skills: ${available.join(", ")}`
        : "\n\nNo skills found in .opencode/skill/ directories.";

    throw new Error(`Skill not found: ${skillName}${hint}`);
  },
});
