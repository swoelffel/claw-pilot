// src/dashboard/routes/instances/discover.ts
// Routes: POST /api/instances/discover, POST /api/instances/discover/adopt
// MUST be registered before /:slug routes to avoid Hono route collision.
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { AgentSync } from "../../../core/agent-sync.js";
import { InstanceDiscovery } from "../../../core/discovery.js";
import { getOpenClawHome } from "../../../lib/platform.js";
import { OpenClawCLI } from "../../../core/openclaw-cli.js";
import { z } from "zod/v4";
import type { ServerConnection } from "../../../server/connection.js";

async function ensureGatewayModeLocal(
  conn: ServerConnection,
  configPath: string,
  slug: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await conn.readFile(configPath);
  } catch {
    logger.dim(`[discover] cannot read config for ${slug} — skipping gateway.mode patch`);
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    logger.dim(`[discover] invalid JSON in config for ${slug} — skipping gateway.mode patch`);
    return;
  }

  const gateway = config["gateway"] as Record<string, unknown> | undefined;
  if (gateway?.["mode"] === "local") return;

  if (!gateway) {
    config["gateway"] = { mode: "local" };
  } else {
    gateway["mode"] = "local";
  }

  try {
    await conn.writeFile(configPath, JSON.stringify(config, null, 2));
    logger.info(`[discover] patched gateway.mode=local in ${configPath}`);
  } catch (err) {
    logger.warn(`[discover] failed to patch gateway.mode for ${slug}: ${err}`);
  }
}

export function registerDiscoverRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle, xdgRuntimeDir } = deps;

  // POST /api/instances/discover — scan system for new OpenClaw instances (no DB write)
  app.post("/api/instances/discover", async (c) => {
    try {
      const openclawHome = getOpenClawHome();
      const discovery = new InstanceDiscovery(conn, registry, openclawHome, xdgRuntimeDir);
      const result = await discovery.scan();

      const found = result.newInstances.map((inst) => ({
        slug: inst.slug,
        stateDir: inst.stateDir,
        port: inst.port,
        agentCount: inst.agents.length,
        gatewayHealthy: inst.gatewayHealthy,
        systemdState: inst.systemdState,
        telegramBot: inst.telegramBot,
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
      const cli = new OpenClawCLI(conn);
      const openclaw = await cli.detect();
      if (openclaw) {
        registry.updateServerBin(openclaw.bin, openclaw.version);
        logger.info(`[discover] openclaw detected: ${openclaw.version}`);
      }

      // Use home derived from detection (e.g. /opt/openclaw) so stateDirs resolve correctly
      const openclawHome = openclaw?.home ?? getOpenClawHome();

      const hostname = await conn.hostname();
      const server = registry.upsertLocalServer(hostname, openclawHome);

      const discovery = new InstanceDiscovery(conn, registry, openclawHome, xdgRuntimeDir);
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

          await ensureGatewayModeLocal(conn, instance.configPath, slug);

          // Restart the service so the patched config takes effect
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
