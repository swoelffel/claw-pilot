// src/dashboard/routes/instances/runtime-messages.ts
// Routes: GET sessions/:sessionId/messages, GET sessions/:sessionId/context
import * as fs from "node:fs";
import * as path from "node:path";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import {
  listMessages,
  listParts,
  initAgentRegistry,
  getAgent,
  listAgents,
  MODEL_CATALOG,
  countMessagesSinceLastCompaction,
  getCachedSystemPrompt,
  getPersistedSystemPrompt,
} from "../../../runtime/index.js";
import { loadMergedConfigDbFirst } from "../_config-helpers.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";

// ---------------------------------------------------------------------------
// Extracted helpers for session context
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;
type DB = RouteDeps["db"];

interface SessionTreeRow {
  id: string;
  parent_id: string | null;
  agent_id: string;
  spawn_depth: number;
  state: string;
  label: string | null;
}

/** Discover workspace files that exist on disk for the given agent. */
function discoverWorkspaceFiles(stateDir: string, agentId: string): string[] {
  const candidates = [
    "SOUL.md",
    "BOOTSTRAP.md",
    "AGENTS.md",
    "USER.md",
    "HEARTBEAT.md",
    "MEMORY.md",
  ];
  const memoryFiles = [
    "facts.md",
    "decisions.md",
    "user-prefs.md",
    "timeline.md",
    "knowledge.md",
  ].map((f) => `memory/${f}`);

  const workspaceDirs = [
    path.join(stateDir, "workspaces", agentId),
    path.join(stateDir, "workspaces", "workspace"),
  ];
  const workspaceDir = workspaceDirs.find((d) => {
    try {
      return fs.existsSync(d);
    } catch (err) {
      logger.debug("[route:runtime] workspace dir check failed", { error: String(err) });
      return false;
    }
  });
  if (!workspaceDir) return [];

  return [...candidates, ...memoryFiles].filter((f) => {
    try {
      return fs.existsSync(path.join(workspaceDir, f));
    } catch (err) {
      logger.debug("[route:runtime] workspace file check failed", { error: String(err) });
      return false;
    }
  });
}

/** Build the tools list from builtin profiles and MCP tools. */
async function buildToolsList(
  db: DB,
  slug: string,
  toolProfile: string,
): Promise<{
  tools: Array<{ name: string; source: "builtin" | "mcp"; serverId?: string }>;
  mcpServers: Array<{ server_id: string; tool_name: string }>;
}> {
  const { TOOL_PROFILES: profiles } = await import("../../../runtime/tool/registry.js");
  const builtinTools = (profiles[toolProfile] ?? profiles["executor"] ?? []).map(
    (name: string) => ({ name, source: "builtin" as const }),
  );

  const mcpToolRows = (() => {
    try {
      return db
        .prepare("SELECT server_id, tool_name FROM rt_mcp_tools WHERE instance_slug = ?")
        .all(slug) as Array<{ server_id: string; tool_name: string }>;
    } catch (err) {
      logger.debug("[route:runtime] rt_mcp_tools query failed", { error: String(err) });
      return [];
    }
  })();

  const mcpTools = mcpToolRows.map((r) => ({
    name: `${r.server_id}_${r.tool_name}`,
    source: "mcp" as const,
    serverId: r.server_id,
  }));

  return { tools: [...builtinTools, ...mcpTools], mcpServers: mcpToolRows };
}

