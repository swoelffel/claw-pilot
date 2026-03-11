// src/dashboard/routes/system.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";

// Read version from package.json once at module load time
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "../../../package.json");
let _version = "unknown";
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  _version = pkg.version ?? "unknown";
} catch {
  /* intentionally ignored — version stays "unknown" */
}

export function registerSystemRoutes(app: Hono, deps: RouteDeps) {
  const { registry, updateChecker, updater, selfUpdateChecker, selfUpdater, startedAt, db } = deps;

  app.get("/api/health", (c) => {
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
  });

  // GET /api/openclaw/update-status — version courante + version dispo + etat du job en cours
  app.get("/api/openclaw/update-status", async (c) => {
    try {
      const updateStatus = await updateChecker.check();
      const job = updater.getJob();
      return c.json({ ...updateStatus, ...job });
    } catch (err) {
      return apiError(
        c,
        500,
        "UPDATE_CHECK_FAILED",
        err instanceof Error ? err.message : "Check failed",
      );
    }
  });

  // POST /api/openclaw/update — declenche la mise a jour en background
  app.post("/api/openclaw/update", async (c) => {
    const job = updater.getJob();
    if (job.status === "running") {
      return apiError(c, 409, "UPDATE_RUNNING", "Update already in progress");
    }
    // Recupere les versions pour les passer au job (affichage UX)
    const status = await updateChecker.check().catch(() => ({
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
    }));
    updater.run(status.currentVersion ?? undefined, status.latestVersion ?? undefined);
    return c.json({ ok: true, jobId: updater.getJob().jobId });
  });

  // GET /api/self/update-status — version courante claw-pilot + version dispo + etat du job
  app.get("/api/self/update-status", async (c) => {
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
  });

  // POST /api/self/update — declenche la mise a jour de claw-pilot en background
  app.post("/api/self/update", async (c) => {
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
    return c.json({ ok: true, jobId: selfUpdater.getJob().jobId });
  });
}
