/**
 * runtime/_runtime-version.ts
 *
 * Shared helper for reading the claw-pilot package version at runtime.
 * Used by both the engine (to initialize plugins) and the prompt-loop
 * (to build PluginInput for tool registry calls).
 */

import { createRequire } from "node:module";
import { logger } from "../lib/logger.js";

const _moduleRequire = createRequire(import.meta.url);

let _cached: string | undefined;

/**
 * Returns the current runtime version from package.json, cached on first read.
 * Falls back to "unknown" if package.json cannot be resolved.
 */
export function getRuntimeVersion(): string {
  if (_cached !== undefined) return _cached;
  let version = "unknown";
  try {
    const pkg = _moduleRequire("../../package.json") as { version?: string };
    version = pkg.version ?? "unknown";
  } catch (err) {
    logger.debug("[runtime-version] package.json read failed", { error: String(err) });
    // intentionally ignored — fall back to "unknown"
  }
  _cached = version;
  return version;
}
