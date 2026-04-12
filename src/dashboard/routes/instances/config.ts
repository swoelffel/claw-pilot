// src/dashboard/routes/instances/config.ts
// Routes: GET/PATCH config, providers
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { logger } from "../../../lib/logger.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { writeEnvVar, removeEnvVar } from "../../../lib/dotenv.js";
import {
  applyProviderEnvWrites,
  applyProviderChanges,
  applyAgentDefaultChanges,
  applyAgentPatches,
  applyTelegramChanges,
} from "./config-patch-handlers.js";
import { upsertSearchEntry } from "../../../core/repositories/search-repository.js";
import {
  runtimeConfigExists,
  loadRuntimeConfig,
  createDefaultRuntimeConfig,
  exportRuntimeJsonSnapshot,
  type RuntimeConfig,
} from "../../../runtime/index.js";
import { RuntimeConfigPatchSchema, type RuntimeConfigPatch } from "./config-schemas.js";
import { buildInstanceConfig, buildInstanceConfigStub } from "./config-builders.js";
import { NamedKeyRepository } from "../../../core/repositories/named-key-repository.js";
import { isCryptoAvailable } from "../../../lib/crypto.js";

export function registerConfigRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, lifecycle } = deps;

  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    const { instance, slug } = getInstanceContext(c);

    const stateDir = getRuntimeStateDir(slug);

    try {
      // 1. Try DB first (source of truth since v21)
      let config = registry.getRuntimeConfig(slug);

      // 2. Fallback to runtime.json (deprecated — pre-v21 instances only)
      if (!config && runtimeConfigExists(stateDir)) {
        logger.warn(
          `[config] Falling back to runtime.json for "${slug}" — DB config not found. ` +
            "This fallback is deprecated and will be removed in a future version.",
        );
        config = loadRuntimeConfig(stateDir);
        // Backfill DB for next time
        registry.saveRuntimeConfig(slug, config);
      }

      // Load all named keys (global) and instance default key ID
      let defaultNamedKeyId: number | null = null;
      let allNamedKeys: import("../../../core/repositories/named-key-repository.js").NamedApiKeyRecord[] =
        [];
      if (isCryptoAvailable()) {
        const namedKeyRepo = new NamedKeyRepository(deps.db);
        allNamedKeys = namedKeyRepo.listAll();
        const inst = deps.registry.getInstance(slug);
        if (inst) {
          const row = deps.db
            .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
            .get(inst.id) as { default_named_key_id: number | null } | undefined;
          defaultNamedKeyId = row?.default_named_key_id ?? null;
        }
      }

      if (!config) {
        // No config anywhere — return a stub
        const stub = buildInstanceConfigStub({
          display_name: instance.display_name,
          default_model: instance.default_model,
          port: instance.port,
        });
        return c.json({ ...stub, namedKeys: allNamedKeys, defaultNamedKeyId });
      }

      const payload = buildInstanceConfig(
        {
          display_name: instance.display_name,
          default_model: instance.default_model,
          port: instance.port,
        },
        config,
        stateDir,
      );

      // Enrich agents with named_key_id from the agents DB table
      const agentKeyRows = deps.db
        .prepare(
          `SELECT a.agent_id, a.named_key_id
           FROM agents a JOIN instances i ON a.instance_id = i.id
           WHERE i.slug = ? AND a.named_key_id IS NOT NULL`,
        )
        .all(slug) as Array<{ agent_id: string; named_key_id: number }>;
      const keyMap = new Map(agentKeyRows.map((r) => [r.agent_id, r.named_key_id]));
      const enrichedAgents = payload.agents.map((a) => ({
        ...a,
        namedKeyId: keyMap.get(a.id) ?? null,
      }));

      return c.json({
        ...payload,
        agents: enrichedAgents,
        namedKeys: allNamedKeys,
        defaultNamedKeyId,
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
    const { instance, slug } = getInstanceContext(c);

    let patch: RuntimeConfigPatch;
    try {
      const raw = await c.req.json();
      const result = RuntimeConfigPatchSchema.safeParse(raw);
      if (!result.success) {
        return apiError(c, 400, "INVALID_BODY", "Invalid config patch");
      }
      patch = result.data;
    } catch (err) {
      logger.warn("[route:config] JSON parse failed on config patch", { error: String(err) });
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const stateDir = getRuntimeStateDir(slug);
    const envPath = `${stateDir}/.env`;
    let requiresRestart = false;

    // Update display name in DB (instance-level, not part of RuntimeConfig)
    if (patch.general?.displayName !== undefined) {
      registry.updateInstance(slug, { displayName: patch.general.displayName });
      const inst = registry.getInstance(slug);
      if (inst) {
        upsertSearchEntry(deps.db, {
          entityType: "instance",
          entityId: slug,
          title: inst.display_name ?? slug,
          subtitle: inst.state ?? "",
          routeHash: `/instances/${slug}/builder`,
        });
      }
    }

    // --- Pre-validation: check provider removal conflicts ---
    if (patch.providers?.remove) {
      const currentConfig = registry.getRuntimeConfig(slug);
      if (currentConfig) {
        for (const id of patch.providers.remove) {
          if (currentConfig.defaultModel.startsWith(`${id}/`)) {
            return apiError(
              c,
              400,
              "PROVIDER_IN_USE",
              `Cannot remove provider "${id}" — used by default model "${currentConfig.defaultModel}"`,
            );
          }
        }
      }
    }

    // --- Async side effects: .env writes (must happen before DB transaction) ---
    if (patch.providers) {
      try {
        await applyProviderEnvWrites(envPath, patch.providers);
      } catch (err) {
        logger.error(
          `[config] PATCH .env error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return apiError(
          c,
          500,
          "CONFIG_PATCH_FAILED",
          err instanceof Error ? err.message : "Failed to update provider keys",
        );
      }
    }

    // --- Determine if we have any config-level changes to apply ---
    const hasConfigChanges =
      patch.general?.defaultModel !== undefined ||
      patch.providers !== undefined ||
      patch.agentDefaults !== undefined ||
      (patch.agents !== undefined && patch.agents.length > 0) ||
      patch.channels?.telegram !== undefined;

    if (hasConfigChanges) {
      try {
        // Ensure config exists in DB (backfill from file or create default)
        if (!registry.getRuntimeConfig(slug)) {
          let seedConfig: RuntimeConfig;
          if (runtimeConfigExists(stateDir)) {
            seedConfig = loadRuntimeConfig(stateDir);
          } else {
            seedConfig = createDefaultRuntimeConfig(
              instance.default_model != null ? { defaultModel: instance.default_model } : {},
            );
          }
          registry.saveRuntimeConfig(slug, seedConfig);
        }

        // Atomic read-modify-write in DB
        const updated = registry.patchRuntimeConfig(slug, (config) => {
          if (patch.general?.defaultModel !== undefined) {
            config.defaultModel = patch.general.defaultModel;
          }
          if (patch.providers) {
            applyProviderChanges(config, patch.providers);
          }
          if (patch.agentDefaults) {
            applyAgentDefaultChanges(config, patch.agentDefaults);
          }
          if (patch.agents && patch.agents.length > 0) {
            applyAgentPatches(config, patch.agents, deps.db, slug);
          }
          if (patch.channels?.telegram !== undefined) {
            applyTelegramChanges(config, patch.channels.telegram);
          }
          return config;
        });

        // Keep instances.default_model in sync
        if (patch.general?.defaultModel !== undefined) {
          registry.updateInstance(slug, { defaultModel: patch.general.defaultModel });
        }

        // Export runtime.json snapshot (best-effort, for debugging/backup)
        exportRuntimeJsonSnapshot(stateDir, updated);

        requiresRestart = true;
      } catch (err) {
        logger.error(
          `[config] PATCH /config error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return apiError(
          c,
          500,
          "CONFIG_PATCH_FAILED",
          err instanceof Error ? err.message : "Failed to update config",
        );
      }
    }

    // --- Default named key (simple FK on instances, v25) ---
    if (patch.defaultNamedKeyId !== undefined) {
      if (!isCryptoAvailable()) {
        return apiError(c, 503, "CRYPTO_UNAVAILABLE", "Named keys require MASTER_ENCRYPTION_KEY");
      }
      const inst = deps.registry.getInstance(slug);
      if (inst) {
        const namedKeyRepo = new NamedKeyRepository(deps.db);
        namedKeyRepo.setDefaultKeyForInstance(inst.id, patch.defaultNamedKeyId);
      }
    }

    // Restart if needed and instance is running
    let autoRestarted = false;
    if (requiresRestart && instance.state === "running") {
      try {
        await lifecycle.restart(slug);
        autoRestarted = true;
      } catch (err) {
        logger.warn(
          `[config] restart after config patch failed for ${slug}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    logger.info(`[config] PATCH /config slug=${slug} patch=${JSON.stringify(patch)}`);
    // If the backend already restarted the instance, inform the UI so it doesn't show
    // a redundant "restart required" banner.
    return c.json({
      ok: true,
      requiresRestart: requiresRestart && !autoRestarted,
      hotReloaded: false,
      warnings: [],
    });
  });

  // PATCH /api/instances/:slug/config/telegram/token — write/remove bot token in .env
  app.patch("/api/instances/:slug/config/telegram/token", async (c) => {
    const { slug } = getInstanceContext(c);

    let token: string | null;
    try {
      const raw = (await c.req.json()) as { token?: unknown };
      if (raw.token !== undefined && raw.token !== null && typeof raw.token !== "string") {
        return apiError(c, 400, "INVALID_BODY", "token must be a string or null");
      }
      token = (raw.token as string | null | undefined) ?? null;
    } catch (err) {
      logger.warn("[route:config] JSON parse failed on telegram token", { error: String(err) });
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const stateDir = getRuntimeStateDir(slug);
    const envPath = `${stateDir}/.env`;

    try {
      // Get the botTokenEnvVar name from config (default: TELEGRAM_BOT_TOKEN)
      let varName = "TELEGRAM_BOT_TOKEN";
      const config = registry.getRuntimeConfig(slug);
      if (config) {
        varName = config.telegram.botTokenEnvVar;
      } else if (runtimeConfigExists(stateDir)) {
        try {
          const fileConfig = loadRuntimeConfig(stateDir);
          varName = fileConfig.telegram.botTokenEnvVar;
        } catch (err) {
          logger.debug("[route:config] runtime.json fallback load failed", { error: String(err) });
          /* use default */
        }
      }

      // Write or remove token via helper
      if (token !== null) {
        await writeEnvVar(envPath, varName, token);
      } else {
        await removeEnvVar(envPath, varName);
      }

      logger.info(`[config] PATCH telegram/token slug=${slug} configured=${token !== null}`);
      return c.json({ configured: token !== null });
    } catch (err) {
      logger.error(
        `[config] PATCH telegram/token error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(c, 500, "TOKEN_WRITE_FAILED", "Failed to write token to .env");
    }
  });

  // GET /api/providers — list available providers with their model catalogs
  // Uses dynamic discovery service (merges static catalog with discovered models).
  app.get("/api/providers", async (c) => {
    const providers = deps.modelDiscovery.getProviders();

    if (!providers.some((p) => p.isDefault)) {
      providers[0]!.isDefault = true;
    }

    return c.json({ canReuseCredentials: false, sourceInstance: null, providers });
  });
}
