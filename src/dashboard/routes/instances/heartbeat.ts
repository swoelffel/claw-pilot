// src/dashboard/routes/instances/heartbeat.ts
// Routes: GET heartbeat/schedule, GET heartbeat/heatmap

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { loadConfigDbFirst } from "../_config-helpers.js";
import { logger } from "../../../lib/logger.js";
import {
  getHeartbeatHeatmapData,
  getHeartbeatAgentStats,
  sinceDateFromPeriod,
  type HeatmapPeriod,
} from "../../../core/repositories/heartbeat-repository.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";

const VALID_DAYS = new Set([7, 14, 30]);

function parseDays(raw: string | undefined): HeatmapPeriod {
  const n = parseInt(raw ?? "7", 10);
  if (VALID_DAYS.has(n)) return `${n}d` as HeatmapPeriod;
  return "7d";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

export function registerHeartbeatRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/heartbeat/schedule
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/heartbeat/schedule",
    permission({
      action: ACTIONS.HEARTBEAT_SCHEDULE_READ,
      resource: { kind: "heartbeat" },
      attributes: attr,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);

      try {
        const stateDir = getRuntimeStateDir(slug);
        const config = loadConfigDbFirst(registry, slug, stateDir);
        if (!config) {
          return c.json({ agents: [] });
        }
        const agents = config.agents
          .filter((a) => a.heartbeat?.every !== undefined)
          .map((a) => ({
            agentId: a.id,
            every: a.heartbeat!.every,
            ...(a.heartbeat!.model !== undefined ? { model: a.heartbeat!.model } : {}),
            ...(a.heartbeat!.activeHours !== undefined
              ? { activeHours: a.heartbeat!.activeHours }
              : {}),
          }));
        return c.json({ agents });
      } catch (err) {
        logger.debug("[route:heartbeat] schedule load failed", { error: String(err) });
        return c.json({ agents: [] });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/heartbeat/heatmap?days=7
  // ---------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/heartbeat/heatmap",
    permission({
      action: ACTIONS.HEARTBEAT_HEATMAP_READ,
      resource: { kind: "heartbeat" },
      attributes: attr,
    }),
    (c) => {
      const { slug } = getInstanceContext(c);

      const period = parseDays(c.req.query("days"));
      const since = sinceDateFromPeriod(period);
      const buckets = getHeartbeatHeatmapData(db, slug, since);
      const stats = getHeartbeatAgentStats(db, slug, since);

      return c.json({ period, buckets, stats });
    },
  );
}
