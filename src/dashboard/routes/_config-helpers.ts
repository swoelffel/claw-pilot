// src/dashboard/routes/_config-helpers.ts
//
// DB-first config loading helpers for dashboard routes.
// Reads RuntimeConfig from DB, falls back to runtime.json file (deprecated).

import type { Registry } from "../../core/registry.js";
import type { RuntimeConfig } from "../../runtime/config/index.js";
import type { ProfileResolver } from "../../runtime/profile/types.js";
import { runtimeConfigExists, loadRuntimeConfig } from "../../runtime/index.js";
import { mergeProviderConfig } from "../../runtime/provider/config-merge.js";
import { logger } from "../../lib/logger.js";

/**
 * Load RuntimeConfig from DB first, falling back to runtime.json.
 * Returns null if no config found in either source.
 */
export function loadConfigDbFirst(
  registry: Registry,
  slug: string,
  stateDir: string,
): RuntimeConfig | null {
  // 1. DB (source of truth since v21)
  const fromDb = registry.getRuntimeConfig(slug);
  if (fromDb) return fromDb;

  // 2. Fallback to file (deprecated — runtime.json is no longer the source of truth)
  if (!runtimeConfigExists(stateDir)) return null;
  logger.warn(
    `[config-helpers] Falling back to runtime.json for "${slug}" — DB config not found. ` +
      "This fallback is deprecated and will be removed in a future version.",
  );
  try {
    return loadRuntimeConfig(stateDir);
  } catch (err) {
    logger.debug("[config-helpers] runtime.json fallback load failed", { error: String(err) });
    return null;
  }
}

/**
 * Load RuntimeConfig from DB first, falling back to runtime.json,
 * then merge with user profile providers/models.
 * Returns null if no config found.
 */
export function loadMergedConfigDbFirst(
  registry: Registry,
  slug: string,
  stateDir: string,
  profileResolver?: ProfileResolver,
): RuntimeConfig | null {
  const config = loadConfigDbFirst(registry, slug, stateDir);
  if (!config) return null;

  if (!profileResolver) return config;

  const profile = profileResolver.getActiveProfile();
  if (!profile) return config;

  const userProviders = profileResolver.getProviders();
  if (userProviders.length === 0 && !profile.defaultModel) return config;

  return mergeProviderConfig(config, userProviders, profile.defaultModel ?? undefined);
}
