// src/runtime/plugin/workspace-knowledge/tools.ts
//
// Two tools exposed to every agent for discovering user-created files in its
// workspace:
//   ws_list_files(dir?)          — hierarchical listing with extracted titles
//   ws_search_files(query, dir?) — FTS5 full-text search over workspace content
//
// Identity files (SOUL.md, AGENTS.md, BOOTSTRAP.md, USER.md, HEARTBEAT.md,
// MEMORY.md) and memory/*.md files are filtered out — they are handled by
// the system-prompt discovery layer and the memory subsystem respectively.

import type Database from "better-sqlite3";
import { z } from "zod";
import { Tool } from "../../tool/tool.js";
import { logger } from "../../../lib/logger.js";
import type { InstanceSlug } from "../../types.js";

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

function createListTool(db: Database.Database, instanceSlug: InstanceSlug): Tool.Info {
  return Tool.define("ws_list_files", {
    description:
      "List user-created files in your workspace directory. " +
      "Returns each file's path, size, and a short title extracted from the " +
      "first H1 heading or frontmatter 'description:' value. " +
      "Does NOT include identity files (SOUL.md, AGENTS.md, BOOTSTRAP.md, " +
      "USER.md, HEARTBEAT.md, MEMORY.md) or memory files (memory/*.md) — " +
      "those are handled separately by the system prompt and memory subsystem. " +
      "Use this tool when the user references notes, documents, drafts, or " +
      "project files they may have stored in the workspace, before asking them " +
      "to repeat information you could find yourself. " +
      "Pass dir to scope the listing to a subdirectory (e.g. 'projects').",
    parameters: z.object({
      dir: z
        .string()
        .optional()
        .describe("Optional subdirectory to scope listing (e.g. 'projects')"),
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

      const rows = db
        .prepare("SELECT filename, content FROM agent_files WHERE agent_id = ? ORDER BY filename")
        .all(agentDbId) as FileRow[];

      const dirPrefix = args.dir ? args.dir.replace(/\/+$/, "") + "/" : null;
      const entries: string[] = [];
      for (const row of rows) {
        if (isExcluded(row.filename)) continue;
        if (dirPrefix && !row.filename.startsWith(dirPrefix)) continue;
        const size = Buffer.byteLength(row.content ?? "", "utf8");
        const title = extractTitle(row.content ?? "");
        const sizeStr = size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
        entries.push(
          title ? `- ${row.filename} (${sizeStr}) — "${title}"` : `- ${row.filename} (${sizeStr})`,
        );
      }

      const output =
        entries.length === 0
          ? args.dir
            ? `No workspace files found under "${args.dir}".`
            : "No user-created workspace files."
          : entries.join("\n");

      return { title: `workspace files (${entries.length})`, output, truncated: false };
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

function createSearchTool(db: Database.Database, instanceSlug: InstanceSlug): Tool.Info {
  return Tool.define("ws_search_files", {
    description:
      "Full-text search across your workspace files. " +
      "Returns up to 10 matches with a highlighted excerpt (matches wrapped in " +
      "'>>>' / '<<<'). Does NOT search identity files or memory files. " +
      "Use this to find where a topic, keyword, or concept appears across " +
      "workspace documents — faster than reading each file. " +
      'The query supports FTS5 syntax: terms (AND by default), OR, "phrase", ' +
      "prefix* and NOT. Pass dir to scope the search to a subdirectory.",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'FTS5 query (terms separated by space are ANDed; supports OR, NOT, "phrase", prefix*)',
        ),
      dir: z.string().optional().describe("Optional subdirectory to scope search"),
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

      let rows: SearchRow[];
      try {
        rows = db
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
          .all(args.query, agentDbId) as SearchRow[];
      } catch (err) {
        logger.debug("[ws_search_files] FTS5 query failed", { error: String(err) });
        return {
          title: "workspace search error",
          output:
            `Search failed: ${err instanceof Error ? err.message : String(err)}. ` +
            `Check your FTS5 syntax (terms, "phrase", prefix*, OR, NOT).`,
          truncated: false,
        };
      }

      const dirPrefix = args.dir ? args.dir.replace(/\/+$/, "") + "/" : null;
      const filtered = rows.filter((r) => {
        if (isExcluded(r.filename)) return false;
        if (dirPrefix && !r.filename.startsWith(dirPrefix)) return false;
        return true;
      });

      if (filtered.length === 0) {
        return {
          title: "workspace search (0)",
          output: `No matches for query "${args.query}".`,
          truncated: false,
        };
      }

      const output = filtered.map((r) => `${r.filename}:\n  ${r.excerpt}`).join("\n\n");
      return {
        title: `workspace search (${filtered.length})`,
        output,
        truncated: false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createWorkspaceKnowledgeTools(
  db: Database.Database,
  instanceSlug: InstanceSlug,
): Tool.Info[] {
  return [createListTool(db, instanceSlug), createSearchTool(db, instanceSlug)];
}
