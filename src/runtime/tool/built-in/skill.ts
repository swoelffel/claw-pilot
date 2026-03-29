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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "../tool.js";
import { evaluateRuleset } from "../../permission/index.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed frontmatter from a SKILL.md file */
interface SkillFrontmatter {
  name?: string;
  description?: string;
  os?: string | string[];
  requires?: {
    bins?: string[];
    env?: string[];
  };
}

/** A discovered skill entry */
export interface SkillEntry {
  /** Skill directory name (used as skill identifier) */
  name: string;
  /** Absolute path to the skill directory (for resource listing) */
  dir: string;
  /** Absolute path to SKILL.md */
  path: string;
  /** Description extracted from frontmatter (Phase 1b) */
  description?: string;
  /** Cached SKILL.md content (Phase 1b) */
  content?: string;
}

// ---------------------------------------------------------------------------
// Phase 2 — Remote skills cache directory
// ---------------------------------------------------------------------------

const SKILL_CACHE_DIR = path.join(os.homedir(), ".cache", "claw-pilot", "skills");

/** Shape of a remote skill index JSON file */
interface RemoteSkillIndex {
  skills: Array<{
    name: string;
    description?: string;
    url: string;
  }>;
}

/**
 * Fetch remote skills from a list of index URLs and cache them locally.
 *
 * - Each URL is fetched with a 10s timeout.
 * - HTTP errors and network failures are silently ignored.
 * - Cache is permanent (no TTL) — delete ~/.cache/claw-pilot/skills/ to refresh.
 * - A local cache hit skips the remote fetch entirely.
 *
 * @param skillUrls  List of remote skill index URLs
 * @returns          List of SkillEntry for all successfully fetched/cached skills
 */
