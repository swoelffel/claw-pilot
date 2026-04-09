// src/dashboard/routes/instances/runtime.ts
// Routes: GET runtime/status, GET runtime/sessions, DELETE runtime/sessions, POST runtime/chat, GET runtime/chat/stream
import * as fs from "node:fs";
import * as path from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { buildResolvedEnv } from "../../../lib/env-reader.js";
import {
  listMessages,
  listParts,
  runPromptLoop,
  createSession,
  getOrCreatePermanentSession,
  resolveEffectivePersistence,
  initAgentRegistry,
  defaultAgentName,
  getAgent,
  listAgents,
  getBus,
  MODEL_CATALOG,
  countMessagesSinceLastCompaction,
  getCachedSystemPrompt,
  getPersistedSystemPrompt,
  type RuntimeAgentConfig,
} from "../../../runtime/index.js";
import { resolveAgentWorkspacePath } from "../../../core/agent-workspace.js";
import { runMiddlewarePipeline } from "../../../runtime/middleware/pipeline.js";
import { registerMiddleware, clearMiddlewares } from "../../../runtime/middleware/registry.js";
import { guardrailMiddleware } from "../../../runtime/middleware/built-in/guardrail.js";
import { multimodalMiddleware } from "../../../runtime/middleware/built-in/multimodal.js";
import { toolErrorRecoveryMiddleware } from "../../../runtime/middleware/built-in/tool-error-recovery.js";
import { createSuggestionMiddleware } from "../../../runtime/middleware/built-in/suggestions.js";
import {
  listEnrichedSessions,
  purgeArchivedSessions,
} from "../../../core/repositories/runtime-session-repository.js";
import { loadMergedConfigDbFirst } from "../_config-helpers.js";
import { resolveModelForAgent } from "../../../runtime/channel/router.js";

// Active prompt-loop AbortControllers, keyed by sessionId.
// Created in POST /runtime/chat, cleaned up in finally block.
const activeAbortControllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// AI SDK error extraction
// ---------------------------------------------------------------------------

interface ApiErrorDetail {
  /** Human-readable message for the API client (shown in UI). */
  userMessage: string;
  /** Detailed message for server logs (includes statusCode, responseBody). */
  logMessage: string;
  /** HTTP status code to return (502 for upstream provider errors, 500 otherwise). */
  httpStatus: number;
}

/**
 * Walk the error cause chain to find an AI SDK APICallError and extract
 * the provider's actual error message, status code, and response body.
 */
function extractApiErrorDetail(err: unknown): ApiErrorDetail {
  // Walk the cause chain looking for an error with statusCode + responseBody
  // (AI SDK's APICallError shape).
  let current: unknown = err;
  for (let depth = 0; depth < 10 && current; depth++) {
    const rec = current as Record<string, unknown>;
    if (typeof rec.statusCode === "number") {
      const statusCode = rec.statusCode as number;
      const responseBody = typeof rec.responseBody === "string" ? rec.responseBody : undefined;
      const url = typeof rec.url === "string" ? rec.url : undefined;
      const data = rec.data as { error?: { message?: string } } | undefined;

      const providerMessage = data?.error?.message ?? parseResponseBodyMessage(responseBody);

      const userMessage = providerMessage
        ? `Provider error (${statusCode}): ${providerMessage}`
        : `Provider returned HTTP ${statusCode}`;

      const logMessage =
        `statusCode=${statusCode}` +
        (url ? ` url=${url}` : "") +
        (responseBody ? ` body=${responseBody}` : "");

      return { userMessage, logMessage, httpStatus: 502 };
    }
    // Walk: cause property (standard Error chain) or errors array (RetryError)
    if (current instanceof Error) {
      current = current.cause;
    } else if (Array.isArray(rec.errors) && rec.errors.length > 0) {
      current = rec.errors[rec.errors.length - 1];
    } else {
      break;
    }
  }

  // No APICallError found — return the original message
  const message = err instanceof Error ? err.message : String(err);
  return {
    userMessage: message || "Agent execution failed",
    logMessage: message || "unknown error",
    httpStatus: 500,
  };
}

