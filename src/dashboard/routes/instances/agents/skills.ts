// src/dashboard/routes/instances/agents/skills.ts
// Skills management routes — list, upload (ZIP), install (GitHub), delete
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../../lib/platform.js";
import { listAvailableSkills, type SkillEntry } from "../../../../runtime/tool/built-in/skill.js";
import { constants } from "../../../../lib/constants.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  source: "workspace" | "global" | "remote";
  deletable: boolean;
}

export interface SkillsListResponse {
  available: boolean;
  skills: SkillInfo[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_ZIP_SIZE = 1_048_576; // 1 MB
const MAX_GITHUB_FILES = 20;
const MAX_GITHUB_DEPTH = 5;
const GITHUB_FETCH_TIMEOUT_MS = 10_000;

/** Derive the source category from a skill entry's absolute path. */
function deriveSource(entry: SkillEntry, stateDir: string): "workspace" | "global" | "remote" {
  const cachePath = path.join(os.homedir(), ".cache", "claw-pilot", "skills");
  if (entry.dir.startsWith(path.join(stateDir, "skills"))) return "workspace";
  if (entry.dir.startsWith(cachePath)) return "remote";
  return "global";
}

/** Map a SkillEntry to a SkillInfo for the API response. */
function toSkillInfo(entry: SkillEntry, stateDir: string): SkillInfo {
  const source = deriveSource(entry, stateDir);
  return {
    name: entry.name,
    description: entry.description ?? "",
    source,
    deletable: source === "workspace",
  };
}

/** Fetch a URL with a strict timeout. Returns the Response object. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// GitHub Contents API helpers
// ---------------------------------------------------------------------------

interface GitHubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

/**
 * Parse a GitHub tree URL into its components.
 * Supports: https://github.com/{owner}/{repo}/tree/{branch}/{path}
 */
function parseGitHubUrl(
  url: string,
): { owner: string; repo: string; branch: string; dirPath: string } | null {
  const match = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/.exec(url);
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    branch: match[3]!,
    dirPath: match[4]!,
  };
}

/**
 * Recursively list all files in a GitHub directory via the Contents API.
 */
async function listGitHubFiles(
  owner: string,
  repo: string,
  dirPath: string,
  branch: string,
  depth: number = 0,
): Promise<Array<{ relativePath: string; downloadUrl: string }>> {
  if (depth > MAX_GITHUB_DEPTH) {
    throw new Error("Directory nesting too deep (max 5 levels)");
  }

  const apiUrl = `${constants.GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  const res = await fetchWithTimeout(apiUrl, GITHUB_FETCH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}`);
  }

  const entries = (await res.json()) as GitHubContentEntry[];
  if (!Array.isArray(entries)) {
    throw new Error("GitHub API returned non-array response");
  }

  const files: Array<{ relativePath: string; downloadUrl: string }> = [];

  for (const entry of entries) {
    if (files.length >= MAX_GITHUB_FILES) break;

    if (entry.type === "file" && entry.download_url) {
      // Relative path within the skill directory
      const rel = entry.path.startsWith(dirPath + "/")
        ? entry.path.slice(dirPath.length + 1)
        : entry.name;
      files.push({ relativePath: rel, downloadUrl: entry.download_url });
    } else if (entry.type === "dir") {
      const subFiles = await listGitHubFiles(owner, repo, entry.path, branch, depth + 1);
      for (const sf of subFiles) {
        if (files.length >= MAX_GITHUB_FILES) break;
        files.push(sf);
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentSkillsRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  // ── GET /api/instances/:slug/skills — list available skills ──────────────

  app.get("/api/instances/:slug/skills", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);

    try {
      const entries = await listAvailableSkills(stateDir);
      const skills = entries.map((e) => toSkillInfo(e, stateDir));
      return c.json({ available: true, skills } satisfies SkillsListResponse);
    } catch {
      // Filesystem or runtime error — return empty list
      return c.json({ available: false, skills: [] } satisfies SkillsListResponse);
    }
  });

  // ── POST /api/instances/:slug/skills/upload — upload a ZIP ───────────────

  app.post("/api/instances/:slug/skills/upload", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);

    // 1. Parse multipart body
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return apiError(c, 400, "MISSING_FILE", "A 'file' field with a .zip file is required");
    }

    if (file.size > MAX_ZIP_SIZE) {
      return apiError(c, 413, "FILE_TOO_LARGE", "ZIP file must be under 1 MB");
    }

    // 2. Write to a temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-skill-"));
    const zipPath = path.join(tmpDir, "skill.zip");
    const extractDir = path.join(tmpDir, "extracted");

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(zipPath, buffer);
      await fs.mkdir(extractDir, { recursive: true });

      // 3. Extract with unzip
      await execFileAsync("unzip", ["-o", zipPath, "-d", extractDir]);

      // 4. Find SKILL.md — may be at root or in a single subfolder
      let skillRoot = extractDir;
      const topEntries = await fs.readdir(extractDir, { withFileTypes: true });
      const skillMdAtRoot = topEntries.some((e) => e.isFile() && e.name === "SKILL.md");

      if (!skillMdAtRoot) {
        // Check for a single subfolder containing SKILL.md
        const subDirs = topEntries.filter((e) => e.isDirectory());
        let found = false;
        for (const sub of subDirs) {
          const subPath = path.join(extractDir, sub.name);
          try {
            await fs.access(path.join(subPath, "SKILL.md"));
            skillRoot = subPath;
            found = true;
            break;
          } catch {
            // Not in this subfolder
          }
        }
        if (!found) {
          return apiError(c, 400, "NO_SKILL_MD", "No SKILL.md found in the archive");
        }
      }

      // 5. Derive skill name from SKILL.md frontmatter or folder name
      const skillMdContent = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf-8");
      const nameMatch = /^---[\s\S]*?^name\s*:\s*["']?([a-zA-Z0-9_-]+)["']?/m.exec(skillMdContent);
      const skillName =
        nameMatch?.[1] ??
        (skillRoot !== extractDir ? path.basename(skillRoot) : path.basename(file.name, ".zip"));

      if (!SKILL_NAME_RE.test(skillName)) {
        return apiError(
          c,
          400,
          "INVALID_NAME",
          "Skill name must be alphanumeric with hyphens/underscores",
        );
      }

      // 6. Copy to workspace skills directory
      const targetDir = path.join(stateDir, "skills", skillName);
      await fs.mkdir(targetDir, { recursive: true });

      // Copy all files from skillRoot to targetDir
      const filesToCopy = await fs.readdir(skillRoot, { withFileTypes: true, recursive: true });
      for (const entry of filesToCopy) {
        if (!entry.isFile()) continue;
        const parentDir = entry.parentPath ?? skillRoot;
        const srcFile = path.join(parentDir, entry.name);
        const relPath = path.relative(skillRoot, srcFile);
        const destFile = path.join(targetDir, relPath);
        await fs.mkdir(path.dirname(destFile), { recursive: true });
        await fs.copyFile(srcFile, destFile);
      }

      return c.json({ ok: true, name: skillName });
    } finally {
      // 7. Cleanup temp directory
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ── POST /api/instances/:slug/skills/install — install from GitHub ───────

  app.post("/api/instances/:slug/skills/install", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);

    // 1. Parse body
    const body = await c.req.json<{ url?: string }>();
    if (!body.url || typeof body.url !== "string") {
      return apiError(c, 400, "MISSING_URL", "A 'url' field with a GitHub URL is required");
    }

    // 2. Parse GitHub URL
    const parsed = parseGitHubUrl(body.url);
    if (!parsed) {
      return apiError(
        c,
        400,
        "INVALID_GITHUB_URL",
        "URL must match https://github.com/{owner}/{repo}/tree/{branch}/{path}",
      );
    }

    // 3. Derive skill name from the last path segment
    const segments = parsed.dirPath.split("/").filter(Boolean);
    const skillName = segments[segments.length - 1] ?? "unknown";
    if (!SKILL_NAME_RE.test(skillName)) {
      return apiError(
        c,
        400,
        "INVALID_NAME",
        "Skill name must be alphanumeric with hyphens/underscores",
      );
    }

    // 4. Fetch directory listing from GitHub Contents API
    let files: Array<{ relativePath: string; downloadUrl: string }>;
    try {
      files = await listGitHubFiles(parsed.owner, parsed.repo, parsed.dirPath, parsed.branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return apiError(c, 502, "GITHUB_FETCH_FAILED", `Failed to fetch from GitHub: ${msg}`);
    }

    // 5. Verify SKILL.md is present
    const hasSkillMd = files.some((f) => f.relativePath === "SKILL.md");
    if (!hasSkillMd) {
      return apiError(c, 400, "NO_SKILL_MD", "No SKILL.md found in the GitHub directory");
    }

    // 6. Download each file and write to workspace
    const targetDir = path.join(stateDir, "skills", skillName);
    await fs.mkdir(targetDir, { recursive: true });

    let filesWritten = 0;
    for (const file of files) {
      try {
        const res = await fetchWithTimeout(file.downloadUrl, GITHUB_FETCH_TIMEOUT_MS);
        if (!res.ok) continue;
        const content = await res.text();
        const destPath = path.join(targetDir, file.relativePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, content, "utf-8");
        filesWritten++;
      } catch {
        // Skip individual file errors — best-effort download
      }
    }

    return c.json({ ok: true, name: skillName, filesCount: filesWritten });
  });

  // ── DELETE /api/instances/:slug/skills/:name — delete a workspace skill ──

  app.delete("/api/instances/:slug/skills/:name", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const skillName = c.req.param("name");
    if (!SKILL_NAME_RE.test(skillName)) {
      return apiError(
        c,
        400,
        "INVALID_NAME",
        "Skill name must be alphanumeric with hyphens/underscores",
      );
    }

    // Only workspace skills (under stateDir/skills/) can be deleted
    const stateDir = getRuntimeStateDir(slug);
    const skillDir = path.join(stateDir, "skills", skillName);

    // Verify the directory exists and is under workspace
    try {
      await fs.access(skillDir);
    } catch {
      return apiError(c, 404, "NOT_FOUND", `Skill '${skillName}' not found in workspace`);
    }

    // Safety check: ensure the resolved path is inside stateDir/skills/
    const realSkillDir = await fs.realpath(skillDir);
    const realSkillsBase = await fs
      .realpath(path.join(stateDir, "skills"))
      .catch(() => path.join(stateDir, "skills"));
    if (!realSkillDir.startsWith(realSkillsBase + path.sep)) {
      return apiError(c, 403, "FORBIDDEN", "Can only delete workspace skills");
    }

    await fs.rm(skillDir, { recursive: true, force: true });
    return c.json({ ok: true });
  });
}
