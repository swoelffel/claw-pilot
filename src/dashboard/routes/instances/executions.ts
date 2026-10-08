import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { loadMergedConfigDbFirst } from "../_config-helpers.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { checkBudgets } from "../../../core/repositories/budget-repository.js";
import {
  getCircuit,
  getExecution,
  getExecutionAnalytics,
  inspectCircuit,
  listExecutions,
  recordBusinessOutcome,
  recoverStaleExecutions,
} from "../../../core/repositories/execution-repository.js";
import type { ExecutionStatus } from "../../../core/repositories/execution-repository.js";

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

function registerExecutionActionRoutes(app: Hono, deps: RouteDeps): void {
  const { db, registry } = deps;

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
      const config = loadMergedConfigDbFirst(registry, slug, getRuntimeStateDir(slug));
      if (!config) return apiError(c, 404, "RUNTIME_CONFIG_NOT_FOUND", "Runtime config not found");
      const agentId = c.req.query("agentId") ?? config.agents[0]?.id;
      const agent = config.agents.find((candidate) => candidate.id === agentId);
      if (!agentId || !agent) {
        return apiError(c, 404, "AGENT_NOT_FOUND", `Agent ${agentId ?? "(default)"} not found`);
      }
      const model = agent.model ?? config.defaultModel ?? "";
      const circuit = inspectCircuit(db, slug, `provider:${model}`);
      const budgets = checkBudgets(db, slug, agentId);
      const key = db
        .prepare(
          `SELECT k.id, k.name, k.provider_id FROM instances i
           LEFT JOIN agents a ON a.instance_id = i.id AND a.agent_id = ?
           LEFT JOIN named_api_keys k ON k.id = COALESCE(a.named_key_id, i.default_named_key_id)
           WHERE i.slug = ?`,
        )
        .get(agentId, slug) as
        | { id: number | null; name: string | null; provider_id: string | null }
        | undefined;
      const checks = [
        { id: "agent", status: "pass", detail: agentId },
        {
          id: "model",
          status: model ? "pass" : "fail",
          detail: model || "No model configured",
        },
        {
          id: "authentication",
          status: key?.id ? "pass" : "warn",
          detail: key?.id
            ? `Named key ${key.name ?? key.id} (${key.provider_id})`
            : "No named key assigned; runtime environment fallback will be used",
        },
        {
          id: "provider-circuit",
          status: circuit?.state === "open" ? "fail" : "pass",
          detail: circuit?.state ?? "closed",
        },
        {
          id: "budget",
          status: budgets.some((budget) => budget.status === "exceeded") ? "fail" : "pass",
          detail:
            budgets.length === 0 ? "No enforced budget" : `${budgets.length} budget(s) checked`,
        },
      ];
      return c.json({
        ready: !checks.some((check) => check.status === "fail"),
        agentId,
        model,
        checks,
        circuit: getCircuit(db, slug, `provider:${model}`) ?? null,
      });
    },
  );
}

/** Register execution lifecycle, recovery, diagnostics, and outcome analytics endpoints. */
export function registerExecutionRoutes(app: Hono, deps: RouteDeps): void {
  registerExecutionReadRoutes(app, deps);
  registerExecutionActionRoutes(app, deps);
}
