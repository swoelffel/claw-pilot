// src/dashboard/routes/instances/agents/skills.ts
// Skills management routes — list, upload (ZIP), install (GitHub), delete
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { unzip as fflateUnzip } from "fflate";
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { permission } from "../../../middleware/permission.js";
import { ACTIONS } from "../../../middleware/permission-actions.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { getRuntimeStateDir } from "../../../../lib/platform.js";
import { listAvailableSkills, type SkillEntry } from "../../../../runtime/tool/built-in/skill.js";
import { constants } from "../../../../lib/constants.js";
import { logger } from "../../../../lib/logger.js";

/**
 * Extract a ZIP buffer into a directory using fflate (pure JS, no system dep).
 * Writes all files preserving nested directory structure.
 */
async function extractZipToDir(zipBuffer: Uint8Array, extractDir: string): Promise<void> {
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    fflateUnzip(zipBuffer, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  for (const [entryPath, content] of Object.entries(files)) {
    // Skip directory entries (end with /) and reject path traversal attempts
    if (entryPath.endsWith("/")) continue;
    if (entryPath.includes("..") || path.isAbsolute(entryPath)) {
      throw new Error(`Unsafe path in archive: ${entryPath}`);
    }
    const destPath = path.join(extractDir, entryPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, content);
  }
}

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
// Extracted route handlers
// ---------------------------------------------------------------------------

/** Find SKILL.md root in an extracted directory (at root or in a single subfolder). */
async function findSkillRoot(extractDir: string): Promise<string | null> {
  const topEntries = await fs.readdir(extractDir, { withFileTypes: true });
  if (topEntries.some((e) => e.isFile() && e.name === "SKILL.md")) return extractDir;

  for (const sub of topEntries.filter((e) => e.isDirectory())) {
    const subPath = path.join(extractDir, sub.name);
    try {
      await fs.access(path.join(subPath, "SKILL.md"));
      return subPath;
    } catch (err) {
      logger.debug("[route:skills] SKILL.md not in subfolder", { error: String(err) });
    }
  }
  return null;
}

/** Copy all files from skillRoot into targetDir, preserving directory structure. */
async function copySkillFiles(skillRoot: string, targetDir: string): Promise<void> {
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Handle POST /skills/upload — extract ZIP archive and install skill. */
async function handleSkillUpload(c: HonoContext, stateDir: string): Promise<Response> {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return apiError(c, 400, "MISSING_FILE", "A 'file' field with a .zip file is required");
  }
  if (file.size > MAX_ZIP_SIZE) {
    return apiError(c, 413, "FILE_TOO_LARGE", "ZIP file must be under 1 MB");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-skill-"));
  const extractDir = path.join(tmpDir, "extracted");

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    await fs.mkdir(extractDir, { recursive: true });
    try {
      await extractZipToDir(buffer, extractDir);
    } catch (err) {
      logger.warn("[route:skills] zip extraction failed", { error: String(err) });
      return apiError(c, 400, "INVALID_ZIP", "Failed to extract ZIP archive");
    }

    const skillRoot = await findSkillRoot(extractDir);
    if (!skillRoot) {
      return apiError(c, 400, "NO_SKILL_MD", "No SKILL.md found in the archive");
    }

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

    const targetDir = path.join(stateDir, "skills", skillName);
    await fs.mkdir(targetDir, { recursive: true });
    await copySkillFiles(skillRoot, targetDir);

    return c.json({ ok: true, name: skillName });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentSkillsRoutes(app: Hono, _deps: RouteDeps): void {
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const sname = (c: HonoContext) => c.req.param("name");

  // ── GET /api/instances/:slug/skills — list available skills ──────────────

  app.get(
    "/api/instances/:slug/skills",
    permission({ action: ACTIONS.SKILL_LIST, resource: { kind: "skill" }, attributes: attr }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      const stateDir = getRuntimeStateDir(slug);

      try {
        const entries = await listAvailableSkills(stateDir);
        const skills = entries.map((e) => toSkillInfo(e, stateDir));
        return c.json({ available: true, skills } satisfies SkillsListResponse);
      } catch (err) {
        logger.debug("[route:skills] listAvailableSkills failed", { error: String(err) });
        // Filesystem or runtime error — return empty list
        return c.json({ available: false, skills: [] } satisfies SkillsListResponse);
      }
    },
  );

  // ── POST /api/instances/:slug/skills/upload — upload a ZIP ───────────────

  app.post(
    "/api/instances/:slug/skills/upload",
    permission({ action: ACTIONS.SKILL_UPLOAD, resource: { kind: "skill" }, attributes: attr }),
    async (c) => {
      const { slug } = getInstanceContext(c);
      const stateDir = getRuntimeStateDir(slug);
      return handleSkillUpload(c, stateDir);
    },
  );

  // ── POST /api/instances/:slug/skills/install — install from GitHub ───────

  app.post(
    "/api/instances/:slug/skills/install",
    permission({ action: ACTIONS.SKILL_INSTALL, resource: { kind: "skill" }, attributes: attr }),
    async (c) => {
      const { slug } = getInstanceContext(c);

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
      const resolvedTargetDir = path.resolve(targetDir);
      for (const file of files) {
        try {
          // Defense in depth: reject any relativePath that escapes targetDir
          // (absolute, traversal, null byte). GitHub Contents API is the source
          // of truth here, but we don't want to trust it unconditionally.
          if (
            typeof file.relativePath !== "string" ||
            file.relativePath.length === 0 ||
            file.relativePath.includes("\0") ||
            path.isAbsolute(file.relativePath)
          ) {
            continue;
          }
          const destPath = path.resolve(resolvedTargetDir, file.relativePath);
          if (
            destPath !== resolvedTargetDir &&
            !destPath.startsWith(resolvedTargetDir + path.sep)
          ) {
            continue;
          }
          const res = await fetchWithTimeout(file.downloadUrl, GITHUB_FETCH_TIMEOUT_MS);
          if (!res.ok) continue;
          const content = await res.text();
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.writeFile(destPath, content, "utf-8");
          filesWritten++;
        } catch (err) {
          logger.warn("[route:skills] GitHub file download failed", { error: String(err) });
          // Skip individual file errors — best-effort download
        }
      }

      return c.json({ ok: true, name: skillName, filesCount: filesWritten });
    },
  );

  // ── DELETE /api/instances/:slug/skills/:name — delete a workspace skill ──

  app.delete(
    "/api/instances/:slug/skills/:name",
    permission({
      action: ACTIONS.SKILL_DELETE,
      resource: { kind: "skill", id: sname },
      attributes: attr,
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

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
      } catch (err) {
        logger.debug("[route:skills] skill access check failed", { error: String(err) });
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
    },
  );
}
