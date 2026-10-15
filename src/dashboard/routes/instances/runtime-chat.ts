// src/dashboard/routes/instances/runtime-chat.ts
// Routes: POST runtime/chat, POST sessions/:sessionId/abort, GET runtime/chat/stream
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getBusinessTask } from "../../../core/repositories/business-task-repository.js";
import { getSession } from "../../../runtime/session/session.js";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { callRuntimeApi } from "../_internal-api-client.js";
import { runtimeGuard } from "../_runtime-guard.js";
import { proxyRuntimeSSE } from "../_sse-proxy.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import {
  assertRequestScope,
  findRequestByIdempotencyKey,
  getRequest,
  listRequests,
  markRequestDelivered,
  markRequestDeliveryFailed,
  RequestContextConflictError,
  type RequestScope,
} from "../../../core/repositories/request-repository.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

function validateBusinessTaskReference(
  c: HonoContext,
  deps: RouteDeps,
  slug: string,
  businessTaskId?: string,
): Response | undefined {
  if (!businessTaskId) return undefined;
  const task = getBusinessTask(deps.db, businessTaskId);
  if (task?.instance_slug === slug) return undefined;
  return apiError(
    c,
    400,
    "INVALID_BUSINESS_TASK",
    "Business task does not belong to this instance",
  );
}

/** Bind delivery mutations to an explicit session or a successful daemon response. */
function resolveDeliveryScope(
  db: Database.Database,
  scope: RequestScope,
  sessionId: string | undefined,
): RequestScope | undefined {
  if (!sessionId || (scope.sessionId !== undefined && scope.sessionId !== sessionId))
    return undefined;
  const session = getSession(db, sessionId);
  if (
    !session ||
    session.instanceSlug !== scope.instanceSlug ||
    (scope.agentId !== undefined && scope.agentId !== session.agentId)
  )
    return undefined;
  return { ...scope, sessionId, agentId: session.agentId };
}

function chatErrorResponse(
  c: Context,
  deps: RouteDeps,
  requestId: string,
  scope: RequestScope,
  err: unknown,
): Response {
  if (
    err instanceof RequestContextConflictError ||
    (err instanceof Error && "code" in err && err.code === "REQUEST_CONTEXT_CONFLICT")
  ) {
    return apiError(
      c,
      409,
      "REQUEST_CONTEXT_CONFLICT",
      "Request identity is incompatible with this context",
    );
  }
  const persisted = getRequest(deps.db, requestId);
  const deliveryScope = resolveDeliveryScope(
    deps.db,
    scope,
    typeof scope.sessionId === "string" ? scope.sessionId : undefined,
  );
  if (persisted?.result_message_id && deliveryScope) {
    markRequestDeliveryFailed(deps.db, requestId, err, deliveryScope);
  }
  const detail = extractApiErrorDetail(err);
  logger.error(`[POST /runtime/chat] proxy failed: ${detail.logMessage}`);
  return apiError(c, detail.httpStatus, "PROMPT_LOOP_FAILED", detail.userMessage);
}

function recordChatDelivery(
  db: Database.Database,
  submittedId: string,
  resultId: string,
  result: Record<string, unknown>,
  scope: RequestScope,
): void {
  const interrupted =
    result.messageId === "" && result.executionId === "" && result.pendingQuestion !== true;
  const request = getRequest(db, resultId);
  if (request) assertRequestScope(request, scope);
  else if (!interrupted || resultId !== submittedId) throw new RequestContextConflictError();
  if (!interrupted) markRequestDelivered(db, resultId, scope);
}

