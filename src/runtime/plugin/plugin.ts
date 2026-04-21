/**
 * runtime/plugin/plugin.ts
 *
 * Plugin loader — loads plugins from file paths and registers their hooks.
 *
 * V1 supports:
 * - Local file plugins (file:// or absolute path)
 * - Inline plugin objects (for testing / built-in plugins)
 */

import type { Plugin, PluginDescriptor, PluginInput } from "./types.js";
import { registerHooks, clearHooks } from "./hooks.js";
import { logger } from "../../lib/logger.js";
import { ClawPilotError } from "../../lib/errors.js";
import { getPluginVerifier } from "./verifier.js";
import { emitAudit } from "../../core/audit/emitter.js";

// ---------------------------------------------------------------------------
// Plugin registry
// ---------------------------------------------------------------------------

const _plugins: PluginDescriptor[] = [];
let _initialized = false;

/**
 * Register a plugin inline (for built-in or test plugins).
 */
export function registerPlugin(name: string, plugin: Plugin): void {
  _plugins.push({ name, plugin });
  _initialized = false; // Force re-init on next trigger
}

/**
 * Initialize all registered plugins with the given input.
 * Idempotent — only runs once unless reset() is called.
 */
export async function initPlugins(input: PluginInput): Promise<void> {
  if (_initialized) return;

  clearHooks();

  for (const descriptor of _plugins) {
    try {
      const hooks = await descriptor.plugin(input);
      registerHooks(hooks);
    } catch (err) {
      logger.warn(`Failed to initialize plugin "${descriptor.name}": ${err}`);
    }
  }

  _initialized = true;
}

/**
 * Load a plugin from a file path and register it.
 * Supports absolute paths and file:// URLs.
 *
 * Before evaluation, the file bytes are hashed (SHA-256) and passed to the
 * registered `PluginVerifier`. A failing result emits `plugin.rejected` to
 * the audit bus and throws `PLUGIN_REJECTED` — the module is never imported.
 *
 * @public
 */
export async function loadPluginFromFile(filePath: string): Promise<void> {
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const { existsSync } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");

  let url: string;
  let diskPath: string;
  if (filePath.startsWith("file://")) {
    url = filePath;
    diskPath = fileURLToPath(filePath);
  } else if (existsSync(filePath)) {
    url = pathToFileURL(filePath).href;
    diskPath = filePath;
  } else {
    throw new Error(`Plugin file not found: ${filePath}`);
  }

  // 1. Read + hash the plugin bytes before any evaluation.
  const bytes = await readFile(diskPath);
  const hash = createHash("sha256").update(bytes).digest("hex");

  // 2. Verify signature. A failing result aborts the load — the module is
  //    never passed to `import()`.
  const verifier = getPluginVerifier();
  const result = await verifier.verify({ path: diskPath, bytes, hash });
  if (!result.ok) {
    emitAudit({
      kind: "plugin.rejected",
      path: diskPath,
      verifierKind: verifier.kind,
      reason: result.reason,
    });
    throw new ClawPilotError(
      `Plugin rejected by verifier "${verifier.kind}": ${result.reason}`,
      "PLUGIN_REJECTED",
    );
  }

  // 3. Only now load the module.
  let mod: Record<string, unknown>;
  try {
    mod = (await import(url)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to load plugin from ${filePath}: ${err}`);
  }

  // Support both default export and named export
  const factory = (mod["default"] ?? mod["plugin"]) as Plugin | undefined;
  if (typeof factory !== "function") {
    throw new Error(`Plugin at ${filePath} must export a default function. Got: ${typeof factory}`);
  }

  const name =
    filePath
      .split("/")
      .pop()
      ?.replace(/\.[jt]s$/, "") ?? filePath;
  registerPlugin(name, factory);
  _initialized = false;
}

/**
 * Reset the plugin system (useful for testing).
 */
export function resetPlugins(): void {
  _plugins.length = 0;
  _initialized = false;
  clearHooks();
}
