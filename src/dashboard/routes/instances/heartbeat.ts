// src/dashboard/routes/instances/heartbeat.ts
// Routes: GET heartbeat/schedule, GET heartbeat/heatmap

import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { loadConfigDbFirst } from "../_config-helpers.js";
import {
  getHeartbeatHeatmapData,
  getHeartbeatAgentStats,
  sinceDateFromPeriod,
  type HeatmapPeriod,
} from "../../../core/repositories/heartbeat-repository.js";

const VALID_DAYS = new Set([7, 14, 30]);

function parseDays(raw: string | undefined): HeatmapPeriod {
  const n = parseInt(raw ?? "7", 10);
  if (VALID_DAYS.has(n)) return `${n}d` as HeatmapPeriod;
  return "7d";
}

export function registerHeartbeatRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/heartbeat/schedule
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/heartbeat/schedule", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

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
    } catch {
      return c.json({ agents: [] });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/heartbeat/heatmap?days=7
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/heartbeat/heatmap", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const period = parseDays(c.req.query("days"));
    const since = sinceDateFromPeriod(period);
    const buckets = getHeartbeatHeatmapData(db, slug, since);
    const stats = getHeartbeatAgentStats(db, slug, since);

    return c.json({ period, buckets, stats });
  });
}
