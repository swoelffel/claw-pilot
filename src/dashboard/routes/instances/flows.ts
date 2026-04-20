// src/dashboard/routes/instances/flows.ts
// Routes: CRUD for flow definitions + execution control

import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  createFlowDefinition,
  getFlowDefinition,
  listFlowDefinitions,
  updateFlowDefinition,
  deleteFlowDefinition,
  listFlowRuns,
  getFlowRun,
  getStepRunsForRun,
  updateFlowRunStatus,
  updateStepRun,
  countFlowSessions,
  listFlowSessions,
  getRunWorstOutcome,
} from "../../../core/repositories/flow-repository.js";
import {
  upsertSearchEntry,
  removeSearchEntry,
} from "../../../core/repositories/search-repository.js";
import { callRuntimeApi } from "../_internal-api-client.js";
import { runtimeGuard } from "../_runtime-guard.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const FlowStepSchema = z.object({
  id: z.string().min(1).max(50),
  agentId: z.string().min(1),
  prompt: z.string().min(1).max(5000),
  dependsOn: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  maxSteps: z.number().int().min(1).max(200).optional(),
  briefing: z
    .object({
      includeLastN: z.number().int().min(0).max(50).optional(),
      extraContext: z.string().max(5000).optional(),
    })
    .optional(),
});

const FlowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    type: z.literal("bus"),
    event: z.string().min(1),
    filter: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const CreateFlowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  steps: z.array(FlowStepSchema).min(1).max(30),
  trigger: FlowTriggerSchema.optional(),
  enabled: z.boolean().optional(),
});

const UpdateFlowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  steps: z.array(FlowStepSchema).min(1).max(30).optional(),
  trigger: FlowTriggerSchema.optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// DAG validation
// ---------------------------------------------------------------------------

/** Topological sort — returns null if a cycle is detected. */
function topologicalSort(steps: Array<{ id: string; dependsOn: string[] }>): string[] | null {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    graph.set(step.id, []);
    inDegree.set(step.id, 0);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!graph.has(dep)) return null; // Reference to unknown step
      graph.get(dep)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of graph.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted.length === steps.length ? sorted : null;
}

/** Validate step definitions: unique IDs, valid deps, no cycles. */
function validateSteps(steps: Array<{ id: string; dependsOn: string[] }>): string | null {
  // Check unique IDs
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) return `Duplicate step ID: "${step.id}"`;
    ids.add(step.id);
  }

  // Check dep references
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) return `Step "${step.id}" depends on unknown step "${dep}"`;
    }
  }

  // Check for cycles
  if (!topologicalSort(steps)) return "Steps contain a dependency cycle";

  return null;
}

// ---------------------------------------------------------------------------
// Extracted route handlers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;
type DB = RouteDeps["db"];

/** Handle POST /flows — create a new flow definition. */
async function handleCreateFlow(
  c: HonoContext,
  db: DB,
  registry: RouteDeps["registry"],
): Promise<Response> {
  const { slug } = getInstanceContext(c);

  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");

  const parsed = CreateFlowSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);

  const data = parsed.data;

  const dagErr = validateSteps(data.steps);
  if (dagErr) return apiError(c, 400, "INVALID_DAG", dagErr);

  const agents = registry.listAgents(slug);
  const agentIds = new Set(agents.map((a: { agent_id: string }) => a.agent_id));
  for (const step of data.steps) {
    if (!agentIds.has(step.agentId)) {
      return apiError(c, 400, "INVALID_AGENT", `Agent "${step.agentId}" not found in instance`);
    }
  }

  const flow = createFlowDefinition(db, {
    instanceSlug: slug,
    name: data.name,
    ...(data.description !== undefined ? { description: data.description } : {}),
    stepsJson: JSON.stringify(data.steps),
    ...(data.trigger !== undefined ? { triggerJson: JSON.stringify(data.trigger) } : {}),
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
  });

  upsertSearchEntry(db, {
    entityType: "flow",
    entityId: String(flow.id),
    title: flow.name,
    subtitle: `${data.steps.length} steps`,
    routeHash: `/instances/${slug}/flows`,
  });

  return c.json({ flow }, 201);
}

