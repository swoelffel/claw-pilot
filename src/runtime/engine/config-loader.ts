/**
 * runtime/engine/config-loader.ts
 *
 * File I/O helpers for runtime.json — the per-instance runtime configuration.
 *
 * @deprecated Since v0.59.3, the database (`agents.config_json` + `instances.runtime_config_json`)
 * is the source of truth for runtime configuration. The file `runtime.json` is kept only as a
 * read-only debug snapshot exported by {@link exportRuntimeJsonSnapshot}. Functions that read
 * or write the file directly are deprecated and will be removed in a future version.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseRuntimeConfig,
  createDefaultRuntimeConfig,
  type RuntimeConfig,
} from "../config/index.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNTIME_CONFIG_FILE = "runtime.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runtimeConfigPath(stateDir: string): string {
  return path.join(stateDir, RUNTIME_CONFIG_FILE);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate runtime.json from the given state directory.
 * Throws if the file does not exist or fails validation.
 * @deprecated Use `registry.getRuntimeConfig(slug)` instead — the database is the source of truth.
 */
export function loadRuntimeConfig(stateDir: string): RuntimeConfig {
  logger.warn(
    `[config-loader] Reading runtime.json from ${stateDir} — this is deprecated. ` +
      "Config is now stored in the database. This fallback will be removed in a future version.",
  );
  const filePath = runtimeConfigPath(stateDir);

  let raw: unknown;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `runtime.json not found in ${stateDir}. Run "claw-pilot runtime config init <slug>" to create it.`,
      );
    }
    throw new Error(
      `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return parseRuntimeConfig(raw);
}

/**
 * Write a RuntimeConfig to <stateDir>/runtime.json (pretty-printed JSON).
 * Creates the directory if it does not exist.
 * @deprecated Use `registry.saveRuntimeConfig(slug, config)` instead — the database is the source of truth.
 */
export function saveRuntimeConfig(stateDir: string, config: RuntimeConfig): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = runtimeConfigPath(stateDir);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Load runtime.json if it exists, otherwise create it with defaults and save.
 * Returns the (possibly newly created) config.
 * @deprecated Used only during initial provisioning. The database is the source of truth post-bootstrap.
 */
export function ensureRuntimeConfig(
  stateDir: string,
  options?: {
    defaultModel?: string;
    telegramEnabled?: boolean;
  },
): RuntimeConfig {
  const filePath = runtimeConfigPath(stateDir);

  if (fs.existsSync(filePath)) {
    return loadRuntimeConfig(stateDir);
  }

  const config = createDefaultRuntimeConfig({
    ...(options?.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
    ...(options?.telegramEnabled !== undefined ? { telegramEnabled: options.telegramEnabled } : {}),
  });
  saveRuntimeConfig(stateDir, config);
  return config;
}

/**
 * Export a RuntimeConfig as a read-only snapshot to <stateDir>/runtime.json.
 * This file is generated from the DB — it is NOT the source of truth.
 * Best-effort: failures are logged but do not throw.
 */
export function exportRuntimeJsonSnapshot(stateDir: string, config: RuntimeConfig): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const filePath = runtimeConfigPath(stateDir);
    const content = JSON.stringify(config, null, 2) + "\n";
    fs.writeFileSync(filePath, content, "utf-8");
  } catch {
    // Non-critical: the DB is the source of truth, the file is for debugging
  }
}

/**
 * Return true if runtime.json exists in the given state directory.
 * @deprecated The database is the source of truth — file existence should not drive logic.
 */
export function runtimeConfigExists(stateDir: string): boolean {
  return fs.existsSync(runtimeConfigPath(stateDir));
}
