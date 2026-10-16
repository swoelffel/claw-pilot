// src/dashboard/routes/instances/agents/kickoff.ts
//
// POST /api/instances/:slug/agents/:agentId/kickoff
//
// Validates that the permanent session for <slug>:<agentId> is empty,
// then posts a localized greeting to the runtime to trigger the agent's
// first introduction turn (BOOTSTRAP.md consumption).

import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { permission } from "../../../middleware/permission.js";
import { ACTIONS } from "../../../middleware/permission-actions.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { callRuntimeApi } from "../../_internal-api-client.js";
import { buildPermanentSessionKey } from "../../../../runtime/session/session.js";
import { getKickoffGreeting } from "../../../../runtime/session/bootstrap-fallback.js";
import { countMessagesBySessionKey } from "../../../../core/repositories/runtime-session-repository.js";
import { logger } from "../../../../lib/logger.js";
import type { ChatResponse } from "../../../../runtime/engine/internal-api.js";

/**
 * Register the kickoff route.
 * Task 3 will call this from the main router — nothing is registered here beyond this function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Keep daemon HTTP rejections distinct from transport failures and dashboard authentication. */
function kickoffErrorResponse(c: HonoContext, error: unknown): Response {
  const err = error as { status?: number; code?: string } | null;
  const status = err?.status;
  if (typeof status === "number" && status >= 400 && status < 600) {
    logger.warn(`[route:kickoff] runtime rejected request (HTTP ${status})`);
    if (status === 401 || status === 403) {
      return apiError(c, 502, "RUNTIME_AUTH_FAILED", "Runtime authentication failed");
    }
    return apiError(
      c,
      status,
      err?.code ?? "RUNTIME_ERROR",
      "Runtime rejected the agent kickoff request",
    );
  }
  logger.warn("[route:kickoff] runtime transport failed", { error: String(error) });
  return apiError(c, 502, "RUNTIME_UNREACHABLE", "Could not reach the runtime daemon");
}

export function registerAgentKickoffRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const aid = (c: HonoContext) => c.req.param("agentId");

  // -------------------------------------------------------------------------
  // POST /api/instances/:slug/agents/:agentId/kickoff
  //
  // Body: {} (empty — no required fields)
  // Response 202: { greeting: string, sessionId: string }
  // Error 404 AGENT_NOT_FOUND   — agent not found on this instance
  // Error 409 KICKOFF_ALREADY_DONE — permanent session already has messages
  // Runtime HTTP rejections keep their status/code; IPC auth failures become 502.
  // Error 502 RUNTIME_UNREACHABLE — runtime transport failed
  // -------------------------------------------------------------------------
  app.post(
    "/api/instances/:slug/agents/:agentId/kickoff",
    permission({
      action: ACTIONS.AGENT_KICKOFF,
      resource: { kind: "agent", id: aid },
      attributes: attr,
    }),
    async (c) => {
      const { instance, slug } = getInstanceContext(c);
      const agentId = c.req.param("agentId");

      // 1. Resolve agent — verify it belongs to this instance
      const agent = registry.getAgentByAgentId(instance.id, agentId);
      if (!agent) {
        return apiError(
          c,
          404,
          "AGENT_NOT_FOUND",
          `Agent '${agentId}' not found on instance '${slug}'`,
        );
      }

      // 2. Check permanent session message count
      const sessionKey = buildPermanentSessionKey(slug, agentId);
      const messageCount = countMessagesBySessionKey(db, sessionKey);

      if (messageCount > 0) {
        return apiError(
          c,
          409,
          "KICKOFF_ALREADY_DONE",
          "Permanent session already has messages — kickoff can only run once",
        );
      }

      // 3. Pick the localized greeting (from admin profile — single-user mode)
      const profile = registry.getAdminProfile();
      const greeting = getKickoffGreeting(profile?.language);

      // 4. Forward greeting to the runtime chat endpoint
      // Let the daemon resolve the permanent session and emit its lifecycle events.
      // The business session_key must never be passed as a canonical session ID.
      let result: ChatResponse;
      try {
        result = await callRuntimeApi<ChatResponse>(slug, "/internal/chat", {
          message: greeting,
          agentId,
        });
      } catch (err) {
        return kickoffErrorResponse(c, err);
      }

      // 5. Return 202 — the prompt loop is now running asynchronously
      return c.json({ greeting, sessionId: result.sessionId }, 202);
    },
  );
}
