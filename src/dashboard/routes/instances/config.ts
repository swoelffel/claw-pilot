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

// ---------------------------------------------------------------------------
// Extracted route handlers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Load named keys and default key ID for the instance. */
function loadNamedKeyInfo(
  deps: RouteDeps,
  slug: string,
): {
  allNamedKeys: import("../../../core/repositories/named-key-repository.js").NamedApiKeyRecord[];
  defaultNamedKeyId: number | null;
} {
  if (!isCryptoAvailable()) return { allNamedKeys: [], defaultNamedKeyId: null };

  const namedKeyRepo = new NamedKeyRepository(deps.db);
  const allNamedKeys = namedKeyRepo.listAll();
  let defaultNamedKeyId: number | null = null;
  const inst = deps.registry.getInstance(slug);
  if (inst) {
    const row = deps.db
      .prepare("SELECT default_named_key_id FROM instances WHERE id = ?")
      .get(inst.id) as { default_named_key_id: number | null } | undefined;
    defaultNamedKeyId = row?.default_named_key_id ?? null;
  }
  return { allNamedKeys, defaultNamedKeyId };
}

/** Enrich agent payloads with named_key_id from the agents DB table. */
function enrichAgentsWithNamedKeys(
  db: RouteDeps["db"],
  slug: string,
  agents: Array<{ id: string } & Record<string, unknown>>,
): Array<{ id: string; namedKeyId: number | null } & Record<string, unknown>> {
  const agentKeyRows = db
    .prepare(
      `SELECT a.agent_id, a.named_key_id
       FROM agents a JOIN instances i ON a.instance_id = i.id
       WHERE i.slug = ? AND a.named_key_id IS NOT NULL`,
    )
    .all(slug) as Array<{ agent_id: string; named_key_id: number }>;
  const keyMap = new Map(agentKeyRows.map((r) => [r.agent_id, r.named_key_id]));
  return agents.map((a) => ({ ...a, namedKeyId: keyMap.get(a.id) ?? null }));
}

