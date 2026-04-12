// src/dashboard/routes/instances/runtime-tools.ts
// Routes: GET runtime/tools, POST questions/:questionId/answer, GET runtime/heartbeat/history
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { callRuntimeApi } from "../_internal-api-client.js";

/** Fallback keyword matching for historical messages without structured metadata. */
function detectHeartbeatStatusFallback(text: string): "ok" | "alert" {
  if (!text) return "ok";
  if (text.startsWith("HEARTBEAT_OK")) return "ok";
  // Check for known alert patterns
  const lower = text.toLowerCase();
  const alertPatterns = ["heartbeat_alert", "heartbeat error:", "error:", "failed"];
  return alertPatterns.some((p) => lower.includes(p)) ? "alert" : "ok";
}

export function registerRuntimeToolRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;

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
    const { slug } = getInstanceContext(c);
    const questionId = c.req.param("questionId");

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

    // Forward to the runtime process via internal API (dashboard and runtime are separate processes)
    try {
      const result = await callRuntimeApi<{ ok: boolean; resolved: boolean }>(
        slug,
        `/internal/questions/${questionId}/answer`,
        { answer: body.answer },
        { timeoutMs: 10_000 },
      );

      if (!result.resolved) {
        return apiError(
          c,
          404,
          "QUESTION_NOT_FOUND",
          `No pending question with ID "${questionId}" — it may have expired or already been answered.`,
        );
      }

      return c.json({ ok: true, questionId, answer: body.answer });
    } catch (err) {
      logger.warn("[route:runtime] question answer forwarding failed", { error: String(err) });
      return apiError(c, 502, "RUNTIME_UNREACHABLE", "Cannot reach runtime to resolve question");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/heartbeat/history
  // Returns heartbeat tick history for a specific agent (channel = 'internal')
  // Query params: agentId (required), limit (optional, default 20, max 100)
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/heartbeat/history", (c) => {
    const { slug } = getInstanceContext(c);

    const agentId = c.req.query("agentId");
    if (!agentId) {
      return apiError(c, 400, "MISSING_AGENT_ID", "agentId query param is required");
    }

    const limitParam = c.req.query("limit");
    const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 100);

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
