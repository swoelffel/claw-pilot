// src/dashboard/routes/instances/mcp.ts
// Routes: MCP server management + status/tools
//
// GET  /api/instances/:slug/mcp/servers          — list configured MCP servers (env masked)
// POST /api/instances/:slug/mcp/servers          — add a new MCP server
// PATCH /api/instances/:slug/mcp/servers/:id     — update a server config
// DELETE /api/instances/:slug/mcp/servers/:id    — remove a server
// PATCH /api/instances/:slug/mcp/enabled         — toggle mcpEnabled for the instance
// GET  /api/instances/:slug/mcp/tools            — list tools from connected MCP servers
// GET  /api/instances/:slug/mcp/status           — connection status per server

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { readEnvFileSync } from "../../../lib/env-reader.js";
import { McpRegistry } from "../../../runtime/mcp/registry.js";
import { loadConfigDbFirst } from "../_config-helpers.js";
import { logger } from "../../../lib/logger.js";
import {
  CreateMcpServerSchema,
  PatchMcpServerSchema,
  PatchMcpEnabledSchema,
} from "./mcp-schemas.js";
import type { CreateMcpServerInput, PatchMcpServerInput } from "./mcp-schemas.js";

// ---------------------------------------------------------------------------
// In-process MCP registry cache
// Keyed by slug — populated lazily when the runtime is running and MCP is enabled.
// Cleared when the runtime stops (not tracked here — best-effort).
// ---------------------------------------------------------------------------

const _mcpRegistryCache = new Map<string, McpRegistry>();

/**
 * Invalidate the cached McpRegistry for a slug.
 * Called after any config mutation so the next status/tools read reconnects.
 */
function _clearMcpRegistryCache(slug: string): void {
  const cached = _mcpRegistryCache.get(slug);
  if (cached) {
    void cached.dispose().catch(() => {});
    _mcpRegistryCache.delete(slug);
  }
}

/**
 * Get or create a McpRegistry for the given instance slug.
 * Returns undefined if MCP is not enabled or the runtime is not running.
 */
