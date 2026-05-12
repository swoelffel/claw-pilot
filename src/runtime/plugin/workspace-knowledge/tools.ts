// src/runtime/plugin/workspace-knowledge/tools.ts
//
// Tools exposed to every agent for the workspace and the instance shared
// workspace:
//   ws_list_files(dir?)                 — hierarchical listing with titles
//   ws_search_files(query, dir?)        — FTS5 full-text search
//   ws_write_shared_file(path, content) — write to the instance shared workspace
//   ws_delete_shared_file(path)         — delete from the instance shared workspace
//
// Identity files (SOUL.md, AGENTS.md, BOOTSTRAP.md, USER.md, HEARTBEAT.md,
// MEMORY.md) and memory/*.md files are filtered out of listings — they are
// handled by the system-prompt discovery layer and the memory subsystem.

import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { Tool } from "../../tool/tool.js";
import { constants } from "../../../lib/constants.js";
import { logger } from "../../../lib/logger.js";
import { validateWorkspaceRelativePath } from "../../../lib/workspace-path.js";
import type { InstanceSlug } from "../../types.js";
import { resolveAgentScope, type WriteScope } from "./_scope.js";
import { createWriteOwnTool, createDeleteOwnTool } from "./_write-tools.js";

// ---------------------------------------------------------------------------
// Exclusion rules — keep the two lists in sync with constants.ts and
// tool-set-builder.ts:isMemoryFile().
// ---------------------------------------------------------------------------

const EXCLUDED_ROOT_FILES = new Set([
  "AGENTS.md",
  "SOUL.md",
  "BOOTSTRAP.md",
  "USER.md",
  "HEARTBEAT.md",
  "MEMORY.md",
]);

/** True when the given workspace-relative path should be hidden from ws_* tools. */
function isExcluded(filename: string): boolean {
  if (EXCLUDED_ROOT_FILES.has(filename)) return true;
  const parts = filename.split("/");
  return parts.length >= 2 && parts[0] === "memory";
}

// ---------------------------------------------------------------------------
// Title extraction — used by ws_list_files to show a one-line synthesis
// ---------------------------------------------------------------------------

