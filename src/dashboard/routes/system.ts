// src/dashboard/routes/system.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { logger } from "../../lib/logger.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";

// Read version from package.json once at module load time
// After bundling, all chunks are in dist/ — one level up is the project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "../package.json");
let _version = "unknown";
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  _version = pkg.version ?? "unknown";
} catch (err) {
  logger.debug("[route:system] failed to read package.json version", { error: String(err) });
  /* intentionally ignored — version stays "unknown" */
}

export function registerSystemRoutes(app: Hono, deps: RouteDeps) {
  const { registry, selfUpdateChecker, selfUpdater, startedAt, db } = deps;

  app.get(
    "/api/health",
    permission({ action: ACTIONS.SYSTEM_HEALTH, resource: { kind: "system" } }),
    (c) => {
      const instances = registry.listInstances();
      const running = instances.filter((i) => i.state === "running").length;

      // Query DB page size to compute total database size in bytes
      const dbSize =
        (
          db
            .prepare(
              "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()",
            )
            .get() as { size: number } | undefined
        )?.size ?? 0;

      return c.json({
        ok: true,
        version: _version,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        instances: { total: instances.length, running },
        db: { sizeBytes: dbSize },
      });
    },
  );

  // GET /api/self/update-status — version courante claw-pilot + version dispo + etat du job
  app.get(
    "/api/self/update-status",
    permission({ action: ACTIONS.SYSTEM_UPDATE_STATUS, resource: { kind: "system" } }),
    async (c) => {
      try {
        const updateStatus = await selfUpdateChecker.check();
        const job = selfUpdater.getJob();
        return c.json({ ...updateStatus, ...job });
      } catch (err) {
        return apiError(
          c,
          500,
          "SELF_UPDATE_CHECK_FAILED",
          err instanceof Error ? err.message : "Check failed",
        );
      }
    },
  );

  // POST /api/self/update — declenche la mise a jour de claw-pilot en background
  app.post(
    "/api/self/update",
    permission({ action: ACTIONS.SYSTEM_UPDATE_APPLY, resource: { kind: "system" } }),
    async (c) => {
      const job = selfUpdater.getJob();
      if (job.status === "running") {
        return apiError(c, 409, "SELF_UPDATE_RUNNING", "Self-update already in progress");
      }
      const status = await selfUpdateChecker.check().catch(() => ({
        currentVersion: "0.0.0",
        latestVersion: null,
        latestTag: null,
        updateAvailable: false,
      }));
      selfUpdater.run(
        status.currentVersion,
        status.latestVersion ?? undefined,
        status.latestTag ?? undefined,
      );
      // Invalider le cache du checker pour que le prochain poll reflète l'état post-update
      selfUpdateChecker.invalidateCache();
      return c.json({ ok: true, jobId: selfUpdater.getJob().jobId });
    },
  );
}
