/**
 * runtime/tool/built-in/skill.ts
 *
 * Skill tool — loads a skill file and injects its content into the conversation.
 *
 * Phase 1 features:
 *   1a — 4-level directory hierarchy with workDir support
 *   1b — Frontmatter YAML eligibility check (os, requires.bins, requires.env)
 *   1c — Skill resource files injected alongside SKILL.md content
 *   1d — Permission check via evaluateRuleset (in listAvailableSkills)
 *   1e — listAvailableSkills exported for proactive injection in system-prompt.ts
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Tool } from "../tool.js";
import { evaluateRuleset } from "../../permission/index.js";
import type { RuntimeAgentConfig } from "../../config/index.js";
import { logger } from "../../../lib/logger.js";
import { parseFrontmatter, checkEligibility, type SkillEntry } from "./_skill-frontmatter.js";
import { fetchRemoteSkills } from "./_skill-remote.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { SkillEntry };

// ---------------------------------------------------------------------------
// Phase 1a — 4-level directory hierarchy
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of skill directories to search.
 *
 * Priority (low -> high, last writer wins in deduplication):
 *   Level 1: HOME/.opencode/skill/
 *   Level 2: HOME/.claw-pilot/skills/
 *   Level 3: workDir/.opencode/skill/   (if workDir defined)
 *   Level 4: workDir/skills/            (if workDir defined)
 */
function buildSkillDirs(workDir?: string): string[] {
  const home = os.homedir();
  const dirs: string[] = [
    path.join(home, ".opencode", "skill"),
    path.join(home, ".claw-pilot", "skills"),
  ];
  if (workDir) {
    dirs.push(path.join(workDir, ".opencode", "skill"));
    dirs.push(path.join(workDir, "skills"));
  }
  return dirs;
}

// ---------------------------------------------------------------------------
// Phase 1c — Skill resource files
// ---------------------------------------------------------------------------

/**
 * List all resource files in a skill directory (excluding SKILL.md).
 * Returns absolute paths, sorted, max 10 files.
 */
async function listSkillResources(skillDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (results.length >= 10) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.debug("[tool:skill] readdir for resources failed", { error: String(err) });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= 10) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name !== "SKILL.md") {
        results.push(fullPath);
      }
    }
  }

  await walk(skillDir);
  return results.sort();
}

// ---------------------------------------------------------------------------
// Phase 1a+1b+1d — listAvailableSkills (exported for system-prompt.ts)
// ---------------------------------------------------------------------------

/**
 * Discover all available and eligible skills across the 4-level hierarchy.
 *
 * - Deduplication: last directory wins (higher priority overrides lower)
 * - Eligibility: frontmatter os/requires checks (Phase 1b)
 * - Permission filtering: skills denied by agentConfig.permissions are excluded (Phase 1d)
 *
 * @param workDir  Working directory of the instance (optional)
 * @param agentConfig  Agent config for permission filtering (optional)
 */
export async function listAvailableSkills(
  workDir?: string,
  agentConfig?: RuntimeAgentConfig,
): Promise<SkillEntry[]> {
  const dirs = buildSkillDirs(workDir);
  const seen = new Map<string, SkillEntry>();

  // Phase 2 — Remote skills (lowest priority — overridden by local skills)
  if (agentConfig?.skillUrls?.length) {
    const remoteSkills = await fetchRemoteSkills(agentConfig.skillUrls);
    for (const skill of remoteSkills) {
      if (!seen.has(skill.name)) {
        seen.set(skill.name, skill);
      }
    }
  }

  // Scan local directories
  await scanLocalSkillDirs(dirs, seen);

  // Phase 1d — Filter by agent permissions
  let skills = [...seen.values()];
  skills = filterByPermissions(skills, agentConfig);

  // Phase 1e — Filter by skill whitelist (null/undefined = all)
  if (agentConfig?.skills != null) {
    const allowSet = new Set(agentConfig.skills);
    return skills.filter((s) => allowSet.has(s.name));
  }

  return skills;
}

/**
 * Scan local skill directories and populate the seen map.
 * Later directories override earlier ones (higher priority).
 */
async function scanLocalSkillDirs(dirs: string[], seen: Map<string, SkillEntry>): Promise<void> {
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.debug("[tool:skill] skill directory inaccessible", { error: String(err) });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await processLocalSkill(dir, entry.name, seen);
    }
  }
}

/**
 * Process a single local skill directory and add to seen map if eligible.
 */
async function processLocalSkill(
  dir: string,
  skillName: string,
  seen: Map<string, SkillEntry>,
): Promise<void> {
  const skillDir = path.join(dir, skillName);
  const skillFile = path.join(skillDir, "SKILL.md");

  let content: string;
  try {
    content = await fs.readFile(skillFile, "utf-8");
  } catch (err) {
    logger.debug("[tool:skill] SKILL.md not found in directory", { error: String(err) });
    return;
  }

  const frontmatter = parseFrontmatter(content);
  let eligible: boolean;
  try {
    eligible = await checkEligibility(frontmatter);
  } catch (err) {
    logger.debug("[tool:skill] eligibility check failed", { error: String(err) });
    eligible = true;
  }
  if (!eligible) return;

  seen.set(skillName, {
    name: skillName,
    dir: skillDir,
    path: skillFile,
    content,
    ...(frontmatter.description !== undefined ? { description: frontmatter.description } : {}),
  });
}