async function getMcpRegistryForSlug(
  slug: string,
  reg: import("../../../core/registry.js").Registry,
): Promise<McpRegistry | undefined> {
  const stateDir = getRuntimeStateDir(slug);

  const instanceEnv = readEnvFileSync(stateDir);
  for (const [k, v] of Object.entries(instanceEnv)) {
    if (!(k in process.env)) process.env[k] = v;
  }

  const config = loadConfigDbFirst(reg, slug, stateDir);
  if (!config) return undefined;

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
  } catch (err) {
    logger.warn("[route:mcp] MCP registry init failed", { error: String(err) });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_MASK = "••••••";

/** Return a server config safe for API responses — env/header values masked. */
function maskServerConfig(
  srv: import("../../../runtime/config/index.js").RuntimeMcpServerConfig,
): Record<string, unknown> {
  if (srv.type === "local") {
    return {
      id: srv.id,
      type: srv.type,
      command: srv.command,
      args: srv.args,
      env: srv.env ? Object.fromEntries(Object.keys(srv.env).map((k) => [k, ENV_MASK])) : undefined,
      timeout: srv.timeout,
      enabled: srv.enabled,
    };
  }
  return {
    id: srv.id,
    type: srv.type,
    url: srv.url,
    headers: srv.headers
      ? Object.fromEntries(Object.keys(srv.headers).map((k) => [k, ENV_MASK]))
      : undefined,
    timeout: srv.timeout,
    enabled: srv.enabled,
  };
}

// ---------------------------------------------------------------------------
// Config mutation helpers (extracted to keep registerMcpRoutes concise)
// ---------------------------------------------------------------------------

/** Merge a nullable key-value patch into an existing record, removing null-valued keys. */
function _mergeNullableRecord(
  existing: Record<string, string> | undefined,
  patch: Record<string, string | null>,
): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Build the new server object for a POST /mcp/servers request. */
function _buildNewServer(
  input: CreateMcpServerInput,
): import("../../../runtime/config/index.js").RuntimeMcpServerConfig {
  if (input.type === "local") {
    return {
      type: "local",
      id: input.id,
      command: input.command,
      args: input.args ?? [],
      ...(input.env !== undefined ? { env: input.env } : {}),
      timeout: input.timeout ?? 30_000,
      enabled: input.enabled ?? true,
    };
  }
  return {
    type: "remote",
    id: input.id,
    url: input.url,
    ...(input.headers !== undefined ? { headers: input.headers } : {}),
    timeout: input.timeout ?? 30_000,
    enabled: input.enabled ?? true,
  };
}

/** Apply a PATCH payload to an existing server config entry. */
function _applyServerPatch(
  existing: import("../../../runtime/config/index.js").RuntimeMcpServerConfig,
  patch: PatchMcpServerInput,
): import("../../../runtime/config/index.js").RuntimeMcpServerConfig {
  if (existing.type === "local" && patch.type === "local") {
    const env = patch.env ? _mergeNullableRecord(existing.env, patch.env) : existing.env;
    return {
      type: "local",
      id: existing.id,
      command: patch.command ?? existing.command,
      args: patch.args ?? existing.args,
      timeout: patch.timeout ?? existing.timeout,
      enabled: patch.enabled ?? existing.enabled,
      ...(env !== undefined ? { env } : {}),
    };
  }
  if (existing.type === "remote" && patch.type === "remote") {
    const headers = patch.headers
      ? _mergeNullableRecord(existing.headers, patch.headers)
      : existing.headers;
    return {
      type: "remote",
      id: existing.id,
      url: patch.url ?? existing.url,
      timeout: patch.timeout ?? existing.timeout,
      enabled: patch.enabled ?? existing.enabled,
      ...(headers !== undefined ? { headers } : {}),
    };
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Route registration — split across sub-functions to stay under line limits
// ---------------------------------------------------------------------------

function _registerListServers(app: Hono, registry: RouteDeps["registry"]): void {
  app.get(
    "/api/instances/:slug/mcp/servers",
    permission({
      action: ACTIONS.INSTANCE_MCP_SERVERS_READ,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const stateDir = getRuntimeStateDir(slug);
      const config = loadConfigDbFirst(registry, slug, stateDir);
      if (!config) {
        return c.json({ mcpEnabled: false, servers: [] });
      }
      return c.json({
        mcpEnabled: config.mcpEnabled,
        servers: config.mcpServers.map(maskServerConfig),
      });
    },
  );
}

function _registerAddServer(app: Hono, registry: RouteDeps["registry"]): void {
  app.post(
    "/api/instances/:slug/mcp/servers",
    permission({
      action: ACTIONS.INSTANCE_MCP_SERVER_CREATE,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      let body: unknown;
      try {
        body = await c.req.json();
      } catch (err) {
        logger.debug("[route:mcp] Failed to parse request body", { error: String(err) });
        return apiError(c, 400, "INVALID_BODY", "Request body must be valid JSON");
      }

      const parsed = CreateMcpServerSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }

      const input = parsed.data;
      if (input.type === "local") {
        logger.warn("[route:mcp] Adding local MCP server with command execution", {
          slug,
          command: input.command,
        });
      }

      let updated;
      try {
        updated = registry.patchRuntimeConfig(slug, (config) => {
          if (config.mcpServers.some((s) => s.id === input.id)) {
            throw Object.assign(new Error(`MCP server with id "${input.id}" already exists`), {
              code: "MCP_SERVER_DUPLICATE_ID",
            });
          }
          return { ...config, mcpServers: [...config.mcpServers, _buildNewServer(input)] };
        });
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "MCP_SERVER_DUPLICATE_ID") {
          return apiError(c, 409, "MCP_SERVER_DUPLICATE_ID", e.message);
        }
        if (e.message.includes("No runtime config found")) {
          return apiError(c, 404, "CONFIG_NOT_FOUND", "Runtime config not found for this instance");
        }
        logger.error("[route:mcp] Failed to add MCP server", { error: String(err), slug });
        return apiError(c, 500, "MCP_SERVER_ADD_FAILED", "Failed to add MCP server");
      }

      _clearMcpRegistryCache(slug);
      const addedServer = updated.mcpServers.find((s) => s.id === input.id)!;
      return c.json({ server: maskServerConfig(addedServer), restartRequired: true }, 201);
    },
  );
}

function _registerPatchServer(app: Hono, registry: RouteDeps["registry"]): void {
  app.patch(
    "/api/instances/:slug/mcp/servers/:serverId",
    permission({
      action: ACTIONS.INSTANCE_MCP_SERVER_UPDATE,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);
      const serverId = c.req.param("serverId");

      let body: unknown;
      try {
        body = await c.req.json();
      } catch (err) {
        logger.debug("[route:mcp] Failed to parse request body", { error: String(err) });
        return apiError(c, 400, "INVALID_BODY", "Request body must be valid JSON");
      }

      const parsed = PatchMcpServerSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }

      const patch = parsed.data;
      let updated;
      try {
        updated = registry.patchRuntimeConfig(slug, (config) => {
          const idx = config.mcpServers.findIndex((s) => s.id === serverId);
          if (idx === -1) {
            throw Object.assign(new Error(`MCP server "${serverId}" not found`), {
              code: "MCP_SERVER_NOT_FOUND",
            });
          }
          const existing = config.mcpServers[idx]!;
          if (existing.type !== patch.type) {
            throw Object.assign(
              new Error(`Cannot change server type from "${existing.type}" to "${patch.type}"`),
              { code: "MCP_SERVER_TYPE_MISMATCH" },
            );
          }
          const servers = [...config.mcpServers];
          servers[idx] = _applyServerPatch(existing, patch);
          return { ...config, mcpServers: servers };
        });
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "MCP_SERVER_NOT_FOUND") {
          return apiError(c, 404, "MCP_SERVER_NOT_FOUND", e.message);
        }
        if (e.code === "MCP_SERVER_TYPE_MISMATCH") {
          return apiError(c, 400, "MCP_SERVER_TYPE_MISMATCH", e.message);
        }
        if (e.message.includes("No runtime config found")) {
          return apiError(c, 404, "CONFIG_NOT_FOUND", "Runtime config not found for this instance");
        }
        logger.error("[route:mcp] Failed to patch MCP server", { error: String(err), slug });
        return apiError(c, 500, "MCP_SERVER_PATCH_FAILED", "Failed to update MCP server");
      }

      _clearMcpRegistryCache(slug);
      const patchedServer = updated.mcpServers.find((s) => s.id === serverId)!;
      return c.json({ server: maskServerConfig(patchedServer), restartRequired: true });
    },
  );
}

function _registerDeleteServer(app: Hono, registry: RouteDeps["registry"]): void {
  app.delete(
    "/api/instances/:slug/mcp/servers/:serverId",
    permission({
      action: ACTIONS.INSTANCE_MCP_SERVER_DELETE,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const serverId = c.req.param("serverId");

      try {
        registry.patchRuntimeConfig(slug, (config) => {
          if (!config.mcpServers.some((s) => s.id === serverId)) {
            throw Object.assign(new Error(`MCP server "${serverId}" not found`), {
              code: "MCP_SERVER_NOT_FOUND",
            });
          }
          return { ...config, mcpServers: config.mcpServers.filter((s) => s.id !== serverId) };
        });
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "MCP_SERVER_NOT_FOUND") {
          return apiError(c, 404, "MCP_SERVER_NOT_FOUND", e.message);
        }
        if (e.message.includes("No runtime config found")) {
          return apiError(c, 404, "CONFIG_NOT_FOUND", "Runtime config not found for this instance");
        }
        logger.error("[route:mcp] Failed to delete MCP server", { error: String(err), slug });
        return apiError(c, 500, "MCP_SERVER_DELETE_FAILED", "Failed to delete MCP server");
      }

      _clearMcpRegistryCache(slug);
      return c.json({ restartRequired: true });
    },
  );
}

function _registerServerCrudRoutes(app: Hono, registry: RouteDeps["registry"]): void {
  _registerListServers(app, registry);
  _registerAddServer(app, registry);
  _registerPatchServer(app, registry);
  _registerDeleteServer(app, registry);
}

function _registerEnabledAndStatusRoutes(app: Hono, registry: RouteDeps["registry"]): void {
  // ---------------------------------------------------------------------------
  // PATCH /api/instances/:slug/mcp/enabled
  // Toggle the mcpEnabled flag for the instance.
  // ---------------------------------------------------------------------------
  app.patch(
    "/api/instances/:slug/mcp/enabled",
    permission({
      action: ACTIONS.INSTANCE_CONFIG_UPDATE,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      let body: unknown;
      try {
        body = await c.req.json();
      } catch (err) {
        logger.debug("[route:mcp] Failed to parse request body", { error: String(err) });
        return apiError(c, 400, "INVALID_BODY", "Request body must be valid JSON");
      }

      const parsed = PatchMcpEnabledSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      }

      try {
        registry.patchRuntimeConfig(slug, (config) => ({
          ...config,
          mcpEnabled: parsed.data.enabled,
        }));
      } catch (err) {
        const e = err as Error;
        if (e.message.includes("No runtime config found")) {
          return apiError(c, 404, "CONFIG_NOT_FOUND", "Runtime config not found for this instance");
        }
        logger.error("[route:mcp] Failed to toggle mcpEnabled", { error: String(err), slug });
        return apiError(c, 500, "MCP_ENABLED_UPDATE_FAILED", "Failed to update MCP enabled state");
      }

      _clearMcpRegistryCache(slug);
      return c.json({ mcpEnabled: parsed.data.enabled, restartRequired: true });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/mcp/tools
  // Returns the list of MCP tools available for the instance.
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/mcp/tools",
    permission({
      action: ACTIONS.INSTANCE_MCP_TOOLS_READ,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      const mcpRegistry = await getMcpRegistryForSlug(slug, registry);
      if (!mcpRegistry) {
        return c.json({ tools: [] });
      }

      let toolInfos;
      try {
        toolInfos = await mcpRegistry.getTools();
      } catch (err) {
        logger.warn("[route:mcp] MCP tools fetch failed", { error: String(err) });
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
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/mcp/status
  // Returns the connection status of each MCP server for the instance.
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/mcp/status",
    permission({
      action: ACTIONS.INSTANCE_MCP_STATUS,
      resource: { kind: "instance", id: (c) => c.req.param("slug") },
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      const mcpRegistry = await getMcpRegistryForSlug(slug, registry);
      if (!mcpRegistry) {
        return c.json({ servers: [] });
      }

      const statusMap = mcpRegistry.getStatus();
      const stateDir = getRuntimeStateDir(slug);
      const config = loadConfigDbFirst(registry, slug, stateDir);
      if (!config) {
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
    },
  );
}

export function registerMcpRoutes(app: Hono, deps: RouteDeps): void {
  _registerServerCrudRoutes(app, deps.registry);
  _registerEnabledAndStatusRoutes(app, deps.registry);
}
