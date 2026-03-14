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
  type RuntimeConfig,
} from "../../../runtime/index.js";
import { z } from "zod/v4";

// InstanceConfig type — matches ui/src/types.ts
interface InstanceConfig {
  general: {
    displayName: string;
    defaultModel: string;
    port: number;
    toolsProfile: string;
  };
  providers: Array<{ id: string; label: string; apiKey: string }>;
  agentDefaults: {
    workspace: string;
    subagents: { maxConcurrent: number; archiveAfterMinutes: number };
    compaction: { mode: string; reserveTokensFloor?: number };
    contextPruning: { mode: string; ttl?: string };
    heartbeat: { every?: string; model?: string; target?: string };
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    workspace: string;
    identity: { name?: string; emoji?: string; avatar?: string } | null;
  }>;
  channels: {
    telegram: {
      enabled: boolean;
      botTokenMasked: string | null;
      dmPolicy: string;
      groupPolicy: string;
      streamMode?: string;
    } | null;
  };
  plugins: {
    mem0: {
      enabled: boolean;
      ollamaUrl: string;
      qdrantHost: string;
      qdrantPort: number;
    } | null;
  };
  gateway: {
    port: number;
    bind: string;
    authMode: string;
    reloadMode: string;
    reloadDebounceMs: number;
  };
}

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

// ---------------------------------------------------------------------------
// Helper: Build complete InstanceConfig from RuntimeConfig
// ---------------------------------------------------------------------------

function buildInstanceConfig(
  instance: { display_name?: string | null; default_model?: string | null; port: number },
  config: RuntimeConfig,
): InstanceConfig {
  // Extract toolsProfile from first agent or default to "coding"
  const toolsProfile = config.agents[0]?.toolProfile ?? "coding";

  // Map runtime agents to UI format
  const agents = config.agents.map((a) => ({
    id: a.id,
    name: a.name,
    model: a.model ?? null,
    workspace: "workspace", // claw-runtime doesn't track per-agent workspaces in config
    identity: null,
  }));

  // Map providers to UI format
  const providers = config.providers.map((p) => ({
    id: p.id,
    label: p.id,
    apiKey: "", // Never expose API keys in config response
  }));

  return {
    general: {
      displayName: instance.display_name ?? "",
      defaultModel: config.defaultModel,
      port: instance.port,
      toolsProfile,
    },
    providers,
    agentDefaults: {
      workspace: "workspace",
      subagents: { maxConcurrent: 4, archiveAfterMinutes: 60 },
      compaction: { mode: config.compaction.auto ? "auto" : "manual" },
      contextPruning: { mode: "off" },
      heartbeat: {},
    },
    agents,
    channels: {
      telegram: config.telegram.enabled
        ? {
            enabled: true,
            botTokenMasked: null,
            dmPolicy: "allow",
            groupPolicy: "deny",
          }
        : null,
    },
    plugins: {
      mem0: null,
    },
    gateway: {
      port: instance.port,
      bind: "loopback",
      authMode: "token",
      reloadMode: "hybrid",
      reloadDebounceMs: 500,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: Build stub InstanceConfig when runtime.json doesn't exist
// ---------------------------------------------------------------------------

function buildInstanceConfigStub(instance: {
  display_name?: string | null;
  default_model?: string | null;
  port: number;
}): InstanceConfig {
  return {
    general: {
      displayName: instance.display_name ?? "",
      defaultModel: instance.default_model ?? "anthropic/claude-sonnet-4-5",
      port: instance.port,
      toolsProfile: "coding",
    },
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
      port: instance.port,
      bind: "loopback",
      authMode: "token",
      reloadMode: "hybrid",
      reloadDebounceMs: 500,
    },
  };
}

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
      // Return a complete stub when runtime.json does not exist yet
      const stub = buildInstanceConfigStub({
        display_name: instance!.display_name,
        default_model: instance!.default_model,
        port: instance!.port,
      });
      return c.json(stub);
    }

    try {
      const config = loadRuntimeConfig(stateDir);
      const payload = buildInstanceConfig(
        {
          display_name: instance!.display_name,
          default_model: instance!.default_model,
          port: instance!.port,
        },
        config,
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
