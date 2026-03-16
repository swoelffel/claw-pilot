// src/dashboard/routes/instances/discover.ts
// Routes: POST /api/instances/discover, POST /api/instances/discover/adopt
// MUST be registered before /:slug routes to avoid Hono route collision.
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { AgentSync } from "../../../core/agent-sync.js";
import { InstanceDiscovery } from "../../../core/discovery.js";
import { getHomeDir } from "../../../lib/platform.js";
import { z } from "zod";

export function registerDiscoverRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle, xdgRuntimeDir } = deps;

  // POST /api/instances/discover — scan system for new claw-runtime instances (no DB write)
  app.post("/api/instances/discover", async (c) => {
    try {
      const homeDir = getHomeDir();
      const discovery = new InstanceDiscovery(conn, registry, homeDir, xdgRuntimeDir);
      const result = await discovery.scan();

      const found = result.newInstances.map((inst) => ({
        slug: inst.slug,
        stateDir: inst.stateDir,
        port: inst.port,
        agentCount: inst.agents.length,
        runtimeRunning: inst.runtimeRunning,
        defaultModel: inst.defaultModel,
        source: inst.source,
      }));

      return c.json({ found });
    } catch (err) {
      logger.error(`[discover] scan error: ${err instanceof Error ? err.message : String(err)}`);
      return apiError(
        c,
        500,
        "DISCOVER_FAILED",
        err instanceof Error ? err.message : "Discovery failed",
      );
    }
  });

  const AdoptBodySchema = z.object({
    slugs: z.array(z.string()).min(1).max(20),
  });

  // POST /api/instances/discover/adopt — adopt discovered instances into DB
  app.post("/api/instances/discover/adopt", async (c) => {
    let body: { slugs: string[] };
    try {
      const raw = await c.req.json();
      const parsed = AdoptBodySchema.safeParse(raw);
      if (!parsed.success) {
        return apiError(
          c,
          400,
          "INVALID_BODY",
          `Invalid body: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      body = parsed.data;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      const homeDir = getHomeDir();
      const hostname = await conn.hostname();
      const server = registry.upsertLocalServer(hostname, homeDir);

      const discovery = new InstanceDiscovery(conn, registry, homeDir, xdgRuntimeDir);
      const result = await discovery.scan();

      const adopted: string[] = [];
      const errors: string[] = [];

      for (const slug of body.slugs) {
        const instance = result.newInstances.find((i) => i.slug === slug);
        if (!instance) {
          errors.push(`${slug}: not found in scan results (may already be registered)`);
          continue;
        }
        try {
          const agentSync = new AgentSync(conn, registry);
          await discovery.adopt(instance, server.id, agentSync);
          logger.info(`[discover] adopted instance: ${slug}`);

          // Restart the runtime so it picks up any changes
          lifecycle.restart(slug).catch((err: unknown) => {
            logger.dim(`[discover] restart after adopt failed for ${slug} (non-fatal): ${err}`);
          });

          adopted.push(slug);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`${slug}: ${msg}`);
          logger.error(`[discover] adopt error for ${slug}: ${msg}`);
        }
      }

      return c.json({ adopted, errors });
    } catch (err) {
      logger.error(
        `[discover] adopt scan error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(
        c,
        500,
        "DISCOVER_FAILED",
        err instanceof Error ? err.message : "Discovery failed",
      );
    }
  });
}
