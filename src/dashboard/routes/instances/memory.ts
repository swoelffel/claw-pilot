// src/dashboard/routes/instances/memory.ts
// Routes: GET memory agents, GET files, GET file content, GET search

import * as path from "node:path";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { resolveAgentWorkspacePath } from "../../../core/agent-workspace.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Whitelist pattern for memory file paths — prevents path traversal. */
const VALID_MEMORY_PATH = /^(MEMORY\.md|memory\/[a-zA-Z0-9_-]+\.md)$/;

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MemoryFileInfo {
  path: string;
  size: number;
}

/**
 * List memory files for an agent workspace.
 * Returns MEMORY.md + memory/*.md files with sizes.
 */
async function listMemoryFiles(conn: RouteDeps["conn"], wsDir: string): Promise<MemoryFileInfo[]> {
  const files: MemoryFileInfo[] = [];

  // MEMORY.md
  const memoryMdPath = path.join(wsDir, "MEMORY.md");
  if (await conn.exists(memoryMdPath)) {
    try {
      const content = await conn.readFile(memoryMdPath);
      files.push({ path: "MEMORY.md", size: Buffer.byteLength(content, "utf-8") });
    } catch {
      // File unreadable — skip
    }
  }

  // memory/*.md
  const memoryDir = path.join(wsDir, "memory");
  if (await conn.exists(memoryDir)) {
    try {
      const entries = await conn.readdir(memoryDir);
      const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
      for (const filename of mdFiles) {
        try {
          const content = await conn.readFile(path.join(memoryDir, filename));
          files.push({
            path: `memory/${filename}`,
            size: Buffer.byteLength(content, "utf-8"),
          });
        } catch {
          // File unreadable — skip
        }
      }
    } catch {
      // Directory unreadable — skip
    }
  }

  return files;
}

/**
 * Find the most recent modification time for memory files.
 * Falls back to reading file mtimes via conn.exec().
 */
async function getLastModified(
  conn: RouteDeps["conn"],
  wsDir: string,
  files: MemoryFileInfo[],
): Promise<string | null> {
  if (files.length === 0) return null;

  // Use stat to get the most recent mtime
  try {
    const platform = await conn.platform();
    const filePaths = files.map((f) => `"${path.join(wsDir, f.path)}"`).join(" ");
    const statCmd =
      platform === "darwin"
        ? `stat -f "%m %N" ${filePaths} 2>/dev/null | sort -rn | head -1`
        : `stat -c "%Y %n" ${filePaths} 2>/dev/null | sort -rn | head -1`;

    const result = await conn.exec(statCmd);
    if (result.exitCode === 0 && result.stdout.trim()) {
      const timestamp = Number(result.stdout.trim().split(" ")[0]);
      if (Number.isFinite(timestamp)) {
        return new Date(timestamp * 1000).toISOString();
      }
    }
  } catch {
    // Fallback — no mtime available
  }

  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerMemoryRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/memory/agents
  // List agents that have memory files in their workspace.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/memory/agents", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const agents = registry.listAgents(slug);
    const results: Array<{
      agentId: string;
      name: string;
      fileCount: number;
      totalSize: number;
      lastModified: string | null;
    }> = [];

    for (const agent of agents) {
      const wsDir = resolveAgentWorkspacePath(instance!.state_dir, agent.agent_id, undefined);

      if (!(await conn.exists(wsDir))) continue;

      const files = await listMemoryFiles(conn, wsDir);
      if (files.length === 0) continue;

      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const lastModified = await getLastModified(conn, wsDir, files);

      results.push({
        agentId: agent.agent_id,
        name: agent.name,
        fileCount: files.length,
        totalSize,
        lastModified,
      });
    }

    return c.json({ agents: results });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/memory/agents/:agentId/files
  // List memory files for a specific agent.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/memory/agents/:agentId/files", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const agent = registry.getAgentByAgentId(instance!.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const wsDir = resolveAgentWorkspacePath(instance!.state_dir, agentId, undefined);
    if (!(await conn.exists(wsDir))) {
      return c.json({ agentId, files: [] });
    }

    const files = await listMemoryFiles(conn, wsDir);
    return c.json({ agentId, files });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/memory/agents/:agentId/files/:filename{.+}
  // Return the content of a single memory file.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/memory/agents/:agentId/files/:filename{.+}", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const agent = registry.getAgentByAgentId(instance!.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    // Security: validate filename against whitelist
    if (!VALID_MEMORY_PATH.test(filename)) {
      return apiError(c, 400, "INVALID_PATH", "Invalid memory file path");
    }

    const wsDir = resolveAgentWorkspacePath(instance!.state_dir, agentId, undefined);
    const filePath = path.join(wsDir, filename);

    if (!(await conn.exists(filePath))) {
      return apiError(c, 404, "FILE_NOT_FOUND", "Memory file not found");
    }

    try {
      const content = await conn.readFile(filePath);
      return c.json({
        agentId,
        path: filename,
        content,
        size: Buffer.byteLength(content, "utf-8"),
      });
    } catch {
      return apiError(c, 500, "READ_ERROR", "Failed to read memory file");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/memory/search
  // Search across memory files (case-insensitive substring match).
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/memory/search", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const query = c.req.query("q");
    if (!query || !query.trim()) {
      return apiError(c, 400, "MISSING_QUERY", "Query parameter 'q' is required");
    }

    const filterAgentId = c.req.query("agentId") || undefined;
    const rawLimit = c.req.query("limit");
    const limit = rawLimit
      ? Math.min(Math.max(1, Number(rawLimit) || DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT)
      : DEFAULT_SEARCH_LIMIT;

    const queryLower = query.trim().toLowerCase();
    const agents = registry.listAgents(slug);

    const results: Array<{
      agentId: string;
      source: string;
      snippet: string;
      line: number;
    }> = [];

    for (const agent of agents) {
      if (filterAgentId && agent.agent_id !== filterAgentId) continue;

      const wsDir = resolveAgentWorkspacePath(instance!.state_dir, agent.agent_id, undefined);

      if (!(await conn.exists(wsDir))) continue;

      const files = await listMemoryFiles(conn, wsDir);

      for (const file of files) {
        if (results.length >= limit) break;

        try {
          const content = await conn.readFile(path.join(wsDir, file.path));
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= limit) break;
            if (lines[i]!.toLowerCase().includes(queryLower)) {
              // Build snippet with 1 line of context before/after
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length - 1, i + 1);
              const snippet = lines.slice(start, end + 1).join("\n");

              results.push({
                agentId: agent.agent_id,
                source: file.path,
                snippet,
                line: i + 1,
              });
            }
          }
        } catch {
          // File unreadable — skip
        }
      }
    }

    return c.json({ query: query.trim(), results });
  });
}
