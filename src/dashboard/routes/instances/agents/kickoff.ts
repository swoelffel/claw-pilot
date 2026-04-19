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
import { getInstanceContext } from "../../_instance-middleware.js";
import { callRuntimeApi } from "../../_internal-api-client.js";
import { buildPermanentSessionKey } from "../../../../runtime/session/session.js";
import { getKickoffGreeting } from "../../../../runtime/session/bootstrap-fallback.js";
import { logger } from "../../../../lib/logger.js";

interface ChatResponse {
  sessionId: string;
  [key: string]: unknown;
}

/**
 * Register the kickoff route.
 * Task 3 will call this from the main router — nothing is registered here beyond this function.
 */
export function registerAgentKickoffRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // -------------------------------------------------------------------------
  // POST /api/instances/:slug/agents/:agentId/kickoff
  //
  // Body: {} (empty — no required fields)
  // Response 202: { greeting: string, sessionId: string }
  // Error 404 AGENT_NOT_FOUND   — agent not found on this instance
  // Error 409 KICKOFF_ALREADY_DONE — permanent session already has messages
  // Error 502 RUNTIME_UNREACHABLE  — runtime call failed
  // -------------------------------------------------------------------------
  app.post("/api/instances/:slug/agents/:agentId/kickoff", async (c) => {
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
    const messageCount =
      (
        db
          .prepare(
            `SELECT COUNT(*) as cnt
           FROM rt_messages m
           JOIN rt_sessions s ON s.id = m.session_id
           WHERE s.session_key = ?`,
          )
          .get(sessionKey) as { cnt: number } | undefined
      )?.cnt ?? 0;

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
    let result: ChatResponse;
    try {
      result = await callRuntimeApi<ChatResponse>(slug, "/internal/chat", {
        message: greeting,
        agentId,
        sessionId: sessionKey,
      });
    } catch (err) {
      logger.warn("[route:kickoff] runtime call failed", { error: String(err), slug, agentId });
      return apiError(c, 502, "RUNTIME_UNREACHABLE", "Could not reach the runtime daemon");
    }

    // 5. Return 202 — the prompt loop is now running asynchronously
    return c.json({ greeting, sessionId: result.sessionId ?? sessionKey }, 202);
  });
}