function registerRuntimeChatPostRoutes(app: Hono, deps: RouteDeps): void {
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/chat
  // Send a message to a runtime agent and get a response
  // Body: { message: string, agentId?: string, sessionId?: string, model?: string }
  // ---------------------------------------------------------------------------
  app.post(
    "/api/instances/:slug/runtime/chat",
    permission({ action: ACTIONS.RUNTIME_CHAT, resource: { kind: "runtime" }, attributes: attr }),
    async (c) => {
      const { slug } = getInstanceContext(c);

      let body: {
        message?: string;
        agentId?: string;
        sessionId?: string;
        model?: string;
        files?: Array<{ name: string; mimeType: string; data: string }>;
        requestId?: string;
        traceId?: string;
        parentRequestId?: string;
        taskId?: number;
        businessTaskId?: string;
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

      const taskError = validateBusinessTaskReference(c, deps, slug, body.businessTaskId);
      if (taskError) return taskError;

      // Runtime must be running for chat
      const rtGuard = runtimeGuard(c, slug);
      if (rtGuard) return rtGuard;

      const idempotencyKey = c.req.header("idempotency-key")?.trim();
      if (idempotencyKey && idempotencyKey.length > 200) {
        return apiError(c, 400, "INVALID_IDEMPOTENCY_KEY", "Idempotency key is too long");
      }
      const requestId = body.requestId ?? randomUUID();
      const traceId = body.traceId ?? ((c as HonoContext).get("traceId") as string) ?? requestId;

      const scope: RequestScope = {
        instanceSlug: slug,
        source: "web",
        ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
        ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
        parentRequestId: body.parentRequestId ?? null,
        taskId: body.taskId ?? null,
        businessTaskId: body.businessTaskId ?? null,
      };
      try {
        const prior = getRequest(deps.db, requestId);
        if (prior) assertRequestScope(prior, scope);
        const keyed = idempotencyKey
          ? findRequestByIdempotencyKey(deps.db, slug, "web", idempotencyKey)
          : undefined;
        if (keyed) assertRequestScope(keyed, scope);
        const result = await callRuntimeApi<
          Record<string, unknown> & { requestId?: string; sessionId?: string }
        >(slug, "/internal/chat", {
          ...body,
          requestId,
          traceId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        const resultId = result.requestId ?? requestId;
        const canonical = idempotencyKey
          ? findRequestByIdempotencyKey(deps.db, slug, "web", idempotencyKey)
          : undefined;
        if (resultId !== requestId && resultId !== canonical?.id)
          throw new RequestContextConflictError();
        const deliveryScope = resolveDeliveryScope(
          deps.db,
          scope,
          result.sessionId ?? body.sessionId,
        );
        if (!deliveryScope) throw new RequestContextConflictError();
        recordChatDelivery(deps.db, requestId, resultId, result, deliveryScope);
        c.header("X-Request-Id", result.requestId ?? requestId);
        c.header("X-Trace-Id", traceId);
        return c.json(result);
      } catch (err) {
        return chatErrorResponse(c, deps, requestId, scope, err);
      }
    },
  );
}

export function registerRuntimeChatRoutes(app: Hono, deps: RouteDeps): void {
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });

  registerRuntimeChatPostRoutes(app, deps);

  // ---------------------------------------------------------------------------
  // POST /api/instances/:slug/runtime/sessions/:sessionId/abort
  // Abort an active prompt loop for a session.
  // ---------------------------------------------------------------------------
  app.post(
    "/api/instances/:slug/runtime/sessions/:sessionId/abort",
    permission({
      action: ACTIONS.RUNTIME_CHAT_ABORT,
      resource: { kind: "runtime" },
      attributes: (c: HonoContext) => ({
        slug: c.req.param("slug"),
        sessionId: c.req.param("sessionId"),
      }),
    }),
    async (c) => {
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
          return apiError(
            c,
            404,
            "NO_ACTIVE_PROMPT_LOOP",
            "No active prompt loop for this session",
          );
        }
        return c.json({ aborted: true });
      } catch (err) {
        logger.error("abort_proxy_failed", { error: String(err) });
        return apiError(c, 502, "RUNTIME_UNREACHABLE", "Could not reach runtime daemon");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/chat/stream?sessionId=<id>
  // SSE stream proxied from the runtime daemon's bus.
  // sessionId is optional — omitting it streams all instance events.
  // ---------------------------------------------------------------------------

  /** Event types relevant for the chat/pilot UI. */
  // Recovery is part of the chat stream, not access to the execution console.
  app.get(
    "/api/instances/:slug/runtime/chat/activity",
    permission({
      action: ACTIONS.RUNTIME_CHAT_STREAM,
      resource: { kind: "runtime" },
      attributes: attr,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const sessionId = c.req.query("sessionId");
      if (!sessionId) return apiError(c, 400, "MISSING_SESSION_ID", "sessionId is required");
      const session = getSession(deps.db, sessionId);
      if (!session || session.instanceSlug !== slug) {
        return apiError(c, 404, "SESSION_NOT_FOUND", "Session not found");
      }
      const requestId = c.req.query("requestId");
      const limit = Number(c.req.query("limit") ?? 1);
      const requests = listRequests(deps.db, slug, {
        sessionId,
        ...(requestId !== undefined ? { requestId } : {}),
        limit: Number.isFinite(limit) ? limit : 1,
      });
      return c.json({
        requests: requests.map(({ id, session_id, execution_status }) => ({
          id,
          session_id,
          execution_status: execution_status ?? null,
        })),
      });
    },
  );

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

  app.get(
    "/api/instances/:slug/runtime/chat/stream",
    permission({
      action: ACTIONS.RUNTIME_CHAT_STREAM,
      resource: { kind: "runtime" },
      attributes: attr,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const sessionId = c.req.query("sessionId") || undefined;
      const lastEventId = c.req.header("last-event-id") || c.req.query("lastEventId") || undefined;

      c.header("X-Accel-Buffering", "no");
      return streamSSE(c, async (stream) => {
        await proxyRuntimeSSE(stream, slug, {
          ...(sessionId !== undefined ? { sessionId } : {}),
          types: CHAT_RELEVANT_TYPES,
          ...(lastEventId !== undefined ? { lastEventId } : {}),
        });
      });
    },
  );
}
