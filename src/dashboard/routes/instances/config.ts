// src/dashboard/routes/instances/config.ts
// Routes: GET/PATCH config, providers
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { logger } from "../../../lib/logger.js";
import { PROVIDER_CATALOG } from "../../../lib/provider-catalog.js";
import type { ProviderInfo } from "../../../lib/provider-catalog.js";
import { PROVIDER_ENV_VARS } from "../../../lib/providers.js";
import { getRuntimeStateDir } from "../../../lib/platform.js";
import { writeEnvVar, removeEnvVar } from "../../../lib/dotenv.js";
import {
  runtimeConfigExists,
  loadRuntimeConfig,
  createDefaultRuntimeConfig,
  exportRuntimeJsonSnapshot,
  type RuntimeConfig,
} from "../../../runtime/index.js";
import { RuntimeConfigPatchSchema, type RuntimeConfigPatch } from "./config-schemas.js";
import { buildInstanceConfig, buildInstanceConfigStub } from "./config-builders.js";

export function registerConfigRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, lifecycle } = deps;

  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const stateDir = getRuntimeStateDir(slug);

    try {
      // 1. Try DB first (source of truth since v21)
      let config = registry.getRuntimeConfig(slug);

      // 2. Fallback to runtime.json (pre-v21 instances)
      if (!config && runtimeConfigExists(stateDir)) {
        config = loadRuntimeConfig(stateDir);
        // Backfill DB for next time
        registry.saveRuntimeConfig(slug, config);
      }

      if (!config) {
        // No config anywhere — return a stub
        const stub = buildInstanceConfigStub({
          display_name: instance!.display_name,
          default_model: instance!.default_model,
          port: instance!.port,
        });
        return c.json(stub);
      }

      const payload = buildInstanceConfig(
        {
          display_name: instance!.display_name,
          default_model: instance!.default_model,
          port: instance!.port,
        },
        config,
        stateDir,
      );
      return c.json(payload);
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

    const stateDir = getRuntimeStateDir(slug);
    const envPath = `${stateDir}/.env`;
    let requiresRestart = false;

    // Update display name in DB (instance-level, not part of RuntimeConfig)
    if (patch.general?.displayName !== undefined) {
      registry.updateInstance(slug, { displayName: patch.general.displayName });
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
    try {
      if (patch.providers?.add) {
        for (const entry of patch.providers.add) {
          if (entry.apiKey) {
            const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
            await writeEnvVar(envPath, envVar, entry.apiKey);
          }
        }
      }
      if (patch.providers?.update) {
        for (const entry of patch.providers.update) {
          if (entry.apiKey !== undefined) {
            const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
            await writeEnvVar(envPath, envVar, entry.apiKey);
          }
        }
      }
      if (patch.providers?.remove) {
        for (const id of patch.providers.remove) {
          const envVar = PROVIDER_ENV_VARS[id] ?? `${id.toUpperCase()}_API_KEY`;
          await removeEnvVar(envPath, envVar);
        }
      }
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
              instance!.default_model != null ? { defaultModel: instance!.default_model } : {},
            );
          }
          registry.saveRuntimeConfig(slug, seedConfig);
        }

        // Atomic read-modify-write in DB
        const updated = registry.patchRuntimeConfig(slug, (config) => {
          // --- general.defaultModel ---
          if (patch.general?.defaultModel !== undefined) {
            config.defaultModel = patch.general.defaultModel;
          }

          // --- providers ---
          if (patch.providers) {
            // ADD
            if (patch.providers.add) {
              for (const entry of patch.providers.add) {
                if (config.providers.some((p) => p.id === entry.id)) continue;
                const envVar = PROVIDER_ENV_VARS[entry.id] ?? `${entry.id.toUpperCase()}_API_KEY`;
                config.providers.push({
                  id: entry.id,
                  ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}),
                  authProfiles: [
                    {
                      id: `${entry.id}-default`,
                      providerId: entry.id,
                      apiKeyEnvVar: envVar,
                      priority: 0,
                    },
                  ],
                });
              }
            }
            // UPDATE
            if (patch.providers.update) {
              for (const entry of patch.providers.update) {
                if (entry.baseUrl !== undefined) {
                  const provider = config.providers.find((p) => p.id === entry.id);
                  if (provider) {
                    if (entry.baseUrl === null) {
                      delete (provider as Record<string, unknown>).baseUrl;
                    } else {
                      provider.baseUrl = entry.baseUrl;
                    }
                  }
                }
              }
            }
            // REMOVE
            if (patch.providers.remove) {
              config.providers = config.providers.filter(
                (p) => !patch.providers!.remove!.includes(p.id),
              );
            }
          }

          // --- agentDefaults ---
          if (patch.agentDefaults) {
            const ad = patch.agentDefaults;
            if (ad.compaction) {
              if (ad.compaction.mode !== undefined)
                config.compaction.auto = ad.compaction.mode === "auto";
              if (ad.compaction.threshold !== undefined)
                config.compaction.threshold = ad.compaction.threshold;
              if (ad.compaction.reservedTokens !== undefined)
                config.compaction.reservedTokens = ad.compaction.reservedTokens;
            }
            if (ad.subagents) {
              if (ad.subagents.maxSpawnDepth !== undefined)
                config.subagents.maxSpawnDepth = ad.subagents.maxSpawnDepth;
              if (ad.subagents.maxChildrenPerSession !== undefined)
                config.subagents.maxChildrenPerSession = ad.subagents.maxChildrenPerSession;
              if (ad.subagents.retentionHours !== undefined)
                config.subagents.retentionHours = ad.subagents.retentionHours;
            }
            if (ad.defaultInternalModel !== undefined) {
              config.defaultInternalModel = ad.defaultInternalModel || undefined;
            }
            if (ad.models !== undefined) {
              config.models = ad.models.map((m) => ({
                id: m.id,
                provider: m.provider,
                model: m.model,
              }));
            }
          }

          // --- per-agent config ---
          if (patch.agents && patch.agents.length > 0) {
            for (const agentPatch of patch.agents) {
              const agent = config.agents.find((a) => a.id === agentPatch.id);
              if (!agent) continue;
              if (agentPatch.name !== undefined) agent.name = agentPatch.name;
              if (agentPatch.model !== undefined && agentPatch.model !== null)
                agent.model = agentPatch.model;
              if (agentPatch.toolProfile !== undefined) agent.toolProfile = agentPatch.toolProfile;
              if (agentPatch.customTools !== undefined) agent.customTools = agentPatch.customTools;
              if (agentPatch.maxSteps !== undefined) agent.maxSteps = agentPatch.maxSteps;
              if (agentPatch.temperature !== undefined)
                agent.temperature = agentPatch.temperature ?? undefined;
              if (agentPatch.promptMode !== undefined) agent.promptMode = agentPatch.promptMode;
              if (agentPatch.thinking !== undefined) {
                if (agentPatch.thinking === null) {
                  agent.thinking = undefined;
                } else {
                  agent.thinking = {
                    enabled: agentPatch.thinking.enabled,
                    ...(agentPatch.thinking.budgetTokens !== undefined
                      ? { budgetTokens: agentPatch.thinking.budgetTokens }
                      : {}),
                  };
                }
              }
              if (agentPatch.allowSubAgents !== undefined)
                agent.allowSubAgents = agentPatch.allowSubAgents;
              if (agentPatch.timeoutMs !== undefined) agent.timeoutMs = agentPatch.timeoutMs;
              if (agentPatch.chunkTimeoutMs !== undefined)
                agent.chunkTimeoutMs = agentPatch.chunkTimeoutMs;
              if (agentPatch.instructionUrls !== undefined)
                agent.instructionUrls = agentPatch.instructionUrls;
              if (agentPatch.bootstrapFiles !== undefined)
                agent.bootstrapFiles = agentPatch.bootstrapFiles;
              if (agentPatch.archetype !== undefined) agent.archetype = agentPatch.archetype;
              if (agentPatch.autoSelectSkills !== undefined)
                agent.autoSelectSkills = agentPatch.autoSelectSkills;
              if (agentPatch.autoSelectSkillsTopN !== undefined)
                agent.autoSelectSkillsTopN = agentPatch.autoSelectSkillsTopN;
              if (agentPatch.skills !== undefined) agent.skills = agentPatch.skills ?? undefined;
              if (agentPatch.heartbeat !== undefined) {
                if (agentPatch.heartbeat === null) {
                  agent.heartbeat = undefined;
                } else {
                  agent.heartbeat = agentPatch.heartbeat as typeof agent.heartbeat;
                }
              }
            }
          }

          // --- telegram ---
          if (patch.channels?.telegram !== undefined) {
            const tg = patch.channels.telegram;
            if (tg.enabled !== undefined) config.telegram.enabled = tg.enabled;
            if (tg.botTokenEnvVar !== undefined) config.telegram.botTokenEnvVar = tg.botTokenEnvVar;
            if (tg.pollingIntervalMs !== undefined)
              config.telegram.pollingIntervalMs = tg.pollingIntervalMs;
            if (tg.allowedUserIds !== undefined) config.telegram.allowedUserIds = tg.allowedUserIds;
            if (tg.dmPolicy !== undefined) config.telegram.dmPolicy = tg.dmPolicy;
            if (tg.groupPolicy !== undefined) config.telegram.groupPolicy = tg.groupPolicy;
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

    // Restart if needed and instance is running
    let autoRestarted = false;
    if (requiresRestart && instance!.state === "running") {
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
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    let token: string | null;
    try {
      const raw = (await c.req.json()) as { token?: unknown };
      if (raw.token !== undefined && raw.token !== null && typeof raw.token !== "string") {
        return apiError(c, 400, "INVALID_BODY", "token must be a string or null");
      }
      token = (raw.token as string | null | undefined) ?? null;
    } catch {
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
        } catch {
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
