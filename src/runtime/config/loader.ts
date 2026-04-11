// src/runtime/config/loader.ts
//
// DB-first config loading — reads RuntimeConfig from DB, falls back to runtime.json.
// Moved here from dashboard/routes/_config-helpers.ts to avoid runtime→dashboard coupling.

import type { Registry } from "../../core/registry.js";
import type { RuntimeConfig } from "./index.js";
import { runtimeConfigExists, loadRuntimeConfig } from "../index.js";
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
    `[config-loader] Reading runtime.json from ${stateDir} — this is deprecated. ` +
      "Config is now stored in the database. This fallback will be removed in a future version.",
  );
  try {
    return loadRuntimeConfig(stateDir);
  } catch (err) {
    logger.debug("[config-loader] runtime.json fallback load failed", { error: String(err) });
    return null;
  }
}

/**
 * Load RuntimeConfig from DB first, falling back to runtime.json.
 * Alias for loadConfigDbFirst — kept for backward compatibility.
 */
export function loadMergedConfigDbFirst(
  registry: Registry,
  slug: string,
  stateDir: string,
): RuntimeConfig | null {
  return loadConfigDbFirst(registry, slug, stateDir);
}