/** Handle PATCH /flows/:id — update an existing flow definition. */
async function handleUpdateFlow(c: HonoContext, db: DB): Promise<Response> {
  const { slug } = getInstanceContext(c);
  const id = Number(c.req.param("id"));

  const existing = getFlowDefinition(db, id);
  if (!existing || existing.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Flow not found");
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");

  const parsed = UpdateFlowSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);

  const data = parsed.data;

  if (data.steps) {
    const dagErr = validateSteps(data.steps);
    if (dagErr) return apiError(c, 400, "INVALID_DAG", dagErr);
  }

  const updated = updateFlowDefinition(db, id, {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.steps !== undefined ? { stepsJson: JSON.stringify(data.steps) } : {}),
    ...(data.trigger !== undefined ? { triggerJson: JSON.stringify(data.trigger) } : {}),
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
  });

  if (updated) {
    upsertSearchEntry(db, {
      entityType: "flow",
      entityId: String(updated.id),
      title: updated.name,
      subtitle: `${JSON.parse(updated.steps_json).length} steps`,
      routeHash: `/instances/${slug}/flows`,
    });
  }

  return c.json({ flow: updated });
}

/** Handle POST /flows/:id/run — trigger manual flow execution. */
async function handleTriggerFlowRun(c: HonoContext, db: DB, slug: string): Promise<Response> {
  const id = Number(c.req.param("id"));

  const rtGuard = runtimeGuard(c, slug);
  if (rtGuard) return rtGuard;

  const flow = getFlowDefinition(db, id);
  if (!flow || flow.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Flow not found");
  }

  if (!flow.enabled) {
    return apiError(c, 400, "FLOW_DISABLED", "Flow is disabled");
  }

  const activeRuns = listFlowRuns(db, slug, { flowId: id, status: "running" });
  if (activeRuns.length > 0) {
    return apiError(c, 409, "ALREADY_RUNNING", "A run is already in progress for this flow");
  }

  try {
    const result = await callRuntimeApi<{ runId: number }>(slug, `/internal/flows/${id}/run`, {
      triggerType: "manual",
    });
    return c.json({ runId: result.runId }, 202);
  } catch (startErr: unknown) {
    logger.error("flow_start_failed", {
      event: "flow_start_failed",
      slug,
      flowId: id,
      error: String(startErr),
    });
    return apiError(c, 500, "FLOW_START_FAILED", String(startErr));
  }
}

