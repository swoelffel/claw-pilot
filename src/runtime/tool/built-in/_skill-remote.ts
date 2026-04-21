/**
 * runtime/tool/built-in/_skill-remote.ts
 *
 * Remote skill fetching and caching for Phase 2.
 * Extracted from skill.ts to reduce cognitive complexity.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { logger } from "../../../lib/logger.js";
import type { SkillEntry } from "./_skill-frontmatter.js";

// ---------------------------------------------------------------------------
// Cache directory
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export async function fetchRemoteSkills(skillUrls: string[]): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];

  for (const indexUrl of skillUrls) {
    const index = await fetchSkillIndex(indexUrl);
    if (!index) continue;
    if (!Array.isArray(index.skills)) continue;

    for (const skill of index.skills) {
      const entry = await resolveRemoteSkill(skill);
      if (entry) result.push(entry);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch and parse a remote skill index JSON file.
 * Returns null on any error (network, timeout, parse).
 */
async function fetchSkillIndex(indexUrl: string): Promise<RemoteSkillIndex | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(indexUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return null;
    const raw = await response.json();
    return raw as RemoteSkillIndex;
  } catch (err) {
    logger.debug("[tool:skill] remote index fetch failed", { error: String(err) });
    return null;
  }
}

/**
 * Resolve a single remote skill: use cache if available, otherwise download.
 * Returns null if the skill entry is invalid or download fails.
 */
const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

async function resolveRemoteSkill(skill: {
  name: string;
  description?: string;
  url: string;
}): Promise<SkillEntry | null> {
  if (!skill.name || typeof skill.name !== "string" || !skill.name.trim()) return null;
  if (!skill.url || typeof skill.url !== "string" || !skill.url.trim()) return null;
  if (!SAFE_SKILL_NAME.test(skill.name)) {
    logger.debug("[tool:skill] remote skill name rejected", { name: skill.name });
    return null;
  }

  const localDir = path.join(SKILL_CACHE_DIR, skill.name);
  const localPath = path.join(localDir, "SKILL.md");
  // Defense in depth: ensure the resolved cache path stays inside SKILL_CACHE_DIR
  // even if skill.name ever bypasses the regex above.
  const resolvedDir = path.resolve(localDir);
  if (
    resolvedDir !== path.resolve(SKILL_CACHE_DIR, skill.name) ||
    !resolvedDir.startsWith(path.resolve(SKILL_CACHE_DIR) + path.sep)
  ) {
    return null;
  }

  // Cache hit — reuse existing file
  const cached = await tryCache(localDir, localPath, skill);
  if (cached) return cached;

  // Cache miss — fetch the skill content
  return downloadAndCache(localDir, localPath, skill);
}

/** Try to resolve from local cache. Returns null on cache miss. */
async function tryCache(
  localDir: string,
  localPath: string,
  skill: { name: string; description?: string },
): Promise<SkillEntry | null> {
  try {
    await fs.access(localPath);
    return {
      name: skill.name,
      dir: localDir,
      path: localPath,
      ...(skill.description !== undefined ? { description: skill.description } : {}),
    };
  } catch (err) {
    logger.debug("[tool:skill] cache miss for skill", { error: String(err) });
    return null;
  }
}

/** Download a skill from its URL and write to cache. */
async function downloadAndCache(
  localDir: string,
  localPath: string,
  skill: { name: string; description?: string; url: string },
): Promise<SkillEntry | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let skillResponse: Response;
    try {
      skillResponse = await fetch(skill.url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!skillResponse.ok) return null;
    const content = await skillResponse.text();

    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(localPath, content, "utf-8");

    return {
      name: skill.name,
      dir: localDir,
      path: localPath,
      ...(skill.description !== undefined ? { description: skill.description } : {}),
    };
  } catch (err) {
    logger.debug("[tool:skill] remote skill download failed", { error: String(err) });
    return null;
  }
}