async function fetchRemoteSkills(skillUrls: string[]): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];

  for (const indexUrl of skillUrls) {
    // Fetch the index with a 10s timeout
    let index: RemoteSkillIndex;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(indexUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) continue;
      const raw = await response.json();
      index = raw as RemoteSkillIndex;
    } catch {
      // Network error, timeout, or JSON parse failure — skip silently
      continue;
    }

    // Validate index shape
    if (!Array.isArray(index.skills)) continue;

    for (const skill of index.skills) {
      // Validate required fields
      if (!skill.name || typeof skill.name !== "string" || !skill.name.trim()) continue;
      if (!skill.url || typeof skill.url !== "string" || !skill.url.trim()) continue;

      const localDir = path.join(SKILL_CACHE_DIR, skill.name);
      const localPath = path.join(localDir, "SKILL.md");

      // Cache hit — reuse existing file
      try {
        await fs.access(localPath);
        // File exists — use cache
        result.push({
          name: skill.name,
          dir: localDir,
          path: localPath,
          ...(skill.description !== undefined ? { description: skill.description } : {}),
        });
        continue;
      } catch {
        // Cache miss — proceed to download
      }

      // Cache miss — fetch the skill content
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        let skillResponse: Response;
        try {
          skillResponse = await fetch(skill.url, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!skillResponse.ok) continue;
        const content = await skillResponse.text();

        // Write to cache (create directory if needed)
        await fs.mkdir(localDir, { recursive: true });
        await fs.writeFile(localPath, content, "utf-8");

        result.push({
          name: skill.name,
          dir: localDir,
          path: localPath,
          ...(skill.description !== undefined ? { description: skill.description } : {}),
        });
      } catch {
        // Download or write error — skip this skill silently
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 1a — 4-level directory hierarchy
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of skill directories to search.
 *
 * Priority (low → high, last writer wins in deduplication):
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
// Phase 1b — Frontmatter YAML parsing + eligibility check
// ---------------------------------------------------------------------------

/**
 * Parse the YAML frontmatter block at the top of a markdown file.
 * Supports: name, description, os, requires.bins, requires.env
 * Returns {} on missing frontmatter or parse error.
 */
function parseFrontmatter(content: string): SkillFrontmatter {
  // Match --- ... --- at the very start of the file
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return {};

  const block = match[1] ?? "";
  const result: SkillFrontmatter = {};

  try {
    // Parse simple key: value lines (no nested objects except requires)
    const lines = block.split(/\r?\n/);
    let inRequires = false;
    const requires: { bins?: string[]; env?: string[] } = {};

    for (const line of lines) {
      // Detect "requires:" section header
      if (/^requires\s*:/.test(line)) {
        inRequires = true;
        continue;
      }

      // If we're inside requires, parse indented sub-keys
      if (inRequires) {
        const subMatch = /^\s+(bins|env)\s*:\s*(.*)/.exec(line);
        if (subMatch) {
          const key = subMatch[1] as "bins" | "env";
          const val = (subMatch[2] ?? "").trim();
          // Inline list: [a, b, c] or bare value
          if (val.startsWith("[")) {
            requires[key] = val
              .replace(/^\[|\]$/g, "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          } else if (val) {
            requires[key] = [val];
          } else {
            requires[key] = [];
          }
          continue;
        }
        // Indented list item: "  - value"
        const listMatch = /^\s+-\s+(.+)/.exec(line);
        if (listMatch) {
          // Determine which key we're under by looking at the last set key
          // We track this via a simple heuristic: last subMatch key
          // Since we can't easily track state here, skip — handled by inline list above
          continue;
        }
        // Non-indented line exits requires block
        if (!/^\s/.test(line) && line.trim() !== "") {
          inRequires = false;
        }
      }

      // Top-level key: value
      const kvMatch = /^(\w+)\s*:\s*(.*)/.exec(line);
      if (!kvMatch) continue;

      const key = kvMatch[1];
      const val = (kvMatch[2] ?? "").trim();

      if (key === "name") {
        result.name = val.replace(/^['"]|['"]$/g, "");
      } else if (key === "description") {
        result.description = val.replace(/^['"]|['"]$/g, "");
      } else if (key === "os") {
        // Inline list or single value
        if (val.startsWith("[")) {
          result.os = val
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        } else {
          result.os = val.replace(/^['"]|['"]$/g, "");
        }
      }
    }

    // Re-parse requires with a more robust approach: extract the requires block
    const requiresBlockMatch = /^requires\s*:\s*\n((?:[ \t]+.+\n?)*)/m.exec(block);
    if (requiresBlockMatch) {
      const requiresBlock = requiresBlockMatch[1] ?? "";
      const binsMatch = /[ \t]+bins\s*:\s*\[([^\]]*)\]/.exec(requiresBlock);
      const envMatch = /[ \t]+env\s*:\s*\[([^\]]*)\]/.exec(requiresBlock);

      if (binsMatch) {
        requires.bins = (binsMatch[1] ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
      if (envMatch) {
        requires.env = (envMatch[1] ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }

      // Also handle multi-line list format:
      // bins:
      //   - foo
      //   - bar
      if (!binsMatch) {
        const binsSection = /[ \t]+bins\s*:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/m.exec(requiresBlock);
        if (binsSection) {
          requires.bins = (binsSection[1] ?? "")
            .split(/\n/)
            .map((l) => /[ \t]+-[ \t]+(.+)/.exec(l)?.[1]?.trim() ?? "")
            .filter(Boolean);
        }
      }
      if (!envMatch) {
        const envSection = /[ \t]+env\s*:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/m.exec(requiresBlock);
        if (envSection) {
          requires.env = (envSection[1] ?? "")
            .split(/\n/)
            .map((l) => /[ \t]+-[ \t]+(.+)/.exec(l)?.[1]?.trim() ?? "")
            .filter(Boolean);
        }
      }
    }

    if (requires.bins !== undefined || requires.env !== undefined) {
      result.requires = requires;
    }
  } catch {
    // Parse error — return what we have so far
  }

  return result;
}

/**
 * Map process.platform to the OS name used in frontmatter.
 */
function platformToFrontmatterOs(): string {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return process.platform;
  }
}

/**
 * Check whether a binary is available in PATH.
 * Uses `which` on Unix, `where` on Windows.
 */
async function isBinAvailable(bin: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(cmd, [bin]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a skill is eligible to run on the current system.
 * Returns true if all constraints pass, false otherwise.
 */
async function checkEligibility(frontmatter: SkillFrontmatter): Promise<boolean> {
  // OS check
  if (frontmatter.os !== undefined) {
    const currentOs = platformToFrontmatterOs();
    const allowedOs = Array.isArray(frontmatter.os) ? frontmatter.os : [frontmatter.os];
    if (!allowedOs.includes(currentOs)) return false;
  }

  // Environment variable check
  if (frontmatter.requires?.env?.length) {
    for (const varName of frontmatter.requires.env) {
      if (!process.env[varName]) return false;
    }
  }

  // Binary availability check
  if (frontmatter.requires?.bins?.length) {
    for (const bin of frontmatter.requires.bins) {
      const available = await isBinAvailable(bin);
      if (!available) return false;
    }
  }

  return true;
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
    } catch {
      return;
    }
    // Sort entries for deterministic output
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
  // Map: skill name → SkillEntry (last writer wins = higher priority)
  const seen = new Map<string, SkillEntry>();

  // Phase 2 — Remote skills (lowest priority — overridden by local skills)
  if (agentConfig?.skillUrls?.length) {
    const remoteSkills = await fetchRemoteSkills(agentConfig.skillUrls);
    for (const skill of remoteSkills) {
      // Only add if not already seen (local skills have priority)
      if (!seen.has(skill.name)) {
        seen.set(skill.name, skill);
      }
    }
  }

  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or is inaccessible — skip silently
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name;
      const skillDir = path.join(dir, skillName);
      const skillFile = path.join(skillDir, "SKILL.md");

      // Verify SKILL.md exists
      let content: string;
      try {
        content = await fs.readFile(skillFile, "utf-8");
      } catch {
        // No SKILL.md — not a valid skill
        continue;
      }

      // Phase 1b — Parse frontmatter and check eligibility
      const frontmatter = parseFrontmatter(content);
      let eligible: boolean;
      try {
        eligible = await checkEligibility(frontmatter);
      } catch {
        eligible = true; // On error, assume eligible
      }
      if (!eligible) continue;

      // Build the entry (last write wins via Map)
      const skillEntry: SkillEntry = {
        name: skillName,
        dir: skillDir,
        path: skillFile,
        content,
        ...(frontmatter.description !== undefined ? { description: frontmatter.description } : {}),
      };

      seen.set(skillName, skillEntry);
    }
  }

  // Phase 1d — Filter by agent permissions
  let skills = [...seen.values()];
  if (agentConfig && agentConfig.permissions.length > 0) {
    skills = skills.filter((skill) => {
      const result = evaluateRuleset(agentConfig.permissions, "skill", skill.name);
      return result.action !== "deny";
    });
  }

  // Phase 1e — Filter by skill whitelist (null/undefined = all)
  if (agentConfig?.skills != null) {
    const allowSet = new Set(agentConfig.skills);
    return skills.filter((s) => allowSet.has(s.name));
  }

  return skills;
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
    // Sanitize skill name — only allow safe characters
    const skillName = params.name.replace(/[^a-zA-Z0-9_-]/g, "");

    if (!skillName) {
      throw new Error(
        "Invalid skill name: must contain alphanumeric characters, hyphens, or underscores.",
      );
    }

    // Guard: check skill whitelist before searching directories
    if (ctx.agentConfig?.skills != null) {
      const allowed = new Set(ctx.agentConfig.skills);
      if (!allowed.has(skillName)) {
        return {
          title: "skill",
          output: `Skill "${skillName}" is not available for this agent.`,
          truncated: false,
        };
      }
    }

    // Search across the 4-level hierarchy
    const instanceRoot = ctx.workDir ?? process.cwd();
    const dirs = buildSkillDirs(instanceRoot);

    for (const dir of dirs) {
      const skillFile = path.join(dir, skillName, "SKILL.md");
      let content: string;
      try {
        content = await fs.readFile(skillFile, "utf-8");
      } catch {
        // Try next directory
        continue;
      }

      const skillDir = path.join(dir, skillName);

      // Phase 1c — Collect resource files
      const resources = await listSkillResources(skillDir);

      // Build output
      let output = `<skill_content name="${skillName}">\n${content}\n</skill_content>`;

      if (resources.length > 0) {
        const fileList = resources.map((f) => `  <file path="${f}" />`).join("\n");
        output += `\n\n<skill_files>\n${fileList}\n</skill_files>`;
      }

      return {
        title: `Skill: ${skillName}`,
        output,
        truncated: false,
      };
    }

    // Skill not found — list available skills for a helpful error message
    const available = await listAvailableSkills(instanceRoot);
    const hint =
      available.length > 0
        ? `\n\nAvailable skills: ${available.map((s) => s.name).join(", ")}`
        : "\n\nNo skills found in skill directories.";

    throw new Error(`Skill not found: ${skillName}${hint}`);
  },
});