/** Returns the first H1 heading or frontmatter `description:` value, if any. */
function extractTitle(content: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) return h1[1]!.trim();
    const desc = trimmed.match(/^description:\s*(.+)/i);
    if (desc) return desc[1]!.replace(/^["']|["']$/g, "").trim();
    // Stop after the first non-empty, non-matching line so we don't scan
    // arbitrarily deep into the file.
    break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Agent DB id resolver — converts (instanceSlug, agentId) to agents.id
// ---------------------------------------------------------------------------

function resolveAgentDbId(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
): number | null {
  const row = db
    .prepare(
      `SELECT a.id FROM agents a
         JOIN instances i ON i.id = a.instance_id
         WHERE i.slug = ? AND a.agent_id = ?`,
    )
    .get(instanceSlug, agentId) as { id: number } | undefined;
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// ws_list_files
// ---------------------------------------------------------------------------

interface FileRow {
  filename: string;
  content: string | null;
}

/** Resolve the instance DB id from its slug. */
function resolveInstanceDbId(db: Database.Database, instanceSlug: string): number | null {
  const row = db.prepare("SELECT id FROM instances WHERE slug = ?").get(instanceSlug) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

/** Format a single file listing entry. */
function formatEntry(filename: string, content: string | null): string {
  const size = Buffer.byteLength(content ?? "", "utf8");
  const title = extractTitle(content ?? "");
  const sizeStr = size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
  return title ? `- ${filename} (${sizeStr}) — "${title}"` : `- ${filename} (${sizeStr})`;
}

/**
 * Resolve scope prefixes from a raw `dir` argument. A dir starting with
 * "@shared" targets the shared workspace only; any other dir applies to both.
 */
interface DirScope {
  agentPrefix: string | null;
  sharedPrefix: string | null;
  includeAgent: boolean;
}
function resolveDirScope(rawDir: string | null): DirScope {
  if (!rawDir) return { agentPrefix: null, sharedPrefix: null, includeAgent: true };
  if (rawDir === "@shared" || rawDir.startsWith("@shared/")) {
    const sub = rawDir === "@shared" ? "" : rawDir.slice("@shared/".length);
    return {
      agentPrefix: null,
      sharedPrefix: sub ? sub.replace(/\/+$/, "") + "/" : null,
      includeAgent: false,
    };
  }
  const normalized = rawDir.replace(/\/+$/, "") + "/";
  return { agentPrefix: normalized, sharedPrefix: normalized, includeAgent: true };
}

function listAgentEntries(
  db: Database.Database,
  agentDbId: number,
  prefix: string | null,
): string[] {
  const rows = db
    .prepare("SELECT filename, content FROM agent_files WHERE agent_id = ? ORDER BY filename")
    .all(agentDbId) as FileRow[];
  const out: string[] = [];
  for (const row of rows) {
    if (isExcluded(row.filename)) continue;
    if (prefix && !row.filename.startsWith(prefix)) continue;
    out.push(formatEntry(row.filename, row.content));
  }
  return out;
}

function listSharedEntries(
  db: Database.Database,
  instanceDbId: number,
  prefix: string | null,
): string[] {
  const rows = db
    .prepare(
      `SELECT filename, content FROM instance_shared_files
         WHERE instance_id = ? ORDER BY filename`,
    )
    .all(instanceDbId) as FileRow[];
  const out: string[] = [];
  for (const row of rows) {
    if (prefix && !row.filename.startsWith(prefix)) continue;
    out.push(formatEntry(`@shared/${row.filename}`, row.content));
  }
  return out;
}

/** Assemble the final listing sections output. */
function formatListingSections(agentEntries: string[], sharedEntries: string[]): string {
  const sections: string[] = [];
  if (agentEntries.length > 0) {
    sections.push(`## Your workspace\n${agentEntries.join("\n")}`);
  }
  if (sharedEntries.length > 0) {
    sections.push(
      `## Shared workspace (read/write, shared with all agents of this instance)\n` +
        sharedEntries.join("\n"),
    );
  }
  return sections.join("\n\n");
}

function createListTool(db: Database.Database, instanceSlug: InstanceSlug): Tool.Info {
  return Tool.define("ws_list_files", {
    description:
      "List user-created files in your workspace AND in the instance shared " +
      "workspace (shared read/write with all agents of the instance). " +
      "Entries from the shared workspace are prefixed with '@shared/'. " +
      "Returns each file's path, size, and a short title extracted from the " +
      "first H1 heading or frontmatter 'description:' value. " +
      "Does NOT include identity files (SOUL.md, AGENTS.md, BOOTSTRAP.md, " +
      "USER.md, HEARTBEAT.md, MEMORY.md) or memory files (memory/*.md) — " +
      "those are handled separately by the system prompt and memory subsystem. " +
      "Use this tool when the user references notes, documents, drafts, or " +
      "project files they may have stored in the workspace, before asking them " +
      "to repeat information you could find yourself. " +
      "Pass dir to scope the listing (supports '@shared/<path>' to scope shared).",
    parameters: z.object({
      dir: z
        .string()
        .optional()
        .describe("Optional subdirectory to scope listing (e.g. 'projects' or '@shared/docs')"),
    }),
    async execute(args, ctx) {
      const agentDbId = resolveAgentDbId(db, instanceSlug, ctx.agentId);
      if (agentDbId === null) {
        return {
          title: "workspace files",
          output: "Error: could not resolve agent in registry.",
          truncated: false,
        };
      }
      const instanceDbId = resolveInstanceDbId(db, instanceSlug);
      const rawDir = args.dir ?? null;
      const scope = resolveDirScope(rawDir);

      const agentEntries = scope.includeAgent
        ? listAgentEntries(db, agentDbId, scope.agentPrefix)
        : [];
      const sharedEntries =
        instanceDbId !== null ? listSharedEntries(db, instanceDbId, scope.sharedPrefix) : [];

      const totalCount = agentEntries.length + sharedEntries.length;
      if (totalCount === 0) {
        const output = rawDir
          ? `No workspace files found under "${rawDir}".`
          : "No user-created workspace files.";
        return { title: "workspace files (0)", output, truncated: false };
      }

      return {
        title: `workspace files (${totalCount})`,
        output: formatListingSections(agentEntries, sharedEntries),
        truncated: false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// ws_search_files
// ---------------------------------------------------------------------------

interface SearchRow {
  filename: string;
  excerpt: string;
}

/** Search error shape — either valid rows or a user-facing error message. */
type SearchOutcome = { ok: true; rows: SearchRow[] } | { ok: false; error: string };

function searchAgentFts(db: Database.Database, agentDbId: number, query: string): SearchOutcome {
  try {
    const rows = db
      .prepare(
        `SELECT af.filename,
                snippet(agent_files_fts, 1, '>>>', '<<<', '…', 15) AS excerpt
           FROM agent_files_fts
           JOIN agent_files af ON af.id = agent_files_fts.rowid
           WHERE agent_files_fts MATCH ?
             AND af.agent_id = ?
           ORDER BY rank
           LIMIT 10`,
      )
      .all(query, agentDbId) as SearchRow[];
    return { ok: true, rows };
  } catch (err) {
    logger.debug("[ws_search_files] FTS5 query failed (agent)", { error: String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function searchSharedFts(db: Database.Database, instanceDbId: number, query: string): SearchRow[] {
  try {
    return db
      .prepare(
        `SELECT sf.filename,
                snippet(instance_shared_files_fts, 1, '>>>', '<<<', '…', 15) AS excerpt
           FROM instance_shared_files_fts
           JOIN instance_shared_files sf ON sf.id = instance_shared_files_fts.rowid
           WHERE instance_shared_files_fts MATCH ?
             AND sf.instance_id = ?
           ORDER BY rank
           LIMIT 10`,
      )
      .all(query, instanceDbId) as SearchRow[];
  } catch (err) {
    logger.debug("[ws_search_files] FTS5 query failed (shared)", { error: String(err) });
    return [];
  }
}

function filterAgentMatches(rows: SearchRow[], prefix: string | null): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (isExcluded(r.filename)) continue;
    if (prefix && !r.filename.startsWith(prefix)) continue;
    out.push(`${r.filename}:\n  ${r.excerpt}`);
  }
  return out;
}

function filterSharedMatches(rows: SearchRow[], prefix: string | null): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (prefix && !r.filename.startsWith(prefix)) continue;
    out.push(`@shared/${r.filename}:\n  ${r.excerpt}`);
  }
  return out;
}

function formatSearchSections(agentMatches: string[], sharedMatches: string[]): string {
  const sections: string[] = [];
  if (agentMatches.length > 0) {
    sections.push(`## Your workspace\n${agentMatches.join("\n\n")}`);
  }
  if (sharedMatches.length > 0) {
    sections.push(`## Shared workspace\n${sharedMatches.join("\n\n")}`);
  }
  return sections.join("\n\n");
}

function createSearchTool(db: Database.Database, instanceSlug: InstanceSlug): Tool.Info {
  return Tool.define("ws_search_files", {
    description:
      "Full-text search across your workspace AND the instance shared workspace. " +
      "Returns up to 10 matches per scope with a highlighted excerpt (matches wrapped in " +
      "'>>>' / '<<<'). Shared-workspace matches are prefixed with '@shared/'. " +
      "Does NOT search identity files or memory files. " +
      "Use this to find where a topic, keyword, or concept appears across " +
      "workspace documents — faster than reading each file. " +
      'The query supports FTS5 syntax: terms (AND by default), OR, "phrase", ' +
      "prefix* and NOT. Pass dir to scope the search to a subdirectory " +
      "(supports '@shared/<path>' to scope shared-only).",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'FTS5 query (terms separated by space are ANDed; supports OR, NOT, "phrase", prefix*)',
        ),
      dir: z
        .string()
        .optional()
        .describe("Optional subdirectory to scope search (e.g. '@shared/docs')"),
    }),
    async execute(args, ctx) {
      const agentDbId = resolveAgentDbId(db, instanceSlug, ctx.agentId);
      if (agentDbId === null) {
        return {
          title: "workspace search",
          output: "Error: could not resolve agent in registry.",
          truncated: false,
        };
      }
      const instanceDbId = resolveInstanceDbId(db, instanceSlug);
      const scope = resolveDirScope(args.dir ?? null);

      let agentMatches: string[] = [];
      if (scope.includeAgent) {
        const outcome = searchAgentFts(db, agentDbId, args.query);
        if (!outcome.ok) {
          return {
            title: "workspace search error",
            output:
              `Search failed: ${outcome.error}. ` +
              `Check your FTS5 syntax (terms, "phrase", prefix*, OR, NOT).`,
            truncated: false,
          };
        }
        agentMatches = filterAgentMatches(outcome.rows, scope.agentPrefix);
      }

      const sharedMatches =
        instanceDbId !== null
          ? filterSharedMatches(searchSharedFts(db, instanceDbId, args.query), scope.sharedPrefix)
          : [];

      const total = agentMatches.length + sharedMatches.length;
      if (total === 0) {
        return {
          title: "workspace search (0)",
          output: `No matches for query "${args.query}".`,
          truncated: false,
        };
      }

      return {
        title: `workspace search (${total})`,
        output: formatSearchSections(agentMatches, sharedMatches),
        truncated: false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Shared-workspace write/delete tools
// ---------------------------------------------------------------------------
//
// These tools let agents collaborate on the instance shared workspace.
// Writes go to disk (best-effort) AND to `instance_shared_files` so agents
// see the change via ws_list_files / ws_search_files immediately.
//
// Gating: writing to a shared, potentially important document is powerful.
// Use the existing tool permission system (allow/ask/deny per tool) to
// restrict who can call these tools on a given instance.
// ---------------------------------------------------------------------------

function upsertSharedFile(
  db: Database.Database,
  instanceDbId: number,
  filename: string,
  content: string,
): string {
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  db.prepare(
    `INSERT INTO instance_shared_files (instance_id, filename, content, content_hash, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(instance_id, filename) DO UPDATE SET
         content = excluded.content,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
  ).run(instanceDbId, filename, content, hash);
  return hash;
}

function createWriteSharedTool(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  workDir: string | undefined,
): Tool.Info {
  return Tool.define("ws_write_shared_file", {
    description:
      "Create or overwrite a file in the instance shared workspace. " +
      "The file becomes immediately visible to every agent of the instance " +
      "under the `@shared/<path>` prefix via ws_list_files / ws_search_files. " +
      "Use this for team-wide reference documents, shared notes or " +
      "handover files. Path must be workspace-relative with an allowed " +
      "extension (.md, .txt, .json, .yaml, .yml, .csv, .log). Maximum 1 MB.",
    parameters: z.object({
      path: z
        .string()
        .min(1)
        .describe("Workspace-relative path inside the shared workspace (e.g. 'notes/ideas.md')"),
      content: z.string().describe("Full file content (UTF-8). Max 1 MB."),
    }),
    async execute(args) {
      let relPath: string;
      try {
        relPath = validateWorkspaceRelativePath(args.path);
      } catch (err) {
        return {
          title: "shared write error",
          output: `Invalid path: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
        };
      }
      if (Buffer.byteLength(args.content, "utf8") > 1_048_576) {
        return {
          title: "shared write error",
          output: "Content exceeds 1 MB limit.",
          truncated: false,
        };
      }
      const instanceDbId = resolveInstanceDbId(db, instanceSlug);
      if (instanceDbId === null) {
        return {
          title: "shared write error",
          output: "Could not resolve instance in registry.",
          truncated: false,
        };
      }

      // Best-effort disk write so the file survives a DB resync.
      if (workDir) {
        const sharedDir = path.join(workDir, "workspaces", constants.SHARED_WORKSPACE_DIR);
        const filePath = path.join(sharedDir, relPath);
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, args.content, "utf8");
        } catch (err) {
          logger.warn("[ws_write_shared_file] disk write failed", {
            error: String(err),
            filePath,
          });
          return {
            title: "shared write error",
            output: `Disk write failed: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      }

      try {
        upsertSharedFile(db, instanceDbId, relPath, args.content);
      } catch (err) {
        logger.warn("[ws_write_shared_file] DB upsert failed", { error: String(err) });
        return {
          title: "shared write error",
          output: `DB upsert failed: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
        };
      }

      return {
        title: "shared write ok",
        output: `Wrote @shared/${relPath} (${Buffer.byteLength(args.content, "utf8")} bytes).`,
        truncated: false,
      };
    },
  });
}

function createDeleteSharedTool(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  workDir: string | undefined,
): Tool.Info {
  return Tool.define("ws_delete_shared_file", {
    description:
      "Delete a file from the instance shared workspace. The file is removed " +
      "from disk and from the index. This affects every agent of the instance.",
    parameters: z.object({
      path: z.string().min(1).describe("Workspace-relative path inside the shared workspace"),
    }),
    async execute(args) {
      let relPath: string;
      try {
        relPath = validateWorkspaceRelativePath(args.path);
      } catch (err) {
        return {
          title: "shared delete error",
          output: `Invalid path: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
        };
      }
      const instanceDbId = resolveInstanceDbId(db, instanceSlug);
      if (instanceDbId === null) {
        return {
          title: "shared delete error",
          output: "Could not resolve instance in registry.",
          truncated: false,
        };
      }

      if (workDir) {
        const filePath = path.join(workDir, "workspaces", constants.SHARED_WORKSPACE_DIR, relPath);
        try {
          await fs.rm(filePath, { force: true });
        } catch (err) {
          logger.debug("[ws_delete_shared_file] disk remove failed (non-fatal)", {
            error: String(err),
            filePath,
          });
        }
      }

      const res = db
        .prepare("DELETE FROM instance_shared_files WHERE instance_id = ? AND filename = ?")
        .run(instanceDbId, relPath);

      return {
        title: "shared delete ok",
        output:
          res.changes > 0
            ? `Deleted @shared/${relPath}.`
            : `@shared/${relPath} did not exist (nothing to delete).`,
        truncated: false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * WS-WRITE-001: linear-scope tool exposure.
 *
 * The factory always exposes the read-only tools (`ws_list_files`,
 * `ws_search_files`). Write tools are added per the agent's `fs_write_scope`:
 *
 * - `none`         → 0 write tools
 * - `own`          → + `ws_write_file`, `ws_delete_file`
 * - `own_shared`   → + `ws_write_shared_file`, `ws_delete_shared_file`
 * - `system`       → reserved for FS-WRITE-001 (`fs_write_file`, `fs_delete_file`),
 *                    not implemented in this PR
 *
 * When `agentId` is undefined (e.g. plugin init outside a prompt loop), no
 * write tools are exposed. The agent receives them only after the runtime
 * resolves a concrete agent context.
 */
export function createWorkspaceKnowledgeTools(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  workDir: string | undefined,
  agentId: string | undefined,
): Tool.Info[] {
  const tools: Tool.Info[] = [createListTool(db, instanceSlug), createSearchTool(db, instanceSlug)];

  if (!agentId) return tools;
  const perms = resolveAgentScope(db, instanceSlug, agentId);
  const scope: WriteScope = perms?.scope ?? "none";

  if (scope === "own" || scope === "own_shared" || scope === "system") {
    tools.push(createWriteOwnTool(db, instanceSlug));
    tools.push(createDeleteOwnTool(db, instanceSlug));
  }
  if (scope === "own_shared" || scope === "system") {
    tools.push(createWriteSharedTool(db, instanceSlug, workDir));
    tools.push(createDeleteSharedTool(db, instanceSlug, workDir));
  }
  // `system` reserved for FS-WRITE-001 — `fs_*` tools are added there.

  return tools;
}