/** Handle GET /api/instances/:slug/config. */
async function handleGetConfig(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry } = deps;
  const { instance, slug } = getInstanceContext(c);
  const stateDir = getRuntimeStateDir(slug);

  try {
    let config = registry.getRuntimeConfig(slug);

    if (!config && runtimeConfigExists(stateDir)) {
      logger.warn(
        `[config] Falling back to runtime.json for "${slug}" — DB config not found. ` +
          "This fallback is deprecated and will be removed in a future version.",
      );
      config = loadRuntimeConfig(stateDir);
      registry.saveRuntimeConfig(slug, config);
    }

    const { allNamedKeys, defaultNamedKeyId } = loadNamedKeyInfo(deps, slug);

    if (!config) {
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

    const enrichedAgents = enrichAgentsWithNamedKeys(deps.db, slug, payload.agents);

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
}

/** Validate provider removal against defaultModel usage. */
function validateProviderRemoval(
  c: HonoContext,
  registry: RouteDeps["registry"],
  slug: string,
  removeIds: string[],
): ReturnType<typeof apiError> | null {
  const currentConfig = registry.getRuntimeConfig(slug);
  if (!currentConfig) return null;
  for (const id of removeIds) {
    if (currentConfig.defaultModel.startsWith(`${id}/`)) {
      return apiError(
        c,
        400,
        "PROVIDER_IN_USE",
        `Cannot remove provider "${id}" — used by default model "${currentConfig.defaultModel}"`,
      );
    }
  }
  return null;
}

/** Apply config-level changes (DB read-modify-write). */
function applyConfigChanges(
  deps: RouteDeps,
  slug: string,
  stateDir: string,
  patch: RuntimeConfigPatch,
  defaultModel: string | null,
): void {
  const { registry } = deps;
  if (!registry.getRuntimeConfig(slug)) {
    let seedConfig: RuntimeConfig;
    if (runtimeConfigExists(stateDir)) {
      seedConfig = loadRuntimeConfig(stateDir);
    } else {
      seedConfig = createDefaultRuntimeConfig(defaultModel != null ? { defaultModel } : {});
    }
    registry.saveRuntimeConfig(slug, seedConfig);
  }

  const updated = registry.patchRuntimeConfig(slug, (config) => {
    if (patch.general?.defaultModel !== undefined) config.defaultModel = patch.general.defaultModel;
    if (patch.providers) applyProviderChanges(config, patch.providers);
    if (patch.agentDefaults) applyAgentDefaultChanges(config, patch.agentDefaults);
    if (patch.agents && patch.agents.length > 0)
      applyAgentPatches(config, patch.agents, deps.db, slug);
    if (patch.channels?.telegram !== undefined)
      applyTelegramChanges(config, patch.channels.telegram);
    return config;
  });

  if (patch.general?.defaultModel !== undefined) {
    registry.updateInstance(slug, { defaultModel: patch.general.defaultModel });
  }

  exportRuntimeJsonSnapshot(stateDir, updated);
}

/** Parse and validate a config patch from the request body. */
async function parsePatchBody(c: HonoContext): Promise<RuntimeConfigPatch | Response> {
  try {
    const raw = await c.req.json();
    const result = RuntimeConfigPatchSchema.safeParse(raw);
    if (!result.success) return apiError(c, 400, "INVALID_BODY", "Invalid config patch");
    return result.data;
  } catch (err) {
    logger.warn("[route:config] JSON parse failed on config patch", { error: String(err) });
    return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
  }
}

/** Update display name and search index if displayName is in the patch. */
function applyDisplayNameChange(deps: RouteDeps, slug: string, patch: RuntimeConfigPatch): void {
  if (patch.general?.displayName === undefined) return;
  deps.registry.updateInstance(slug, { displayName: patch.general.displayName });
  const inst = deps.registry.getInstance(slug);
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

/** Apply provider .env writes. Returns error response on failure, null on success. */
async function applyProviderEnvSideEffects(
  c: HonoContext,
  slug: string,
  envPath: string,
  providers: NonNullable<RuntimeConfigPatch["providers"]>,
): Promise<Response | null> {
  try {
    await applyProviderEnvWrites(envPath, providers);
    return null;
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

/** Apply default named key change if present in patch. Returns error response on crypto unavailability. */
function applyDefaultNamedKeyChange(
  c: HonoContext,
  deps: RouteDeps,
  slug: string,
  patch: RuntimeConfigPatch,
): Response | null {
  if (patch.defaultNamedKeyId === undefined) return null;
  if (!isCryptoAvailable()) {
    return apiError(c, 503, "CRYPTO_UNAVAILABLE", "Named keys require MASTER_ENCRYPTION_KEY");
  }
  const inst = deps.registry.getInstance(slug);
  if (inst) {
    const namedKeyRepo = new NamedKeyRepository(deps.db);
    namedKeyRepo.setDefaultKeyForInstance(inst.id, patch.defaultNamedKeyId);
  }
  return null;
}

/** Check if the patch contains config-level changes (beyond display name and named key). */
function hasRuntimeConfigChanges(patch: RuntimeConfigPatch): boolean {
  return (
    patch.general?.defaultModel !== undefined ||
    patch.providers !== undefined ||
    patch.agentDefaults !== undefined ||
    (patch.agents !== undefined && patch.agents.length > 0) ||
    patch.channels?.telegram !== undefined
  );
}

/** Apply provider-related side effects (validation + .env writes). Returns error response or null. */
async function applyProviderSideEffects(
  c: HonoContext,
  deps: RouteDeps,
  slug: string,
  stateDir: string,
  patch: RuntimeConfigPatch,
): Promise<Response | null> {
  if (patch.providers?.remove) {
    const removalError = validateProviderRemoval(c, deps.registry, slug, patch.providers.remove);
    if (removalError) return removalError;
  }
  if (patch.providers) {
    return applyProviderEnvSideEffects(c, slug, `${stateDir}/.env`, patch.providers);
  }
  return null;
}

/** Attempt to restart the instance if needed. Returns whether restart happened. */
async function attemptAutoRestart(
  lifecycle: RouteDeps["lifecycle"],
  slug: string,
  instanceState: string | null,
  requiresRestart: boolean,
): Promise<boolean> {
  if (!requiresRestart || instanceState !== "running") return false;
  try {
    await lifecycle.restart(slug);
    return true;
  } catch (err) {
    logger.warn(
      `[config] restart after config patch failed for ${slug}: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return false;
  }
}

/** Handle PATCH /api/instances/:slug/config. */
async function handlePatchConfig(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { instance, slug } = getInstanceContext(c);

  const patchOrError = await parsePatchBody(c);
  if (patchOrError instanceof Response) return patchOrError;
  const patch = patchOrError;

  const stateDir = getRuntimeStateDir(slug);

  applyDisplayNameChange(deps, slug, patch);

  const providerError = await applyProviderSideEffects(c, deps, slug, stateDir, patch);
  if (providerError) return providerError;

  let requiresRestart = false;
  if (hasRuntimeConfigChanges(patch)) {
    try {
      applyConfigChanges(deps, slug, stateDir, patch, instance.default_model);
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

  const namedKeyError = applyDefaultNamedKeyChange(c, deps, slug, patch);
  if (namedKeyError) return namedKeyError;

  const autoRestarted = await attemptAutoRestart(
    deps.lifecycle,
    slug,
    instance.state,
    requiresRestart,
  );

  logger.info(`[config] PATCH /config slug=${slug} patch=${JSON.stringify(patch)}`);
  return c.json({
    ok: true,
    requiresRestart: requiresRestart && !autoRestarted,
    hotReloaded: false,
    warnings: [],
  });
}

export function registerConfigRoutes(app: Hono, deps: RouteDeps): void {
  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    return handleGetConfig(c, deps);
  });

  // PATCH /api/instances/:slug/config — apply partial config changes
  app.patch("/api/instances/:slug/config", async (c) => {
    return handlePatchConfig(c, deps);
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
      const config = deps.registry.getRuntimeConfig(slug);
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
