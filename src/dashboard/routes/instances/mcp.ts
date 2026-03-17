// src/dashboard/routes/instances/mcp.ts
// Routes: GET /api/instances/:slug/mcp/tools, GET /api/instances/:slug/mcp/status
//
// These routes expose the MCP server state for a running runtime instance.
// They require the runtime to be running (bus active) and MCP to be enabled.

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { readEnvFileSync } from "../../../lib/env-reader.js";
import { runtimeConfigExists, loadRuntimeConfig } from "../../../runtime/index.js";
import { McpRegistry } from "../../../runtime/mcp/registry.js";

// ---------------------------------------------------------------------------
// In-process MCP registry cache
// Keyed by slug — populated lazily when the runtime is running and MCP is enabled.
// Cleared when the runtime stops (not tracked here — best-effort).
// ---------------------------------------------------------------------------

const _mcpRegistryCache = new Map<string, McpRegistry>();

/**
 * Get or create a McpRegistry for the given instance slug.
 * Returns undefined if MCP is not enabled or the runtime is not running.
 */
async function getMcpRegistryForSlug(slug: string): Promise<McpRegistry | undefined> {
  const stateDir = getRuntimeStateDir(slug);

  if (!runtimeConfigExists(stateDir)) return undefined;

  let config;
  try {
    const instanceEnv = readEnvFileSync(stateDir);
    // Inject env vars so that ${VAR} references in config are resolved
    for (const [k, v] of Object.entries(instanceEnv)) {
      if (!(k in process.env)) process.env[k] = v;
    }
    config = loadRuntimeConfig(stateDir);
  } catch {
    return undefined;
  }

  if (!config.mcpEnabled || config.mcpServers.length === 0) return undefined;

  // Return cached registry if available
  const cached = _mcpRegistryCache.get(slug);
  if (cached) return cached;

  // Create and initialize a new registry (read-only — no bus events)
  const registry = new McpRegistry();
  const enabledServers = config.mcpServers.filter((s) => s.enabled);
  try {
    await registry.init(enabledServers);
    _mcpRegistryCache.set(slug, registry);
    return registry;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerMcpRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/mcp/tools
  // Returns the list of MCP tools available for the instance.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/mcp/tools", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const mcpRegistry = await getMcpRegistryForSlug(slug);
    if (!mcpRegistry) {
      return c.json({ tools: [] });
    }

    let toolInfos;
    try {
      toolInfos = await mcpRegistry.getTools();
    } catch {
      return apiError(c, 500, "MCP_TOOLS_FETCH_FAILED", "Failed to fetch MCP tools");
    }

    const tools = toolInfos.map((t) => {
      // Tool ID format: "<sanitized_serverId>_<sanitized_toolName>"
      // Extract serverId from the prefix (up to the first underscore segment that matches a server)
      const status = mcpRegistry.getStatus();
      const serverId =
        Object.keys(status).find((id) =>
          t.id.startsWith(id.replace(/[^a-zA-Z0-9_]/g, "_") + "_"),
        ) ??
        t.id.split("_")[0] ??
        "";

      return {
        id: t.id,
        serverId,
        name: t.id,
      };
    });

    return c.json({ tools });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/mcp/status
  // Returns the connection status of each MCP server for the instance.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/mcp/status", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const mcpRegistry = await getMcpRegistryForSlug(slug);
    if (!mcpRegistry) {
      return c.json({ servers: [] });
    }

    const statusMap = mcpRegistry.getStatus();
    const stateDir = getRuntimeStateDir(slug);
    let config;
    try {
      config = loadRuntimeConfig(stateDir);
    } catch {
      return c.json({ servers: [] });
    }

    const servers = Object.entries(statusMap).map(([id, s]) => {
      const serverConfig = config.mcpServers.find((srv) => srv.id === id);
      const toolCount =
        s.status === "connected"
          ? mcpRegistry.getClient(id)?.status.status === "connected"
            ? undefined
            : 0
          : 0;

      return {
        id,
        type: serverConfig?.type ?? "unknown",
        connected: s.status === "connected",
        toolCount: toolCount ?? 0,
        lastError: s.status === "failed" ? s.error : null,
      };
    });

    return c.json({ servers });
  });
}