/** Try to parse a JSON response body and extract an error message. */
function parseResponseBodyMessage(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // Common patterns: { error: { message: "..." } } or { error: "..." }
    if (typeof parsed.error === "object" && parsed.error !== null) {
      return (parsed.error as Record<string, unknown>).message as string | undefined;
    }
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch (err) {
    logger.debug("[route:runtime] response body JSON parse failed", { error: String(err) });
    // Not JSON — return as-is if short enough
    if (body.length < 200) return body;
  }
  return undefined;
}

export function registerRuntimeRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/status
  // Returns runtime config + whether runtime.json exists
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/status", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);
    const config = loadMergedConfigDbFirst(registry, slug, stateDir);

    if (!config) {
      return c.json({ slug, hasConfig: false, config: null });
    }

    return c.json({ slug, hasConfig: true, config });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions
  // List active runtime sessions for an instance — enriched with aggregated stats
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/sessions", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateParam = c.req.query("state") as "active" | "archived" | "all" | undefined;
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const includeInternal = c.req.query("includeInternal") === "true";
    const agentId = c.req.query("agentId");
    const since = c.req.query("since");
    const until = c.req.query("until");
    const persistentParam = c.req.query("persistent");
    const before = c.req.query("before");

    // Delegate to repository (handles fallback on older DB schemas)
    const { sessions, hasMore } = listEnrichedSessions(db, slug, {
      ...(stateParam !== undefined ? { state: stateParam } : {}),
      limit,
      includeInternal,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
      ...(persistentParam !== undefined
        ? { persistent: parseInt(persistentParam, 10) as 0 | 1 }
        : {}),
      ...(before !== undefined ? { before } : {}),
    });

    return c.json({ sessions, hasMore });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/instances/:slug/runtime/sessions?state=archived
  // Purge all archived ephemeral sessions for an instance (persistent sessions untouched).
  // ---------------------------------------------------------------------------
  app.delete("/api/instances/:slug/runtime/sessions", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateParam = c.req.query("state");
    if (stateParam !== "archived") {
      return apiError(c, 400, "INVALID_PARAM", "Only state=archived is supported");
    }

    try {
      const result = purgeArchivedSessions(db, slug);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return apiError(c, 500, "PURGE_FAILED", err instanceof Error ? err.message : "Purge failed");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions/:sessionId/messages
  // List messages for a session (with parts) — supports cursor pagination
  // Query params:
  //   limit  — max messages to return (default 50, max 200)
  //   before — ULID cursor: return messages created before this message ID
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/sessions/:sessionId/messages", (c) => {
    const slug = c.req.param("slug");
    const sessionId = c.req.param("sessionId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

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
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions/:sessionId/context
  // Returns a synthetic view of what the LLM "sees" for the current session:
  // agent config, model capabilities, token usage estimate, available tools,
  // MCP server status, workspace files, teammates, session tree.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/sessions/:sessionId/context", async (c) => {
    const slug = c.req.param("slug");
    const sessionId = c.req.param("sessionId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);
    const config = loadMergedConfigDbFirst(registry, slug, stateDir);
    if (!config) {
      return apiError(c, 404, "RUNTIME_CONFIG_NOT_FOUND", "No runtime config found");
    }

    // Load session from DB directly
    const sessionRow = db
      .prepare("SELECT * FROM rt_sessions WHERE id = ? LIMIT 1")
      .get(sessionId) as
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

    // Init agent registry with current config
    initAgentRegistry(config.agents);
    const agentInfo = getAgent(agentId);
    const agentCfg = config.agents.find((a) => a.id === agentId);

    // Resolve model string
    const modelStr = agentCfg?.model ?? agentInfo?.model ?? config.defaultModel ?? "";
    const slashIdx = modelStr.indexOf("/");
    const providerId = slashIdx !== -1 ? modelStr.slice(0, slashIdx) : "";
    const modelId = slashIdx !== -1 ? modelStr.slice(slashIdx + 1) : modelStr;

    // Find model in catalog
    const catalogEntry = MODEL_CATALOG.find((m) => m.id === modelId && m.providerId === providerId);

    // Compaction info
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

    // Token usage estimate: last turn's tokens_in + tokens_out (mirrors shouldCompact logic)
    const tokenSumRow = db
      .prepare(
        "SELECT COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) as total FROM rt_messages WHERE session_id = ? AND role = 'assistant' AND tokens_in IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(sessionId) as { total: number } | undefined;

    // Build tools list (builtin from toolProfile + placeholder for MCP)
    const toolProfile = agentCfg?.toolProfile ?? "executor";
    const { TOOL_PROFILES: profiles } = await import("../../../runtime/tool/registry.js");
    const builtinTools = (profiles[toolProfile] ?? profiles["executor"] ?? []).map(
      (name: string) => ({ name, source: "builtin" as const }),
    );

    // MCP tools — attempt to read from DB snapshot if available, else return empty
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

    // MCP server status — from config (static; live status requires running runtime)
    const mcpServers = (config.mcpServers ?? []).map((srv) => ({
      id: srv.id,
      type: srv.type,
      status: srv.enabled !== false ? "unknown" : ("disabled" as string),
      toolCount: mcpToolRows.filter((r) => r.server_id === srv.id).length,
    }));

    // System prompt files (from workspace discovery heuristic)
    // Workspace files live in workspaces/<agentId>/ or workspaces/workspace/ (single-agent layout).
    const workspaceFiles = (() => {
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
      // Resolve workspace dir: prefer agent-specific, fallback to shared "workspace"
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
    })();

    // Teammates: visible primary agents other than the current agent.
    // Excludes technical sub-agents (explore, general, …) and the agent itself.
    const allAgents = listAgents();
    const teammates = allAgents
      .filter((a) => a.kind !== "subagent")
      .filter((a) => a.name.toLowerCase() !== agentId.toLowerCase())
      .map((a) => ({
        id: a.name,
        name: a.name,
        kind: a.kind ?? "primary",
      }));

    // Session tree: parent + siblings + children of current session
    interface SessionTreeRow {
      id: string;
      parent_id: string | null;
      agent_id: string;
      spawn_depth: number;
      state: string;
      label: string | null;
    }
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

    // System prompt — in-memory cache first, then DB snapshot fallback
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
      tools: [...builtinTools, ...mcpTools],
      mcpServers,
      systemPromptFiles: workspaceFiles,
      systemPrompt: cachedPromptEntry?.systemPrompt ?? null,
      systemPromptBuiltAt: cachedPromptEntry?.builtAt ?? null,
      teammates,
      sessionTree,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/chat
  // Send a message to a runtime agent and get a response
  // Body: { message: string, agentId?: string, sessionId?: string, model?: string }
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/runtime/chat", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let body: {
      message?: string;
      agentId?: string;
      sessionId?: string;
      model?: string;
      files?: Array<{ name: string; mimeType: string; data: string }>;
    };
    try {
      body = await c.req.json();
    } catch (err) {
      logger.warn("[route:runtime] JSON parse failed on chat", { error: String(err) });
      return apiError(c, 400, "INVALID_JSON", "Request body must be valid JSON");
    }

    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
      return apiError(c, 400, "MISSING_MESSAGE", "Field 'message' is required");
    }

    const stateDir = getRuntimeStateDir(slug);
    const config = loadMergedConfigDbFirst(registry, slug, stateDir);
    if (!config) {
      return apiError(
        c,
        404,
        "RUNTIME_CONFIG_NOT_FOUND",
        `No runtime config found for instance "${slug}".`,
      );
    }

    // Init agent registry
    initAgentRegistry(config.agents);

    // Register built-in middlewares (dashboard runs in a separate process from
    // the runtime daemon, so the module-level registry is empty here)
    clearMiddlewares();
    registerMiddleware(guardrailMiddleware);
    registerMiddleware(multimodalMiddleware);
    registerMiddleware(toolErrorRecoveryMiddleware);
    if (config.artifacts?.suggestionsEnabled !== false) {
      registerMiddleware(
        createSuggestionMiddleware({
          ...(config.artifacts?.suggestionsModel !== undefined
            ? { suggestionsModel: config.artifacts.suggestionsModel }
            : {}),
          maxSuggestions: config.artifacts?.maxSuggestions ?? 3,
          ...(config.models !== undefined && config.models.length > 0
            ? { modelAliases: config.models }
            : {}),
        }),
      );
    }

    // Resolve agent
    const agentId = body.agentId ?? defaultAgentName();
    const agentInfo = getAgent(agentId);
    if (!agentInfo) {
      return apiError(c, 404, "AGENT_NOT_FOUND", `Agent "${agentId}" not found`);
    }

    // Build RuntimeAgentConfig
    const agentCfg: RuntimeAgentConfig = config.agents.find((a) => a.id === agentId) ?? {
      id: agentInfo.name,
      name: agentInfo.name,
      model: body.model ?? agentInfo.model ?? config.defaultModel,
      permissions: agentInfo.permission ?? [],
      maxSteps: agentInfo.steps ?? 20,
      allowSubAgents: true,
      toolProfile: "executor",
      isDefault: false,
      inheritWorkspace: true,
    };

    // Load merged env (global ~/.claw-pilot/.env + instance .env) for API key resolution.
    // Inject into process.env so downstream resolveModel calls (e.g. A2A model resolution
    // inside the task tool) can also find them — mirrors what the runtime daemon does at startup.
    const mergedEnv = buildResolvedEnv(stateDir);
    for (const [key, value] of Object.entries(mergedEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    // Resolve model — named keys first, then legacy env-based
    // Note: ensureMasterEncryptionKey() is called at dashboard startup (commands/dashboard.ts)
    const chatAgentCfg = body.model ? { ...agentCfg, model: body.model } : agentCfg;
    let resolvedModelObj;
    try {
      resolvedModelObj = resolveModelForAgent(db, slug, chatAgentCfg, config);
    } catch (err) {
      return apiError(
        c,
        400,
        "MODEL_RESOLUTION_FAILED",
        err instanceof Error ? err.message : `Cannot resolve model "${chatAgentCfg.model}"`,
      );
    }

    // Create or resume session
    let session;
    if (body.sessionId) {
      const { getSession } = await import("../../../runtime/session/session.js");
      session = getSession(db, body.sessionId);
      if (!session || session.instanceSlug !== slug) {
        return apiError(c, 404, "SESSION_NOT_FOUND", `Session "${body.sessionId}" not found`);
      }

      // For permanent agents, ignore the provided sessionId and use the permanent session
      const isPermanent =
        resolveEffectivePersistence(
          agentInfo,
          config.agents.find((a) => a.id === agentId),
        ) === "permanent";

      if (isPermanent) {
        session = getOrCreatePermanentSession(db, {
          instanceSlug: slug,
          agentId,
          channel: "web",
        });
      }
    } else {
      // Resolve persistence for this agent
      const isPermanent =
        resolveEffectivePersistence(
          agentInfo,
          config.agents.find((a) => a.id === agentId),
        ) === "permanent";

      if (isPermanent) {
        // Permanent agents: single session per agent (cross-channel, cross-peer).
        // No peerId derivation — the session is truly unique per agent.
        session = getOrCreatePermanentSession(db, {
          instanceSlug: slug,
          agentId,
          channel: "web",
        });
      } else {
        session = createSession(db, { instanceSlug: slug, agentId, channel: "api" });
      }
    }

    // Convert uploaded files to InboundAttachment[] for vision models
    const imageAttachments =
      body.files && body.files.length > 0
        ? body.files
            .filter((f) => f.mimeType.startsWith("image/"))
            .map((f) => ({
              id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              type: "image" as const,
              mimeType: f.mimeType,
              data: f.data,
              ...(f.name ? { filename: f.name } : {}),
            }))
        : undefined;

    // Run middleware pipeline + prompt loop with abort support
    const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);
    const abortController = new AbortController();
    activeAbortControllers.set(session.id, abortController);
    try {
      const pipelineOutput = await runMiddlewarePipeline({
        ctx: {
          db,
          instanceSlug: slug,
          sessionId: session.id,
          agentConfig: agentCfg,
          message: {
            text: body.message!.trim(),
            channelType: "web",
            peerId: "dashboard",
          },
        },
        runLoop: () =>
          runPromptLoop({
            db,
            instanceSlug: slug,
            sessionId: session.id,
            userText: body.message!.trim(),
            agentConfig: agentCfg,
            resolvedModel: resolvedModelObj,
            workDir: stateDir,
            agentWorkDir,
            runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
            runtimeConfig: config,
            compactionConfig: config.compaction,
            subagentsConfig: config.subagents,
            abort: abortController.signal,
            ...(imageAttachments !== undefined && imageAttachments.length > 0
              ? { imageAttachments }
              : {}),
            resolveTargetModel: (targetCfg) => resolveModelForAgent(db, slug, targetCfg, config),
          }),
      });

      if (pipelineOutput.aborted) {
        return c.json({
          sessionId: session.id,
          aborted: true,
          text: "",
          ...(pipelineOutput.abortReason !== undefined
            ? { reason: pipelineOutput.abortReason }
            : {}),
        });
      }

      const result = pipelineOutput.result!;
      return c.json({
        sessionId: session.id,
        messageId: result.messageId,
        text: result.text,
        tokens: result.tokens,
        costUsd: result.costUsd,
        steps: result.steps,
      });
    } catch (err) {
      if (abortController.signal.aborted) {
        return c.json({ sessionId: session.id, aborted: true, text: "" }, 200);
      }

      // Extract a useful error message from AI SDK errors (APICallError).
      // The prompt loop now re-throws the underlying APICallError (captured via onError)
      // instead of the generic NoOutputGeneratedError wrapper.
      const detail = extractApiErrorDetail(err);
      logger.error(`[POST /runtime/chat] prompt loop failed: ${detail.logMessage}`);
      return apiError(c, detail.httpStatus, "PROMPT_LOOP_FAILED", detail.userMessage);
    } finally {
      activeAbortControllers.delete(session.id);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/sessions/:sessionId/abort
  // Abort an active prompt loop for a session.
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/runtime/sessions/:sessionId/abort", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const sessionId = c.req.param("sessionId");
    const controller = activeAbortControllers.get(sessionId);
    if (!controller) {
      return apiError(c, 404, "NO_ACTIVE_PROMPT_LOOP", "No active prompt loop for this session");
    }

    controller.abort();
    activeAbortControllers.delete(sessionId);
    return c.json({ aborted: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/chat/stream?sessionId=<id>
  // SSE stream of bus events for a runtime session.
  // sessionId is now optional — omitting it streams all instance events.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/chat/stream", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const sessionId = c.req.query("sessionId");
    const bus = getBus(slug);

    return streamSSE(c, async (stream) => {
      // Subscribe to all bus events and forward relevant ones to the SSE stream
      const unsub = bus.subscribeAll((event) => {
        // Forward all pilot-relevant event types
        const relevantTypes = new Set([
          // Message streaming
          "message.part.delta",
          "message.created",
          "message.updated",
          // Session lifecycle
          "session.status",
          "session.ended",
          "session.created",
          "session.updated",
          // System prompt (context panel real-time update)
          "session.system_prompt",
          // Permissions
          "permission.asked",
          "permission.replied",
          // Sub-agents
          "subagent.completed",
          // Provider
          "provider.failover",
          "provider.auth_failed",
          // Tools
          "tool.doom_loop",
          // MCP
          "mcp.tools.changed",
          // Timeouts
          "llm.chunk_timeout",
          "agent.timeout",
          // Questions
          "question.asked",
        ]);

        if (!relevantTypes.has(event.type)) return;

        // If sessionId filter is provided, only forward events for that session
        // (skip for instance-scoped events that have no sessionId)
        if (sessionId) {
          const payload = event.payload as Record<string, unknown>;
          const instanceScopedTypes = new Set([
            "provider.failover",
            "provider.auth_failed",
            "mcp.tools.changed",
          ]);
          if (!instanceScopedTypes.has(event.type) && payload.sessionId !== sessionId) return;
        }

        // Attach server-side timestamp for the event log
        void stream.writeSSE({
          data: JSON.stringify({ ...event, timestamp: new Date().toISOString() }),
        });
      });

      // Ping every 15s to keep the connection alive
      const pingInterval = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" });
      }, 15_000);

      // Cleanup on client disconnect
      stream.onAbort(() => {
        clearInterval(pingInterval);
        unsub();
      });

      // Keep the stream open until the client disconnects
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/tools
  // Returns available tool IDs and profile definitions for the Tools tab UI.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/tools", async (c) => {
    const { TOOL_PROFILES, ALL_TOOL_IDS } = await import("../../../runtime/tool/registry.js");
    return c.json({ tools: ALL_TOOL_IDS, profiles: TOOL_PROFILES });
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/questions/:questionId/answer
  // Submit an answer to a pending question from the question tool.
  // Body: { answer: string }
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/runtime/questions/:questionId/answer", async (c) => {
    const slug = c.req.param("slug");
    const questionId = c.req.param("questionId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let body: { answer?: string };
    try {
      body = await c.req.json();
    } catch (err) {
      logger.warn("[route:runtime] JSON parse failed on question answer", { error: String(err) });
      return apiError(c, 400, "INVALID_JSON", "Request body must be valid JSON");
    }

    if (!body.answer || typeof body.answer !== "string") {
      return apiError(c, 400, "MISSING_ANSWER", "Field 'answer' is required");
    }

    const { resolveQuestion } = await import("../../../runtime/tool/built-in/question.js");
    const resolved = resolveQuestion(questionId, body.answer);

    if (!resolved) {
      return apiError(
        c,
        404,
        "QUESTION_NOT_FOUND",
        `No pending question with ID "${questionId}" — it may have expired or already been answered.`,
      );
    }

    return c.json({ ok: true, questionId, answer: body.answer });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/heartbeat/history
  // Returns heartbeat tick history for a specific agent (channel = 'internal')
  // Query params: agentId (required), limit (optional, default 20, max 100)
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/heartbeat/history", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const agentId = c.req.query("agentId");
    if (!agentId) {
      return apiError(c, 400, "MISSING_AGENT_ID", "agentId query param is required");
    }

    const limitParam = c.req.query("limit");
    const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 100);

    /** Fallback keyword matching for historical messages without structured metadata. */
    function detectHeartbeatStatusFallback(text: string): "ok" | "alert" {
      if (!text) return "ok";
      if (text.startsWith("HEARTBEAT_OK")) return "ok";
      // Check for known alert patterns
      const lower = text.toLowerCase();
      const alertPatterns = ["heartbeat_alert", "heartbeat error:", "error:", "failed"];
      return alertPatterns.some((p) => lower.includes(p)) ? "alert" : "ok";
    }

    interface HeartbeatRow {
      messageId: string;
      createdAt: string;
      agentId: string;
      responseText: string | null;
      tokensOut: number | null;
      finishReason: string | null;
      partMetadata: string | null;
    }

    let rows: HeartbeatRow[] = [];
    try {
      // Each heartbeat tick produces one assistant message inside a single reused session.
      // Query messages (not sessions) to get per-tick timestamps.
      rows = db
        .prepare(
          `SELECT
            m.id as messageId,
            m.created_at as createdAt,
            s.agent_id as agentId,
            p.content as responseText,
            m.tokens_out as tokensOut,
            m.finish_reason as finishReason,
            p.metadata as partMetadata
          FROM rt_messages m
          JOIN rt_sessions s ON s.id = m.session_id
          LEFT JOIN rt_parts p ON p.message_id = m.id AND p.type = 'text'
          WHERE s.instance_slug = ?
            AND s.agent_id = ?
            AND (
              s.channel = 'internal'
              OR m.finish_reason LIKE 'heartbeat:%'
              OR json_extract(p.metadata, '$.heartbeat_status') IS NOT NULL
            )
            AND m.role = 'assistant'
          ORDER BY m.created_at DESC
          LIMIT ?`,
        )
        .all(slug, agentId, limit) as HeartbeatRow[];
    } catch (err) {
      logger.debug("[route:runtime] heartbeat history query failed", { error: String(err) });
      return c.json({ ticks: [] });
    }

    const ticks = rows.map((row) => {
      // Priority: finish_reason (always set) → part metadata → text fallback
      let status: "ok" | "alert" = "ok";
      if (row.finishReason?.startsWith("heartbeat:")) {
        const hbStatus = row.finishReason.slice("heartbeat:".length);
        status = hbStatus === "ok" ? "ok" : "alert";
      } else if (row.partMetadata) {
        try {
          const meta = JSON.parse(row.partMetadata) as { heartbeat_status?: string };
          if (meta.heartbeat_status === "alert" || meta.heartbeat_status === "error") {
            status = "alert";
          } else if (meta.heartbeat_status === "ok") {
            status = "ok";
          } else {
            status = detectHeartbeatStatusFallback(row.responseText ?? "");
          }
        } catch (err) {
          logger.debug("[route:runtime] heartbeat metadata parse failed", { error: String(err) });
          status = detectHeartbeatStatusFallback(row.responseText ?? "");
        }
      } else {
        status = detectHeartbeatStatusFallback(row.responseText ?? "");
      }
      return {
        messageId: row.messageId,
        createdAt: row.createdAt,
        agentId: row.agentId,
        responseText: row.responseText ?? "",
        tokensOut: row.tokensOut ?? 0,
        status,
      };
    });

    return c.json({ ticks });
  });
}