/** Handle GET /runtime/sessions/:sessionId/context. */
async function handleSessionContext(
  c: HonoContext,
  registry: RouteDeps["registry"],
  db: DB,
): Promise<Response> {
  const { slug } = getInstanceContext(c);
  const sessionId = c.req.param("sessionId");
  const stateDir = getRuntimeStateDir(slug);
  const config = loadMergedConfigDbFirst(registry, slug, stateDir);
  if (!config) {
    return apiError(c, 404, "RUNTIME_CONFIG_NOT_FOUND", "No runtime config found");
  }

  const sessionRow = db.prepare("SELECT * FROM rt_sessions WHERE id = ? LIMIT 1").get(sessionId) as
    | {
        agent_id: string;
        instance_slug: string;
        parent_id: string | null;
        spawn_depth: number;
        state: string;
        label: string | null;
      }
    | undefined;
  if (!sessionRow || sessionRow.instance_slug !== slug) {
    return apiError(c, 404, "SESSION_NOT_FOUND", `Session "${sessionId}" not found`);
  }

  const agentId = sessionRow.agent_id;
  initAgentRegistry(config.agents);
  const agentInfo = getAgent(agentId);
  const agentCfg = config.agents.find((a) => a.id === agentId);

  const modelStr = agentCfg?.model ?? agentInfo?.model ?? config.defaultModel ?? "";
  const slashIdx = modelStr.indexOf("/");
  const providerId = slashIdx !== -1 ? modelStr.slice(0, slashIdx) : "";
  const modelId = slashIdx !== -1 ? modelStr.slice(slashIdx + 1) : modelStr;
  const catalogEntry = MODEL_CATALOG.find((m) => m.id === modelId && m.providerId === providerId);

  const messagesSinceCompaction = (() => {
    try {
      return countMessagesSinceLastCompaction(db, sessionId);
    } catch (err) {
      logger.debug("[route:runtime] countMessagesSinceLastCompaction failed", {
        error: String(err),
      });
      return 0;
    }
  })();

  const lastCompactionRow = db
    .prepare(
      "SELECT created_at FROM rt_messages WHERE session_id = ? AND is_compaction = 1 ORDER BY created_at DESC LIMIT 1",
    )
    .get(sessionId) as { created_at: string } | undefined;

  const tokenSumRow = db
    .prepare(
      "SELECT COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) as total FROM rt_messages WHERE session_id = ? AND role = 'assistant' AND tokens_in IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(sessionId) as { total: number } | undefined;

  const toolProfile = agentCfg?.toolProfile ?? "executor";
  const { tools, mcpServers: mcpToolRows } = await buildToolsList(db, slug, toolProfile);

  const mcpServers = (config.mcpServers ?? []).map((srv) => ({
    id: srv.id,
    type: srv.type,
    status: srv.enabled !== false ? "unknown" : ("disabled" as string),
    toolCount: mcpToolRows.filter((r) => r.server_id === srv.id).length,
  }));

  const workspaceFiles = discoverWorkspaceFiles(stateDir, agentId);

  const allAgents = listAgents();
  const teammates = allAgents
    .filter((a) => a.kind !== "subagent")
    .filter((a) => a.name.toLowerCase() !== agentId.toLowerCase())
    .map((a) => ({ id: a.name, name: a.name, kind: a.kind ?? "primary" }));

  const sessionTreeRows = db
    .prepare(
      `SELECT id, parent_id, agent_id, spawn_depth, state, label
       FROM rt_sessions
       WHERE instance_slug = ?
         AND (id = ? OR parent_id = ? OR (parent_id IS NOT NULL AND parent_id IN (
           SELECT parent_id FROM rt_sessions WHERE id = ?
         )))
       ORDER BY spawn_depth ASC, created_at ASC
       LIMIT 50`,
    )
    .all(slug, sessionId, sessionId, sessionId) as SessionTreeRow[];

  const sessionTree = sessionTreeRows.map((r) => ({
    sessionId: r.id,
    parentId: r.parent_id ?? null,
    agentId: r.agent_id,
    spawnDepth: r.spawn_depth,
    state: r.state as "active" | "archived",
    ...(r.label ? { label: r.label } : {}),
  }));

  const cachedPromptEntry =
    getCachedSystemPrompt(sessionId) ?? getPersistedSystemPrompt(db, sessionId);

  return c.json({
    agent: {
      id: agentId,
      name: agentInfo?.name ?? agentId,
      model: modelStr,
      toolProfile,
      ...(agentCfg?.temperature !== undefined ? { temperature: agentCfg.temperature } : {}),
      ...(agentCfg?.maxSteps !== undefined ? { maxSteps: agentCfg.maxSteps } : {}),
      ...(agentCfg?.thinking ? { thinking: agentCfg.thinking } : {}),
    },
    model: {
      providerId,
      modelId,
      contextWindow: catalogEntry?.capabilities.contextWindow ?? 200_000,
      maxOutputTokens: catalogEntry?.capabilities.maxOutputTokens ?? 8_192,
      capabilities: {
        streaming: catalogEntry?.capabilities.streaming ?? true,
        toolCalling: catalogEntry?.capabilities.toolCalling ?? true,
        vision: catalogEntry?.capabilities.vision ?? false,
        reasoning: catalogEntry?.capabilities.reasoning ?? false,
      },
    },
    tokenUsage: {
      estimated: tokenSumRow?.total ?? 0,
      contextWindow: catalogEntry?.capabilities.contextWindow ?? 200_000,
      compactionThreshold: config.compaction?.threshold ?? 0.85,
    },
    compaction: {
      lastCompactedAt: lastCompactionRow?.created_at ?? null,
      messagesSinceCompaction,
      periodicMessageCount: config.compaction?.periodicMessageCount ?? null,
    },
    tools,
    mcpServers,
    systemPromptFiles: workspaceFiles,
    systemPrompt: cachedPromptEntry?.systemPrompt ?? null,
    systemPromptBuiltAt: cachedPromptEntry?.builtAt ?? null,
    teammates,
    sessionTree,
  });
}

export function registerRuntimeMessageRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions/:sessionId/messages
  // List messages for a session (with parts) — supports cursor pagination
  // Query params:
  //   limit  — max messages to return (default 50, max 200)
  //   before — ULID cursor: return messages created before this message ID
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/runtime/sessions/:sessionId/messages",
    permission({
      action: ACTIONS.RUNTIME_SESSION_MESSAGES_READ,
      resource: { kind: "runtime" },
      attributes: (c: HonoContext) => ({
        slug: c.req.param("slug"),
        sessionId: c.req.param("sessionId"),
      }),
    }),
    (c) => {
      const sessionId = c.req.param("sessionId");

      const limitParam = c.req.query("limit");
      const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 200);
      const before = c.req.query("before");

      const allMessages = listMessages(db, sessionId);

      // Apply cursor filter if provided (messages before the given ID, sorted by createdAt)
      let filtered = allMessages;
      if (before) {
        const pivotIdx = allMessages.findIndex((m) => m.id === before);
        if (pivotIdx !== -1) {
          filtered = allMessages.slice(0, pivotIdx);
        }
      }

      // Take the last `limit` messages (most recent end of the slice)
      const paged = filtered.slice(-limit);
      const hasMore = filtered.length > limit;

      const enriched = paged.map((msg) => ({
        ...msg,
        createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
        parts: listParts(db, msg.id).map((p) => ({
          ...p,
          createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
          updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
        })),
      }));

      return c.json({ messages: enriched, hasMore });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions/:sessionId/context
  // Returns a synthetic view of what the LLM "sees" for the current session.
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/runtime/sessions/:sessionId/context",
    permission({
      action: ACTIONS.RUNTIME_SESSION_CONTEXT_READ,
      resource: { kind: "runtime" },
      attributes: (c: HonoContext) => ({
        slug: c.req.param("slug"),
        sessionId: c.req.param("sessionId"),
      }),
    }),
    async (c) => {
      return handleSessionContext(c, registry, db);
    },
  );
}
