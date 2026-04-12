// src/dashboard/routes/instances/runtime-status.ts
// Routes: GET runtime/status, GET runtime/sessions, DELETE runtime/sessions
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import {
  listEnrichedSessions,
  purgeArchivedSessions,
} from "../../../core/repositories/runtime-session-repository.js";
import { loadMergedConfigDbFirst } from "../_config-helpers.js";

export function registerRuntimeStatusRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/status
  // Returns runtime config + whether runtime.json exists
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/status", (c) => {
    const { slug } = getInstanceContext(c);

    const stateDir = getRuntimeStateDir(slug);
    const config = loadMergedConfigDbFirst(registry, slug, stateDir);

    if (!config) {
      return c.json({ slug, hasConfig: false, config: null });
    }

    return c.json({ slug, hasConfig: true, config });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/runtime/sessions
  // List active runtime sessions for an instance — enriched with aggregated stats
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/runtime/sessions", (c) => {
    const { slug } = getInstanceContext(c);

    const stateParam = c.req.query("state") as "active" | "archived" | "all" | undefined;
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const includeInternal = c.req.query("includeInternal") === "true";
    const agentId = c.req.query("agentId");
    const since = c.req.query("since");
    const until = c.req.query("until");
    const persistentParam = c.req.query("persistent");
    const before = c.req.query("before");

    // Delegate to repository (handles fallback on older DB schemas)
    const { sessions, hasMore } = listEnrichedSessions(db, slug, {
      ...(stateParam !== undefined ? { state: stateParam } : {}),
      limit,
      includeInternal,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
      ...(persistentParam !== undefined
        ? { persistent: parseInt(persistentParam, 10) as 0 | 1 }
        : {}),
      ...(before !== undefined ? { before } : {}),
    });

    return c.json({ sessions, hasMore });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/instances/:slug/runtime/sessions?state=archived
  // Purge all archived ephemeral sessions for an instance (persistent sessions untouched).
  // ---------------------------------------------------------------------------
  app.delete("/api/instances/:slug/runtime/sessions", (c) => {
    const { slug } = getInstanceContext(c);

    const stateParam = c.req.query("state");
    if (stateParam !== "archived") {
      return apiError(c, 400, "INVALID_PARAM", "Only state=archived is supported");
    }

    try {
      const result = purgeArchivedSessions(db, slug);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return apiError(c, 500, "PURGE_FAILED", err instanceof Error ? err.message : "Purge failed");
    }
  });
}