/** Handle GET /flow-runs/:runId — get run detail + step runs. */
function handleGetFlowRunDetail(c: HonoContext, db: DB, slug: string): Response {
  const runId = Number(c.req.param("runId"));

  const run = getFlowRun(db, runId);
  if (!run || run.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Flow run not found");
  }

  const rawSteps = getStepRunsForRun(db, runId);

  // Enrich running steps with no session_id by looking up active session by label
  const flow = getFlowDefinition(db, run.flow_id);
  const steps = rawSteps.map((s) => {
    if (s.status === "running" && !s.session_id && flow) {
      const label = `flow:${flow.name}:step:${s.step_id}`;
      const session = db
        .prepare(
          `SELECT id FROM rt_sessions
           WHERE instance_slug = ? AND label = ? AND state = 'active'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(slug, label) as { id: string } | undefined;
      if (session) return { ...s, session_id: session.id };
    }
    return s;
  });

  return c.json({ run, steps });
}

/** Handle POST /flow-runs/:runId/cancel — cancel a running flow. */
function handleCancelFlowRun(c: HonoContext, db: DB, slug: string): Response {
  const runId = Number(c.req.param("runId"));

  const run = getFlowRun(db, runId);
  if (!run || run.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Flow run not found");
  }
  if (run.status !== "running" && run.status !== "pending") {
    return apiError(c, 400, "NOT_CANCELLABLE", `Run is already ${run.status}`);
  }

  const steps = getStepRunsForRun(db, runId);
  for (const step of steps) {
    if (step.status === "pending") {
      updateStepRun(db, step.id, { status: "skipped" });
    }
  }

  updateFlowRunStatus(db, runId, "cancelled");
  return c.json({ ok: true });
}

/** Handle GET /flows/:id/runs — list runs for a flow. */
function handleListFlowRuns(c: HonoContext, db: DB, slug: string): Response {
  const id = Number(c.req.param("id"));
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const rawRuns = listFlowRuns(db, slug, { flowId: id, limit: limit + 1 });
  const hasMore = rawRuns.length > limit;
  if (hasMore) rawRuns.pop();
  const runs = rawRuns.map((r) => ({ ...r, worstOutcome: getRunWorstOutcome(db, r.id) }));
  return c.json({ runs, hasMore });
}

/** Handle GET /flows/:id/sessions — list sessions for a flow. */
function handleListFlowSessions(c: HonoContext, db: DB, slug: string): Response {
  const id = Number(c.req.param("id"));
  const flow = getFlowDefinition(db, id);
  if (!flow || flow.instance_slug !== slug) {
    return apiError(c, 404, "NOT_FOUND", "Flow not found");
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "30"), 100);
  const before = c.req.query("before") || undefined;
  const result = listFlowSessions(db, id, {
    limit,
    ...(before !== undefined ? { before } : {}),
  });
  return c.json(result);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerFlowRoutes(app: Hono, deps: RouteDeps): void {
  const { db, registry } = deps;

  // GET /api/instances/:slug/flows — list flow definitions
  app.get(
    "/api/instances/:slug/flows",
    permission({
      action: ACTIONS.FLOW_LIST,
      resource: { kind: "flow" },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);

      const flows = listFlowDefinitions(db, slug);

      // Enrich with last run info + session count
      const enriched = flows.map((f) => {
        const runs = listFlowRuns(db, slug, { flowId: f.id, limit: 1 });
        return {
          ...f,
          lastRun: runs[0] ?? null,
          sessionCount: countFlowSessions(db, f.id),
        };
      });

      return c.json({ flows: enriched });
    },
  );

  // GET /api/instances/:slug/flows/:id — get flow definition + recent runs
  app.get(
    "/api/instances/:slug/flows/:id",
    permission({
      action: ACTIONS.FLOW_READ,
      resource: { kind: "flow", id: (c) => c.req.param("id") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const id = Number(c.req.param("id"));

      const flow = getFlowDefinition(db, id);
      if (!flow || flow.instance_slug !== slug) {
        return apiError(c, 404, "NOT_FOUND", "Flow not found");
      }

      const runs = listFlowRuns(db, slug, { flowId: id, limit: 10 });
      return c.json({ flow, runs });
    },
  );

  // POST /api/instances/:slug/flows — create flow definition
  app.post(
    "/api/instances/:slug/flows",
    permission({
      action: ACTIONS.FLOW_CREATE,
      resource: { kind: "flow" },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    async (c) => {
      return handleCreateFlow(c, db, registry);
    },
  );

  // PATCH /api/instances/:slug/flows/:id — update flow definition
  app.patch(
    "/api/instances/:slug/flows/:id",
    permission({
      action: ACTIONS.FLOW_UPDATE,
      resource: { kind: "flow", id: (c) => c.req.param("id") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    async (c) => {
      return handleUpdateFlow(c, db);
    },
  );

  // DELETE /api/instances/:slug/flows/:id — delete flow definition
  app.delete(
    "/api/instances/:slug/flows/:id",
    permission({
      action: ACTIONS.FLOW_DELETE,
      resource: { kind: "flow", id: (c) => c.req.param("id") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const id = Number(c.req.param("id"));

      const existing = getFlowDefinition(db, id);
      if (!existing || existing.instance_slug !== slug) {
        return apiError(c, 404, "NOT_FOUND", "Flow not found");
      }

      deleteFlowDefinition(db, id);
      removeSearchEntry(db, "flow", String(id));

      return c.json({ ok: true });
    },
  );

  // POST /api/instances/:slug/flows/:id/run — trigger manual execution
  app.post(
    "/api/instances/:slug/flows/:id/run",
    permission({
      action: ACTIONS.FLOW_RUN,
      resource: { kind: "flow", id: (c) => c.req.param("id") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    async (c) => {
      const { slug } = getInstanceContext(c);
      return handleTriggerFlowRun(c, db, slug);
    },
  );

  // GET /api/instances/:slug/flows/:id/runs — list runs for a flow
  app.get(
    "/api/instances/:slug/flows/:id/runs",
    permission({
      action: ACTIONS.FLOW_RUNS_LIST,
      resource: { kind: "flow", id: (c) => c.req.param("id") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      return handleListFlowRuns(c, db, slug);
    },
  );

  // GET /api/instances/:slug/flow-runs/:runId — get run detail + step runs
  app.get(
    "/api/instances/:slug/flow-runs/:runId",
    permission({
      action: ACTIONS.FLOW_RUN_READ,
      resource: { kind: "flow", id: (c) => c.req.param("runId") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      return handleGetFlowRunDetail(c, db, slug);
    },
  );

  // POST /api/instances/:slug/flow-runs/:runId/cancel — cancel a running flow
  app.post(
    "/api/instances/:slug/flow-runs/:runId/cancel",
    permission({
      action: ACTIONS.FLOW_RUN_CANCEL,
      resource: { kind: "flow", id: (c) => c.req.param("runId") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      return handleCancelFlowRun(c, db, slug);
    },
  );

  // GET /api/instances/:slug/flows/:id/sessions — list sessions for a flow
  app.get(
    "/api/instances/:slug/flows/:id/sessions",
    permission({
      action: ACTIONS.FLOW_SESSIONS_LIST,
      resource: { kind: "flow", id: (c) => c.req.param("id") },
      attributes: (c) => ({ slug: c.req.param("slug") }),
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      return handleListFlowSessions(c, db, slug);
    },
  );
}
