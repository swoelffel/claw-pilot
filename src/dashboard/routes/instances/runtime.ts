// src/dashboard/routes/instances/runtime.ts
// Routes: GET runtime/status, GET runtime/sessions, DELETE runtime/sessions, POST runtime/chat, GET runtime/chat/stream
import * as fs from "node:fs";
import * as path from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { buildResolvedEnv } from "../../../lib/env-reader.js";
import { CommunityProfileResolver } from "../../../runtime/profile/community-resolver.js";
import { UserProfileRepository } from "../../../core/repositories/user-profile-repository.js";
import {
  runtimeConfigExists,
  loadMergedConfig,
  listMessages,
  listParts,
  resolveModel,
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
  type RuntimeAgentConfig,
} from "../../../runtime/index.js";
import { resolveAgentWorkspacePath } from "../../../core/agent-workspace.js";
import {
  listEnrichedSessions,
  purgeArchivedSessions,
} from "../../../core/repositories/runtime-session-repository.js";

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
    const hasConfig = runtimeConfigExists(stateDir);

    if (!hasConfig) {
      return c.json({ slug, hasConfig: false, config: null });
    }

    let config;
    try {
      const profileResolver = new CommunityProfileResolver(new UserProfileRepository(db));
      config = loadMergedConfig(stateDir, profileResolver);
    } catch (err) {
      return apiError(
        c,
        500,
        "RUNTIME_CONFIG_INVALID",
        err instanceof Error ? err.message : "Failed to load runtime.json",
      );
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

    const stateParam = c.req.query("state") as "active" | "archived" | undefined;
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const includeInternal = c.req.query("includeInternal") === "true";

    // Delegate to repository (handles fallback on older DB schemas)
    const sessions = listEnrichedSessions(db, slug, {
      ...(stateParam !== undefined ? { state: stateParam } : {}),
      limit,
      includeInternal,
    });

    return c.json({ sessions });
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
  app.get("/api/instances/:slug/runtime/sessions/:sessionId/context", (c) => {
    const slug = c.req.param("slug");
    const sessionId = c.req.param("sessionId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);
    if (!runtimeConfigExists(stateDir)) {
      return apiError(c, 404, "RUNTIME_CONFIG_NOT_FOUND", "No runtime.json found");
    }

    let config;
    try {
      const profileResolver = new CommunityProfileResolver(new UserProfileRepository(db));
      config = loadMergedConfig(stateDir, profileResolver);
    } catch (err) {
      return apiError(
        c,
        500,
        "RUNTIME_CONFIG_INVALID",
        err instanceof Error ? err.message : "Failed to load runtime.json",
      );
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
      } catch {
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
    const toolProfile = agentCfg?.toolProfile ?? "coding";
    const builtinToolsByProfile: Record<string, string[]> = {
      minimal: ["question"],
      messaging: ["question", "webfetch"],
      coding: [
        "read",
        "write",
        "edit",
        "multiedit",
        "bash",
        "glob",
        "grep",
        "webfetch",
        "question",
        "todowrite",
        "todoread",
        "skill",
      ],
      full: [
        "read",
        "write",
        "edit",
        "multiedit",
        "bash",
        "glob",
        "grep",
        "webfetch",
        "question",
        "todowrite",
        "todoread",
        "skill",
        "task",
      ],
    };
    const builtinTools = (
      builtinToolsByProfile[toolProfile] ?? builtinToolsByProfile["coding"]!
    ).map((name) => ({ name, source: "builtin" as const }));

    // MCP tools — attempt to read from DB snapshot if available, else return empty
    const mcpToolRows = (() => {
      try {
        return db
          .prepare("SELECT server_id, tool_name FROM rt_mcp_tools WHERE instance_slug = ?")
          .all(slug) as Array<{ server_id: string; tool_name: string }>;
      } catch {
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
        } catch {
          return false;
        }
      });
      if (!workspaceDir) return [];
      return [...candidates, ...memoryFiles].filter((f) => {
        try {
          return fs.existsSync(path.join(workspaceDir, f));
        } catch {
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

    // System prompt — served from in-memory cache if available (populated by prompt-loop)
    const cachedPromptEntry = getCachedSystemPrompt(sessionId);

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

    let body: { message?: string; agentId?: string; sessionId?: string; model?: string };
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Request body must be valid JSON");
    }

    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
      return apiError(c, 400, "MISSING_MESSAGE", "Field 'message' is required");
    }

    const stateDir = getRuntimeStateDir(slug);
    if (!runtimeConfigExists(stateDir)) {
      return apiError(
        c,
        404,
        "RUNTIME_CONFIG_NOT_FOUND",
        `No runtime.json found for instance "${slug}". Run: claw-pilot runtime config init ${slug}`,
      );
    }

    let config;
    try {
      const profileResolver = new CommunityProfileResolver(new UserProfileRepository(db));
      config = loadMergedConfig(stateDir, profileResolver);
    } catch (err) {
      return apiError(
        c,
        500,
        "RUNTIME_CONFIG_INVALID",
        err instanceof Error ? err.message : "Failed to load runtime.json",
      );
    }

    // Init agent registry
    initAgentRegistry(config.agents);

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
      toolProfile: "coding",
      isDefault: false,
      inheritWorkspace: true,
    };

    // Resolve model
    const modelStr = body.model ?? agentCfg.model;
    const slashIdx = modelStr.indexOf("/");
    if (slashIdx === -1) {
      return apiError(
        c,
        400,
        "INVALID_MODEL",
        `Invalid model format "${modelStr}" — expected "provider/model"`,
      );
    }

    // Load merged env (global ~/.claw-pilot/.env + instance .env) for API key resolution.
    // Inject into process.env so downstream resolveModel calls (e.g. A2A model resolution
    // inside the task tool) can also find them — mirrors what the runtime daemon does at startup.
    const mergedEnv = buildResolvedEnv(stateDir);
    for (const [key, value] of Object.entries(mergedEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    let resolvedModelObj;
    try {
      resolvedModelObj = resolveModel(modelStr.slice(0, slashIdx), modelStr.slice(slashIdx + 1), {
        env: mergedEnv,
      });
    } catch (err) {
      return apiError(
        c,
        400,
        "MODEL_RESOLUTION_FAILED",
        err instanceof Error ? err.message : `Cannot resolve model "${modelStr}"`,
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

    // Run prompt loop
    const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);
    try {
      const result = await runPromptLoop({
        db,
        instanceSlug: slug,
        sessionId: session.id,
        userText: body.message.trim(),
        agentConfig: agentCfg,
        resolvedModel: resolvedModelObj,
        workDir: stateDir,
        agentWorkDir,
        runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
        runtimeConfig: config,
        compactionConfig: config.compaction,
        subagentsConfig: config.subagents,
      });

      return c.json({
        sessionId: session.id,
        messageId: result.messageId,
        text: result.text,
        tokens: result.tokens,
        costUsd: result.costUsd,
        steps: result.steps,
      });
    } catch (err) {
      return apiError(
        c,
        500,
        "PROMPT_LOOP_FAILED",
        err instanceof Error ? err.message : "Agent execution failed",
      );
    }
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

    function detectHeartbeatStatus(text: string): "ok" | "alert" {
      if (!text) return "ok";
      const lower = text.toLowerCase();
      const alertKeywords = ["heartbeat_alert", "alert", "retard", "bloqué", "erreur", "error"];
      return alertKeywords.some((k) => lower.includes(k)) ? "alert" : "ok";
    }

    interface HeartbeatRow {
      messageId: string;
      createdAt: string;
      agentId: string;
      responseText: string | null;
      tokensOut: number | null;
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
            m.tokens_out as tokensOut
          FROM rt_messages m
          JOIN rt_sessions s ON s.id = m.session_id
          LEFT JOIN rt_parts p ON p.message_id = m.id AND p.type = 'text'
          WHERE s.instance_slug = ?
            AND s.agent_id = ?
            AND s.channel = 'internal'
            AND m.role = 'assistant'
          ORDER BY m.created_at DESC
          LIMIT ?`,
        )
        .all(slug, agentId, limit) as HeartbeatRow[];
    } catch {
      return c.json({ ticks: [] });
    }

    const ticks = rows.map((row) => ({
      messageId: row.messageId,
      createdAt: row.createdAt,
      agentId: row.agentId,
      responseText: row.responseText ?? "",
      tokensOut: row.tokensOut ?? 0,
      status: detectHeartbeatStatus(row.responseText ?? ""),
    }));

    return c.json({ ticks });
  });
}
