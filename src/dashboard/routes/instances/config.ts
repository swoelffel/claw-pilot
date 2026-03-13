// src/dashboard/routes/instances/config.ts
// Routes: GET/PATCH config, providers
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { logger } from "../../../lib/logger.js";
import { PROVIDER_CATALOG } from "../../../lib/provider-catalog.js";
import type { ProviderInfo } from "../../../lib/provider-catalog.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import {
  runtimeConfigExists,
  loadRuntimeConfig,
  saveRuntimeConfig,
} from "../../../runtime/index.js";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Config patch schema for runtime instances
// ---------------------------------------------------------------------------

const RuntimeConfigPatchSchema = z.object({
  general: z
    .object({
      displayName: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
});

type RuntimeConfigPatch = z.infer<typeof RuntimeConfigPatchSchema>;

export function registerConfigRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, lifecycle } = deps;

  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);

    if (!runtimeConfigExists(stateDir)) {
      // Return a minimal stub when runtime.json does not exist yet
      return c.json({
        general: {
          displayName: instance!.display_name ?? "",
          defaultModel: instance!.default_model ?? "",
          port: instance!.port,
        },
        agents: [],
        channels: { telegram: null },
      });
    }

    try {
      const config = loadRuntimeConfig(stateDir);
      return c.json({
        general: {
          displayName: instance!.display_name ?? "",
          defaultModel: config.defaultModel,
          port: instance!.port,
        },
        agents: config.agents,
        channels: {
          telegram: config.telegram.enabled ? { enabled: true } : null,
        },
        mcpEnabled: config.mcpEnabled,
        mcpServers: config.mcpServers,
        webChat: config.webChat,
      });
    } catch (err) {
      logger.error(
        `[config] GET /config error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(
        c,
        500,
        "CONFIG_READ_FAILED",
        err instanceof Error ? err.message : "Failed to read config",
      );
    }
  });

  // PATCH /api/instances/:slug/config — apply partial config changes
  app.patch("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let patch: RuntimeConfigPatch;
    try {
      const raw = await c.req.json();
      const result = RuntimeConfigPatchSchema.safeParse(raw);
      if (!result.success) {
        return apiError(c, 400, "INVALID_BODY", "Invalid config patch");
      }
      patch = result.data;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    let requiresRestart = false;

    // Update display name in DB
    if (patch.general?.displayName !== undefined) {
      registry.updateInstance(slug, { displayName: patch.general.displayName });
    }

    // Update default model in runtime.json
    if (patch.general?.defaultModel !== undefined) {
      const stateDir = getRuntimeStateDir(slug);
      if (runtimeConfigExists(stateDir)) {
        try {
          const config = loadRuntimeConfig(stateDir);
          config.defaultModel = patch.general.defaultModel;
          saveRuntimeConfig(stateDir, config);
          requiresRestart = true;
        } catch (err) {
          logger.error(
            `[config] PATCH /config error updating runtime.json for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return apiError(
            c,
            500,
            "CONFIG_PATCH_FAILED",
            err instanceof Error ? err.message : "Failed to update runtime.json",
          );
        }
      }
    }

    // Restart if needed and instance is running
    if (requiresRestart && instance!.state === "running") {
      try {
        await lifecycle.restart(slug);
      } catch (err) {
        logger.warn(
          `[config] restart after config patch failed for ${slug}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    logger.info(`[config] PATCH /config slug=${slug} patch=${JSON.stringify(patch)}`);
    return c.json({ ok: true, requiresRestart, hotReloaded: false, warnings: [] });
  });

  // GET /api/providers — list available providers with their model catalogs
  app.get("/api/providers", async (c) => {
    const providers: ProviderInfo[] = PROVIDER_CATALOG.map((p) => ({
      ...p,
      models: [...p.models],
    }));

    if (!providers.some((p) => p.isDefault)) {
      providers[0]!.isDefault = true;
    }

    return c.json({ canReuseCredentials: false, sourceInstance: null, providers });
  });
}