/**
 * Filter skills by agent permissions (Phase 1d).
 */
function filterByPermissions(skills: SkillEntry[], agentConfig?: RuntimeAgentConfig): SkillEntry[] {
  if (!agentConfig || agentConfig.permissions.length === 0) return skills;
  return skills.filter((skill) => {
    const result = evaluateRuleset(agentConfig.permissions, "skill", skill.name);
    return result.action !== "deny";
  });
}

// ---------------------------------------------------------------------------
// Resolution helpers (DB-first then filesystem)
// ---------------------------------------------------------------------------

function formatSkillOutput(
  skillName: string,
  content: string,
  files: Array<{ path: string }>,
): string {
  let output = `<skill_content name="${skillName}">\n${content}\n</skill_content>`;
  if (files.length > 0) {
    const fileList = files.map((f) => `  <file path="${f.path}" />`).join("\n");
    output += `\n\n<skill_files>\n${fileList}\n</skill_files>`;
  }
  return output;
}

/**
 * SKILLS-003 — DB-backed resolution. Returns null if no match.
 */
function resolveDbSkill(
  skillName: string,
  ctx: { skillLoader?: import("../../session/skill-loader.js").SkillLoader; agentId?: string },
): Tool.Result | null {
  if (!ctx.skillLoader || !ctx.agentId) return null;
  const dbSkills = ctx.skillLoader.getEntriesForAgent(ctx.agentId);
  const match = dbSkills.find((s) => s.name === skillName);
  if (!match) return null;

  const skillFile = match.files.find((f) => f.path === "SKILL.md");
  const content = skillFile ? skillFile.content : match.content;
  const otherFiles = match.files.filter((f) => f.path !== "SKILL.md");

  return {
    title: `Skill: ${skillName}`,
    output: formatSkillOutput(skillName, content, otherFiles),
    truncated: false,
  };
}

/**
 * Filesystem hierarchy resolution. Returns null if no match.
 */
async function resolveFsSkill(
  skillName: string,
  instanceRoot: string,
): Promise<Tool.Result | null> {
  const dirs = buildSkillDirs(instanceRoot);
  for (const dir of dirs) {
    const skillFile = path.join(dir, skillName, "SKILL.md");
    let content: string;
    try {
      content = await fs.readFile(skillFile, "utf-8");
    } catch (err) {
      logger.debug("[tool:skill] skill file not found in directory", { error: String(err) });
      continue;
    }
    const resources = await listSkillResources(path.join(dir, skillName));
    return {
      title: `Skill: ${skillName}`,
      output: formatSkillOutput(
        skillName,
        content,
        resources.map((p) => ({ path: p })),
      ),
      truncated: false,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const SkillTool = Tool.define("skill", {
  description:
    "Load a specialized skill that provides domain-specific instructions and workflows.\n\n" +
    "When you recognize that a task matches one of the available skills listed below, " +
    "use this tool to load the full skill instructions.\n\n" +
    "The skill will inject detailed instructions, workflows, and access to bundled resources " +
    "(scripts, references, templates) into the conversation context.\n\n" +
    'Tool output includes a `<skill_content name="...">` block with the loaded content.',
  parameters: z.object({
    name: z
      .string()
      .describe(
        "The name of the skill from available_skills (e.g., 'web-artifacts-builder', 'docx', ...)",
      ),
  }),
  async execute(params, ctx) {
    const skillName = params.name.replace(/[^a-zA-Z0-9_-]/g, "");

    if (!skillName) {
      throw new Error(
        "Invalid skill name: must contain alphanumeric characters, hyphens, or underscores.",
      );
    }

    // 1. DB-backed resolution (SKILLS-003)
    const dbResult = resolveDbSkill(skillName, ctx);
    if (dbResult) return dbResult;

    // 2. Whitelist guard (filesystem only)
    if (ctx.agentConfig?.skills != null && !new Set(ctx.agentConfig.skills).has(skillName)) {
      return {
        title: "skill",
        output: `Skill "${skillName}" is not available for this agent.`,
        truncated: false,
      };
    }

    // 3. Filesystem hierarchy (legacy)
    const instanceRoot = ctx.workDir ?? process.cwd();
    const fsResult = await resolveFsSkill(skillName, instanceRoot);
    if (fsResult) return fsResult;

    // 4. Not found
    const available = await listAvailableSkills(instanceRoot);
    const dbNames =
      ctx.skillLoader && ctx.agentId
        ? ctx.skillLoader.getEntriesForAgent(ctx.agentId).map((s) => s.name)
        : [];
    const allNames = [...new Set([...available.map((s) => s.name), ...dbNames])];
    const hint =
      allNames.length > 0
        ? `\n\nAvailable skills: ${allNames.join(", ")}`
        : "\n\nNo skills found in skill directories.";

    throw new Error(`Skill not found: ${skillName}${hint}`);
  },
});
