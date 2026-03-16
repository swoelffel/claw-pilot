// src/dashboard/routes/instances/runtime.ts
// Routes: GET runtime/status, GET runtime/sessions, POST runtime/chat, GET runtime/chat/stream
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { readEnvFileSync } from "../../../lib/env-reader.js";
import {
  runtimeConfigExists,
  loadRuntimeConfig,
  listSessions,
  listMessages,
  listParts,
  resolveModel,
  runPromptLoop,
  createSession,
  initAgentRegistry,
  defaultAgentName,
  getAgent,
  getBus,
  hasBus,
  type RuntimeAgentConfig,
} from "../../../runtime/index.js";

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
      config = loadRuntimeConfig(stateDir);
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

    // Requête enrichie avec agrégats depuis rt_messages
    interface EnrichedSessionRow {
      id: string;
      instance_slug: string;
      parent_id: string | null;
      agent_id: string;
      channel: string;
      peer_id: string | null;
      title: string | null;
      state: string;
      permissions: string | null;
      created_at: string;
      updated_at: string;
      session_key: string | null;
      spawn_depth: number;
      label: string | null;
      metadata: string | null;
      total_cost_usd: number;
      message_count: number;
      total_tokens: number;
    }

    let sql = `
      SELECT s.*,
        COALESCE(SUM(m.cost_usd), 0) as total_cost_usd,
        COUNT(m.id) as message_count,
        COALESCE(SUM(COALESCE(m.tokens_in, 0) + COALESCE(m.tokens_out, 0)), 0) as total_tokens
      FROM rt_sessions s
      LEFT JOIN rt_messages m ON m.session_id = s.id
      WHERE s.instance_slug = ?
    `;
    const params: (string | number)[] = [slug];

    const resolvedState = stateParam ?? "active";
    sql += " AND s.state = ?";
    params.push(resolvedState);

    // Filter out internal sessions (subagent sessions) unless explicitly requested
    if (!includeInternal) {
      sql += " AND s.channel != 'internal'";
    }

    sql += " GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?";
    params.push(isNaN(limit) ? 50 : limit);

    let rows: EnrichedSessionRow[] = [];
    try {
      rows = db.prepare(sql).all(...params) as EnrichedSessionRow[];
    } catch {
      // Fallback vers listSessions si la requête enrichie échoue (ex: colonnes manquantes)
      const fallback = listSessions(db, slug, {
        state: resolvedState,
        limit: isNaN(limit) ? 50 : limit,
        ...(includeInternal ? {} : { excludeChannels: ["internal"] }),
      });
      return c.json({ sessions: fallback });
    }

    // Mapper vers le format SessionInfo + champs agrégés
    const sessions = rows.map((row) => ({
      id: row.id,
      instanceSlug: row.instance_slug,
      parentId: row.parent_id ?? undefined,
      agentId: row.agent_id,
      channel: row.channel,
      peerId: row.peer_id ?? undefined,
      title: row.title ?? undefined,
      state: row.state as "active" | "archived",
      permissions: row.permissions ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sessionKey: row.session_key ?? undefined,
      spawnDepth: row.spawn_depth ?? 0,
      label: row.label ?? undefined,
      metadata: row.metadata ?? undefined,
      // Champs agrégés
      totalCostUsd: row.total_cost_usd ?? 0,
      messageCount: row.message_count ?? 0,
      totalTokens: row.total_tokens ?? 0,
    }));

    return c.json({ sessions });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions/:sessionId/messages
  // List messages for a session (with parts)
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/sessions/:sessionId/messages", (c) => {
    const slug = c.req.param("slug");
    const sessionId = c.req.param("sessionId");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const messages = listMessages(db, sessionId);
    const enriched = messages.map((msg) => ({
      ...msg,
      parts: listParts(db, msg.id),
    }));

    return c.json({ messages: enriched });
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
      config = loadRuntimeConfig(stateDir);
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

    // Load instance env vars for API key resolution
    const instanceEnv = readEnvFileSync(stateDir);

    let resolvedModelObj;
    try {
      resolvedModelObj = resolveModel(modelStr.slice(0, slashIdx), modelStr.slice(slashIdx + 1), {
        env: instanceEnv,
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
    } else {
      session = createSession(db, { instanceSlug: slug, agentId, channel: "api" });
    }

    // Run prompt loop
    try {
      const result = await runPromptLoop({
        db,
        instanceSlug: slug,
        sessionId: session.id,
        userText: body.message.trim(),
        agentConfig: agentCfg,
        resolvedModel: resolvedModelObj,
        workDir: stateDir,
        runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
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
  // SSE stream of bus events for a runtime session
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/chat/stream", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    // Check that the runtime bus is active for this instance
    if (!hasBus(slug)) {
      return c.json(
        { code: "RUNTIME_NOT_RUNNING", error: "Runtime not running for this instance" },
        404,
      );
    }

    const sessionId = c.req.query("sessionId");
    const bus = getBus(slug);

    return streamSSE(c, async (stream) => {
      // Subscribe to all bus events and forward relevant ones to the SSE stream
      const unsub = bus.subscribeAll((event) => {
        // Filter by event type — only forward chat-relevant events
        const relevantTypes = new Set([
          "message.part.delta",
          "message.created",
          "message.updated",
          "session.status",
          "session.ended",
        ]);

        if (!relevantTypes.has(event.type)) return;

        // If sessionId filter is provided, only forward events for that session
        if (sessionId) {
          const payload = event.payload as Record<string, unknown>;
          if (payload.sessionId !== sessionId) return;
        }

        void stream.writeSSE({ data: JSON.stringify(event) });
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
      sessionId: string;
      createdAt: string;
      agentId: string;
      responseText: string | null;
      tokensOut: number | null;
    }

    let rows: HeartbeatRow[] = [];
    try {
      // Le texte de la réponse est dans rt_parts (type='text'), pas dans rt_messages
      rows = db
        .prepare(
          `SELECT
            s.id as sessionId,
            s.created_at as createdAt,
            s.agent_id as agentId,
            p.content as responseText,
            m.tokens_out as tokensOut
          FROM rt_sessions s
          LEFT JOIN rt_messages m ON m.session_id = s.id AND m.role = 'assistant'
          LEFT JOIN rt_parts p ON p.message_id = m.id AND p.type = 'text'
          WHERE s.instance_slug = ?
            AND s.agent_id = ?
            AND s.channel = 'internal'
          ORDER BY s.created_at DESC
          LIMIT ?`,
        )
        .all(slug, agentId, limit) as HeartbeatRow[];
    } catch {
      return c.json({ ticks: [] });
    }

    const ticks = rows.map((row) => ({
      sessionId: row.sessionId,
      createdAt: row.createdAt,
      agentId: row.agentId,
      responseText: row.responseText ?? "",
      tokensOut: row.tokensOut ?? 0,
      status: detectHeartbeatStatus(row.responseText ?? ""),
    }));

    return c.json({ ticks });
  });
}
