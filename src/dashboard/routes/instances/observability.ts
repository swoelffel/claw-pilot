import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  getActiveAlerts,
  getObservabilityMetrics,
  getRetention,
  listTrace,
  setRetention,
  type ActivityKind,
} from "../../../core/repositories/observability-repository.js";

const RetentionSchema = z
  .object({
    logs: z.number().int().min(1).max(3650).optional(),
    metrics: z.number().int().min(1).max(3650).optional(),
    traces: z.number().int().min(1).max(3650).optional(),
    conversations: z.number().int().min(1).max(3650).optional(),
    outcomes: z.number().int().min(1).max(3650).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one policy is required");

const ACTIVITY_KINDS = new Set<ActivityKind>([
  "human_request",
  "child_agent",
  "workflow",
  "system",
]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

export function registerObservabilityRoutes(app: Hono, deps: RouteDeps): void {
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  app.get(
    "/api/instances/:slug/observability/metrics",
    permission({
      action: ACTIONS.EXECUTION_ANALYTICS,
      resource: { kind: "execution" },
      attributes: attr,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);
      const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 395);
      const rawKind = c.req.query("activityKind") as ActivityKind | undefined;
      if (rawKind && !ACTIVITY_KINDS.has(rawKind))
        return apiError(c, 400, "INVALID_ACTIVITY_KIND", "Unknown activity kind");
      return c.json({
        days,
        activityKind: rawKind ?? "all",
        ...getObservabilityMetrics(deps.db, slug, days, rawKind),
      });
    },
  );

  app.get(
    "/api/instances/:slug/observability/traces/:traceId",
    permission({
      action: ACTIONS.EXECUTION_READ,
      resource: { kind: "execution" },
      attributes: attr,
    }),
    (c) =>
      c.json({
        traceId: c.req.param("traceId"),
        events: listTrace(deps.db, getInstanceContext(c).slug, c.req.param("traceId")),
      }),
  );

  app.get(
    "/api/instances/:slug/observability/alerts",
    permission({
      action: ACTIONS.EXECUTION_ANALYTICS,
      resource: { kind: "execution" },
      attributes: attr,
    }),
    (c) => {
      const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 24) || 24, 1), 720);
      return c.json({ hours, alerts: getActiveAlerts(deps.db, getInstanceContext(c).slug, hours) });
    },
  );

  app.get(
    "/api/instances/:slug/observability/retention",
    permission({
      action: ACTIONS.EXECUTION_READ,
      resource: { kind: "execution" },
      attributes: attr,
    }),
    (c) => c.json(getRetention(deps.db, getInstanceContext(c).slug)),
  );

  app.put(
    "/api/instances/:slug/observability/retention",
    permission({
      action: ACTIONS.EXECUTION_OUTCOME_UPDATE,
      resource: { kind: "execution" },
      attributes: attr,
    }),
    async (c) => {
      const parsed = RetentionSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return apiError(c, 400, "INVALID_RETENTION_POLICY", parsed.error.message);
      const { slug } = getInstanceContext(c);
      const policies = Object.fromEntries(
        Object.entries(parsed.data).filter(
          (entry): entry is [string, number] => entry[1] !== undefined,
        ),
      );
      setRetention(deps.db, slug, policies);
      return c.json(getRetention(deps.db, slug));
    },
  );
}
