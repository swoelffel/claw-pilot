/**
 * runtime/engine/config-loader.ts
 *
 * File I/O helpers for runtime.json — the per-instance runtime configuration.
 *
 * Stored at: <stateDir>/runtime.json
 * Parsed with: parseRuntimeConfig() (Zod schema, throws on invalid)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseRuntimeConfig,
  createDefaultRuntimeConfig,
  type RuntimeConfig,
} from "../config/index.js";
import type { ProfileResolver } from "../profile/types.js";
import { mergeProviderConfig } from "../provider/config-merge.js";

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
 */
export function loadRuntimeConfig(stateDir: string): RuntimeConfig {
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
 */
export function saveRuntimeConfig(stateDir: string, config: RuntimeConfig): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = runtimeConfigPath(stateDir);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Load runtime.json if it exists, otherwise create it with defaults and save.
 * Returns the (possibly newly created) config.
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
    const content =
      "// Generated from registry.db — do not edit manually\n" +
      JSON.stringify(config, null, 2) +
      "\n";
    fs.writeFileSync(filePath, content, "utf-8");
  } catch {
    // Non-critical: the DB is the source of truth, the file is for debugging
  }
}

/**
 * Return true if runtime.json exists in the given state directory.
 */
export function runtimeConfigExists(stateDir: string): boolean {
  return fs.existsSync(runtimeConfigPath(stateDir));
}

/**
 * Load runtime.json and merge with user profile providers/models if a
 * ProfileResolver is provided. Without a resolver, behaves identically
 * to loadRuntimeConfig() (backward-compatible).
 */
export function loadMergedConfig(
  stateDir: string,
  profileResolver?: ProfileResolver,
): RuntimeConfig {
  const config = loadRuntimeConfig(stateDir);

  if (!profileResolver) return config;

  const profile = profileResolver.getActiveProfile();
  if (!profile) return config;

  const userProviders = profileResolver.getProviders();

  // Only merge if there is something to merge
  if (userProviders.length === 0 && !profile.defaultModel) {
    return config;
  }

  return mergeProviderConfig(config, userProviders, profile.defaultModel ?? undefined);
}
