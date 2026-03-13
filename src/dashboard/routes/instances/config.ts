// src/dashboard/routes/instances/config.ts
// Routes: GET/PATCH config, providers
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { logger } from "../../../lib/logger.js";
import {
  readInstanceConfig,
  applyConfigPatch,
  ConfigPatchSchema,
} from "../../../core/config-updater.js";
import type { ConfigPatch, InstanceConfigPayload } from "../../../core/config-updater.js";
import { PROVIDER_CATALOG } from "../../../lib/provider-catalog.js";
import type { ProviderInfo } from "../../../lib/provider-catalog.js";
import { OpenClawCLI } from "../../../core/openclaw-cli.js";

// ---------------------------------------------------------------------------
// claw-runtime stub — minimal InstanceConfigPayload for runtime instances
// ---------------------------------------------------------------------------

function buildRuntimeStub(
  displayName: string,
  defaultModel: string,
  port: number,
): InstanceConfigPayload {
  return {
    general: { displayName, defaultModel, port, toolsProfile: "coding" },
    providers: [],
    agentDefaults: {
      workspace: "workspace",
      subagents: { maxConcurrent: 4, archiveAfterMinutes: 60 },
      compaction: { mode: "auto" },
      contextPruning: { mode: "off" },
      heartbeat: {},
    },
    agents: [],
    channels: { telegram: null },
    plugins: { mem0: null },
    gateway: {
      port,
      bind: "loopback",
      authMode: "token",
      reloadMode: "hybrid",
      reloadDebounceMs: 500,
    },
  };
}

export function registerConfigRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    // claw-runtime instances don't have an openclaw.json — return a minimal stub
    if (instance!.instance_type === "claw-runtime") {
      const stub = buildRuntimeStub(
        instance!.display_name ?? "",
        instance!.default_model ?? "",
        instance!.port,
      );
      return c.json(stub);
    }

    try {
      const payload = await readInstanceConfig(conn, instance!.config_path, instance!.state_dir);
      payload.general.displayName = instance!.display_name ?? "";
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

    // claw-runtime: only displayName is patchable via this route
    if (instance!.instance_type === "claw-runtime") {
      let patch: ConfigPatch;
      try {
        const raw = await c.req.json();
        const result = ConfigPatchSchema.safeParse(raw);
        if (!result.success) {
          return apiError(c, 400, "INVALID_BODY", "Invalid config patch");
        }
        patch = result.data as ConfigPatch;
      } catch {
        return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
      }
      if (patch.general?.displayName !== undefined) {
        registry.updateInstance(slug, { displayName: patch.general.displayName });
      }
      return c.json({ ok: true, requiresRestart: false, hotReloaded: false, warnings: [] });
    }

    let patch: ConfigPatch;
    try {
      const raw = await c.req.json();
      const result = ConfigPatchSchema.safeParse(raw);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return apiError(c, 400, "INVALID_BODY", `Invalid config patch: ${issues}`);
      }
      patch = result.data as ConfigPatch;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    logger.info(`[config] PATCH /config slug=${slug} patch=${JSON.stringify(patch)}`);

    try {
      const result = await applyConfigPatch(
        conn,
        registry,
        slug,
        instance!.config_path,
        instance!.state_dir,
        patch,
      );

      if (result.requiresRestart && instance!.state === "running") {
        try {
          await lifecycle.restart(slug);
        } catch (err) {
          result.warnings.push(
            `Restart failed: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
      }

      logger.info(`[config] PATCH /config slug=${slug} result=${JSON.stringify(result)}`);
      return c.json(result);
    } catch (err) {
      logger.error(
        `[config] PATCH /config error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return apiError(
        c,
        500,
        "CONFIG_PATCH_FAILED",
        err instanceof Error ? err.message : "Failed to apply config",
      );
    }
  });

  // GET /api/providers — list available providers with their model catalogs
  app.get("/api/providers", async (c) => {
    const existing = registry.listInstances();
    let canReuseCredentials = false;
    let sourceInstance: string | null = null;

    const providers: ProviderInfo[] = PROVIDER_CATALOG.map((p) => ({
      ...p,
      models: [...p.models],
    }));

    if (existing.length > 0) {
      const source = existing[0]!;
      sourceInstance = source.slug;

      try {
        const raw = await conn.readFile(source.config_path);
        const cfg = JSON.parse(raw) as {
          models?: { providers?: Record<string, unknown> };
          auth?: { profiles?: Record<string, { provider?: string }> };
        };

        const cfgProviderIds = new Set(Object.keys(cfg.models?.providers ?? {}));

        const profiles = cfg.auth?.profiles ?? {};
        for (const profile of Object.values(profiles)) {
          if (profile.provider === "opencode") cfgProviderIds.add("opencode");
        }

        if (cfgProviderIds.size > 0) {
          canReuseCredentials = true;
          for (const p of providers) {
            if (cfgProviderIds.has(p.id)) {
              p.requiresKey = false;
              p.label =
                p.id === "opencode"
                  ? `${p.label} (via ${source.slug})`
                  : `${p.label} (reuse from ${source.slug})`;
              p.isDefault = true;
            }
          }
        }
      } catch {
        // Non-fatal: source config unreadable → fall through to defaults
      }
    }

    if (!providers.some((p) => p.isDefault)) {
      providers[0]!.isDefault = true;
    }

    let openclawAvailable = false;
    try {
      const cli = new OpenClawCLI(conn);
      const detected = await cli.detect();
      openclawAvailable = detected !== null;
    } catch {
      // Non-fatal: detection failed → openclaw not available
    }

    return c.json({ canReuseCredentials, sourceInstance, providers, openclawAvailable });
  });
}
