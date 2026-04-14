/**
 * runtime/tool/built-in/_skill-frontmatter.ts
 *
 * YAML frontmatter parsing and system eligibility checks for skill files.
 * Extracted from skill.ts to reduce cognitive complexity.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../../lib/logger.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Parsed frontmatter from a SKILL.md file */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  os?: string | string[];
  requires?: {
    bins?: string[];
    env?: string[];
  };
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse the YAML frontmatter block at the top of a markdown file.
 * Supports: name, description, os, requires.bins, requires.env
 * Returns {} on missing frontmatter or parse error.
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return {};

  const block = match[1] ?? "";
  const result: SkillFrontmatter = {};

  try {
    parseTopLevelFields(block, result);
    const requires = parseRequiresBlock(block);
    if (requires.bins !== undefined || requires.env !== undefined) {
      result.requires = requires;
    }
  } catch (err) {
    logger.debug("[tool:skill] frontmatter parse error", { error: String(err) });
  }

  return result;
}

/**
 * Parse top-level key: value lines from the frontmatter block.
 */
function parseTopLevelFields(block: string, result: SkillFrontmatter): void {
  const lines = block.split(/\r?\n/);
  let inRequires = false;

  for (const line of lines) {
    if (/^requires\s*:/.test(line)) {
      inRequires = true;
      continue;
    }

    if (inRequires) {
      if (isRequiresSubLine(line)) continue;
      if (!/^\s/.test(line) && line.trim() !== "") inRequires = false;
    }

    assignTopLevelField(line, result);
  }
}

/** Check if a line belongs to the requires: sub-block. */
function isRequiresSubLine(line: string): boolean {
  return /^\s+(bins|env)\s*:/.test(line) || /^\s+-\s+/.test(line);
}

/** Parse a top-level key: value line and assign to result. */
function assignTopLevelField(line: string, result: SkillFrontmatter): void {
  const kvMatch = /^(\w+)\s*:\s*(.*)/.exec(line);
  if (!kvMatch) return;

  const key = kvMatch[1];
  const val = (kvMatch[2] ?? "").trim();

  if (key === "name") {
    result.name = val.replace(/^['"]|['"]$/g, "");
  } else if (key === "description") {
    result.description = val.replace(/^['"]|['"]$/g, "");
  } else if (key === "os") {
    result.os = parseInlineListOrScalar(val);
  }
}

/**
 * Parse an inline YAML list ([a, b, c]) or a single scalar value.
 */
function parseInlineListOrScalar(val: string): string | string[] {
  if (val.startsWith("[")) {
    return val
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return val.replace(/^['"]|['"]$/g, "");
}

/**
 * Parse the requires block from frontmatter using regex extraction.
 */
function parseRequiresBlock(block: string): { bins?: string[]; env?: string[] } {
  const requires: { bins?: string[]; env?: string[] } = {};

  const requiresBlockMatch = /^requires\s*:\s*\n((?:[ \t]+.+\n?)*)/m.exec(block);
  if (!requiresBlockMatch) return requires;

  const requiresBlock = requiresBlockMatch[1] ?? "";

  const bins = parseRequiresKey(requiresBlock, "bins");
  const env = parseRequiresKey(requiresBlock, "env");
  if (bins !== undefined) requires.bins = bins;
  if (env !== undefined) requires.env = env;

  return requires;
}

/**
 * Parse a single key (bins or env) from the requires block.
 * Supports both inline list format and multi-line list format.
 */
function parseRequiresKey(requiresBlock: string, key: string): string[] | undefined {
  // Inline list: bins: [a, b, c]
  const inlineMatch = new RegExp(`[ \\t]+${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(requiresBlock);
  if (inlineMatch) {
    return (inlineMatch[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  // Multi-line list format:
  // bins:
  //   - foo
  //   - bar
  const multiLineMatch = new RegExp(
    `[ \\t]+${key}\\s*:\\s*\\n((?:[ \\t]+-[ \\t]+.+\\n?)*)`,
    "m",
  ).exec(requiresBlock);
  if (multiLineMatch) {
    return (multiLineMatch[1] ?? "")
      .split(/\n/)
      .map((l) => /[ \t]+-[ \t]+(.+)/.exec(l)?.[1]?.trim() ?? "")
      .filter(Boolean);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Eligibility checks
// ---------------------------------------------------------------------------

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
 */
async function isBinAvailable(bin: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(cmd, [bin]);
    return true;
  } catch (err) {
    logger.debug("[tool:skill] bin availability check failed", { error: String(err) });
    return false;
  }
}

/**
 * Check whether a skill is eligible to run on the current system.
 * Returns true if all constraints pass, false otherwise.
 */
export async function checkEligibility(frontmatter: SkillFrontmatter): Promise<boolean> {
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
