import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { loadMergedConfigDbFirst } from "../_config-helpers.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import {
  getExecution,
  getExecutionAnalytics,
  listExecutions,
  recordBusinessOutcome,
  recoverStaleExecutions,
} from "../../../core/repositories/execution-repository.js";
import type { ExecutionStatus } from "../../../core/repositories/execution-repository.js";
import {
  acknowledgeRequest,
  getRequest,
  listRequests,
  markRequestDelivered,
} from "../../../core/repositories/request-repository.js";
import type { RequestRow } from "../../../core/repositories/request-repository.js";
import { getMessage } from "../../../runtime/session/message.js";
import { listParts } from "../../../runtime/session/part.js";
import { getSession } from "../../../runtime/session/session.js";
import { buildExecutionPreflight } from "./execution-preflight.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

const OutcomeSchema = z.object({
  outcome: z.enum(["useful", "partial", "not_useful"]),
  value: z.number().finite().optional(),
});

function executionResource(c: HonoContext): { slug: string; executionId?: string } {
  return { slug: c.req.param("slug"), executionId: c.req.param("executionId") };
}

function registerExecutionReadRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;

  app.get(
    "/api/instances/:slug/requests",
    permission({
      action: ACTIONS.EXECUTION_LIST,
      resource: { kind: "execution" },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const taskIdRaw = c.req.query("taskId");
      const taskId = taskIdRaw === undefined ? undefined : Number(taskIdRaw);
      if (taskId !== undefined && (!Number.isSafeInteger(taskId) || taskId < 1)) {
        return apiError(c, 400, "INVALID_TASK_ID", "taskId must be a positive integer");
      }
      const limit = Number(c.req.query("limit") ?? 50);
      const sessionId = c.req.query("sessionId");
      const requestId = c.req.query("requestId");
      const source = c.req.query("source");
      return c.json({
        requests: listRequests(db, slug, {
          ...(taskId !== undefined ? { taskId } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(requestId !== undefined ? { requestId } : {}),
          ...(source !== undefined ? { source } : {}),
          limit: Number.isFinite(limit) ? limit : 50,
        }),
      });
    },
  );

  app.get(
    "/api/instances/:slug/requests/:requestId",
    permission({
      action: ACTIONS.EXECUTION_READ,
      resource: { kind: "execution", id: (c) => c.req.param("requestId") },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const request = getRequest(db, c.req.param("requestId"));
      if (!request || request.instance_slug !== slug) {
        return apiError(c, 404, "REQUEST_NOT_FOUND", "Request not found");
      }
      const executions = db
        .prepare("SELECT * FROM rt_executions WHERE request_id = ? ORDER BY accepted_at ASC")
        .all(request.id);
      return c.json({ request, executions });
    },
  );

  app.get(
    "/api/instances/:slug/executions",
    permission({
      action: ACTIONS.EXECUTION_LIST,
      resource: { kind: "execution" },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const rawStatus = c.req.query("status");
      const statuses: ExecutionStatus[] = [
        "accepted",
        "running",
        "succeeded",
        "failed",
        "timed_out",
        "cancelled",
      ];
      if (rawStatus && !statuses.includes(rawStatus as ExecutionStatus)) {
        return apiError(c, 400, "INVALID_STATUS", `Unknown execution status: ${rawStatus}`);
      }
      const limit = Number(c.req.query("limit") ?? 50);
      return c.json({
        executions: listExecutions(db, slug, {
          ...(rawStatus ? { status: rawStatus as ExecutionStatus } : {}),
          limit: Number.isFinite(limit) ? limit : 50,
        }),
      });
    },
  );

  app.get(
    "/api/instances/:slug/executions/analytics",
    permission({
      action: ACTIONS.EXECUTION_ANALYTICS,
      resource: { kind: "execution" },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
      const metrics = getExecutionAnalytics(db, slug, days);
      const total = metrics["total"] ?? 0;
      const succeeded = metrics["succeeded"] ?? 0;
      const useful = metrics["useful"] ?? 0;
      return c.json({
        days,
        ...metrics,
        successRate: total > 0 ? succeeded / total : 0,
        usefulRate: succeeded > 0 ? useful / succeeded : 0,
      });
    },
  );

  app.get(
    "/api/instances/:slug/executions/:executionId",
    permission({
      action: ACTIONS.EXECUTION_READ,
      resource: { kind: "execution", id: (c) => c.req.param("executionId") },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const row = getExecution(db, c.req.param("executionId"));
      if (!row || row.instance_slug !== slug) {
        return apiError(c, 404, "EXECUTION_NOT_FOUND", "Execution not found");
      }
      return c.json(row);
    },
  );
}

/** Load the durable message without running tools or retrying the originating channel. */
function readRequestResult(db: RouteDeps["db"], request: RequestRow, slug: string) {
  if (!request.result_message_id || request.delivery_status === "pending") return undefined;
  const message = getMessage(db, request.result_message_id);
  if (!message || message.role !== "assistant" || message.sessionId !== request.session_id) {
    return undefined;
  }
  if (getSession(db, message.sessionId)?.instanceSlug !== slug) return undefined;
  const parts = listParts(db, message.id);
  if (
    !parts.some(
      (part) =>
        ["text", "image", "tool_call", "tool_result"].includes(part.type) && part.content?.trim(),
    )
  )
    return undefined;
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.content ?? "")
    .join("\n\n");
  const partial =
    !message.finishReason ||
    ["error", "length", "content-filter"].includes(message.finishReason) ||
    parts.some(
      (part) => part.state === "pending" || part.state === "running" || part.state === "error",
    );
  return { message: { ...message, parts }, text, partial };
}

function registerExecutionActionRoutes(app: Hono, deps: RouteDeps): void {
  const { db, registry } = deps;

  app.post(
    "/api/instances/:slug/requests/:requestId/acknowledge",
    permission({
      action: ACTIONS.EXECUTION_OUTCOME_UPDATE,
      resource: { kind: "execution", id: (c) => c.req.param("requestId") },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const request = getRequest(db, c.req.param("requestId"));
      if (!request || request.instance_slug !== slug) {
        return apiError(c, 404, "REQUEST_NOT_FOUND", "Request not found");
      }
      const updated = acknowledgeRequest(db, request.id);
      if (updated?.delivery_status !== "acknowledged") {
        return apiError(c, 409, "RESULT_NOT_DELIVERED", "Request has not been delivered");
      }
      return c.json(updated);
    },
  );

  app.post(
    "/api/instances/:slug/requests/:requestId/recover-delivery",
    permission({
      action: ACTIONS.EXECUTION_RECOVER,
      resource: { kind: "execution", id: (c) => c.req.param("requestId") },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const request = getRequest(db, c.req.param("requestId"));
      if (!request || request.instance_slug !== slug) {
        return apiError(c, 404, "REQUEST_NOT_FOUND", "Request not found");
      }
      const result = readRequestResult(db, request, slug);
      if (!result) {
        return apiError(c, 409, "RESULT_NOT_PERSISTED", "No durable result is available");
      }
      // Delivered means returned through this dashboard API, not resent to the source channel.
      // Partial results remain recoverable and retain the original delivery diagnostics.
      if (!result.partial) markRequestDelivered(db, request.id);
      return c.json({ ...getRequest(db, request.id), result });
    },
  );

  app.post(
    "/api/instances/:slug/executions/recover",
    permission({
      action: ACTIONS.EXECUTION_RECOVER,
      resource: { kind: "execution" },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      return c.json({ recovered: recoverStaleExecutions(db, slug) });
    },
  );

  app.post(
    "/api/instances/:slug/executions/:executionId/outcome",
    permission({
      action: ACTIONS.EXECUTION_OUTCOME_UPDATE,
      resource: { kind: "execution", id: (c) => c.req.param("executionId") },
      attributes: executionResource,
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);
      const existing = getExecution(db, c.req.param("executionId"));
      if (!existing || existing.instance_slug !== slug) {
        return apiError(c, 404, "EXECUTION_NOT_FOUND", "Execution not found");
      }
      const parsed = OutcomeSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
      if (existing.status !== "succeeded") {
        return apiError(c, 409, "EXECUTION_NOT_COMPLETED", "Only successful work can be rated");
      }
      return c.json(recordBusinessOutcome(db, existing.id, parsed.data.outcome, parsed.data.value));
    },
  );

  app.get(
    "/api/instances/:slug/preflight",
    permission({
      action: ACTIONS.EXECUTION_PREFLIGHT,
      resource: { kind: "execution" },
      attributes: executionResource,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const user = c.get("user");
      const config = loadMergedConfigDbFirst(registry, slug, getRuntimeStateDir(slug));
      if (!config) return apiError(c, 404, "RUNTIME_CONFIG_NOT_FOUND", "Runtime config not found");
      const agentId = c.req.query("agentId") ?? config.agents[0]?.id;
      const agent = config.agents.find((candidate) => candidate.id === agentId);
      if (!agentId || !agent) {
        return apiError(c, 404, "AGENT_NOT_FOUND", `Agent ${agentId ?? "(default)"} not found`);
      }
      const workDir = getRuntimeStateDir(slug);
      const requestedTool = c.req.query("tool");
      const requestedResource = c.req.query("resource");
      return c.json(
        buildExecutionPreflight({
          db,
          slug,
          config,
          agent,
          user,
          workDir,
          ...(requestedTool !== undefined ? { requestedTool } : {}),
          ...(requestedResource !== undefined ? { requestedResource } : {}),
        }),
      );
    },
  );
}

/** Register execution lifecycle, recovery, diagnostics, and outcome analytics endpoints. */
export function registerExecutionRoutes(app: Hono, deps: RouteDeps): void {
  registerExecutionReadRoutes(app, deps);
  registerExecutionActionRoutes(app, deps);
}
