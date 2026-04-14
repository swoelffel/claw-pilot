// src/dashboard/routes/instances/runtime-chat.ts
// Routes: POST runtime/chat, POST sessions/:sessionId/abort, GET runtime/chat/stream
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { callRuntimeApi } from "../_internal-api-client.js";
import { runtimeGuard } from "../_runtime-guard.js";
import { proxyRuntimeSSE } from "../_sse-proxy.js";

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

/** Build an ApiErrorDetail from an AI SDK APICallError-shaped record. */
function buildApiCallErrorDetail(rec: Record<string, unknown>): ApiErrorDetail {
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

/** Walk to the next error in the cause chain (Error.cause or RetryError.errors). */
function nextCauseInChain(current: unknown): unknown {
  if (current instanceof Error) return current.cause;
  const rec = current as Record<string, unknown>;
  if (Array.isArray(rec.errors) && rec.errors.length > 0) {
    return rec.errors[rec.errors.length - 1];
  }
  return undefined;
}

/**
 * Walk the error cause chain to find an AI SDK APICallError and extract
 * the provider's actual error message, status code, and response body.
 */
function extractApiErrorDetail(err: unknown): ApiErrorDetail {
  let current: unknown = err;
  for (let depth = 0; depth < 10 && current; depth++) {
    const rec = current as Record<string, unknown>;
    if (typeof rec.statusCode === "number") {
      return buildApiCallErrorDetail(rec);
    }
    current = nextCauseInChain(current);
  }

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

export function registerRuntimeChatRoutes(app: Hono, _deps: RouteDeps): void {
  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/chat
  // Send a message to a runtime agent and get a response
  // Body: { message: string, agentId?: string, sessionId?: string, model?: string }
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/runtime/chat", async (c) => {
    const { slug } = getInstanceContext(c);

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

    // Runtime must be running for chat
    const rtGuard = runtimeGuard(c, slug);
    if (rtGuard) return rtGuard;

    try {
      const result = await callRuntimeApi<Record<string, unknown>>(slug, "/internal/chat", body);
      return c.json(result);
    } catch (err) {
      const detail = extractApiErrorDetail(err);
      logger.error(`[POST /runtime/chat] proxy failed: ${detail.logMessage}`);
      return apiError(c, detail.httpStatus, "PROMPT_LOOP_FAILED", detail.userMessage);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/sessions/:sessionId/abort
  // Abort an active prompt loop for a session.
  // ---------------------------------------------------------------------------
  app.post("/api/instances/:slug/runtime/sessions/:sessionId/abort", async (c) => {
    const { slug } = getInstanceContext(c);

    const rtGuard = runtimeGuard(c, slug);
    if (rtGuard) return rtGuard;

    const sessionId = c.req.param("sessionId");
    try {
      const result = await callRuntimeApi<{ ok: boolean; aborted: boolean }>(
        slug,
        `/internal/sessions/${sessionId}/abort`,
        {},
        { timeoutMs: 5000 },
      );
      if (!result.aborted) {
        return apiError(c, 404, "NO_ACTIVE_PROMPT_LOOP", "No active prompt loop for this session");
      }
      return c.json({ aborted: true });
    } catch (err) {
      logger.error("abort_proxy_failed", { error: String(err) });
      return apiError(c, 502, "RUNTIME_UNREACHABLE", "Could not reach runtime daemon");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/chat/stream?sessionId=<id>
  // SSE stream proxied from the runtime daemon's bus.
  // sessionId is optional — omitting it streams all instance events.
  // ---------------------------------------------------------------------------

  /** Event types relevant for the chat/pilot UI. */
  const CHAT_RELEVANT_TYPES = [
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
    "tool.call.started",
    "tool.call.ended",
    // MCP
    "mcp.tools.changed",
    // Timeouts
    "llm.chunk_timeout",
    "agent.timeout",
    // Questions
    "question.asked",
    // Suggestions
    "suggestions.generated",
  ].join(",");

  app.get("/api/instances/:slug/runtime/chat/stream", (c) => {
    const { slug } = getInstanceContext(c);
    const sessionId = c.req.query("sessionId") || undefined;

    return streamSSE(c, async (stream) => {
      await proxyRuntimeSSE(stream, slug, {
        ...(sessionId !== undefined ? { sessionId } : {}),
        types: CHAT_RELEVANT_TYPES,
      });
    });
  });
}
