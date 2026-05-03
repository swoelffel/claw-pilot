// src/dashboard/server-extensions.ts
//
// Pluggable hook for downstream editions to wire additional dashboard
// features (route modules, background tasks, auth providers backed by the
// dashboard DB) without modifying `src/dashboard/server.ts` itself.
//
// Community ships no extensions; the registry is empty by default. The
// Hono app and the populated `RouteDeps` are passed verbatim to each
// extension so they can register routes, mutate `deps`, or kick off
// schedulers.
//
// Extensions run AFTER every Community route module has been registered
// (so they can mount additional routes alongside the built-ins) and BEFORE
// the HTTP listener accepts traffic (so users never see a half-wired
// dashboard). They run in registration order, sequentially. Failures
// propagate and abort the boot — extensions that need to degrade
// gracefully must swallow their own errors.

import type { Hono } from "hono";
import type { RouteDeps } from "./route-deps.js";

/**
 * Callback signature consumed by `registerServerExtension`. Receives the
 * fully populated `RouteDeps` (DB handle, registry, monitor, etc.) and the
 * Hono `app` instance the Community routes are mounted on.
 */
export type ServerExtension = (deps: RouteDeps, app: Hono) => void | Promise<void>;

const extensions: ServerExtension[] = [];

/**
 * Register an extension to be invoked once during dashboard server boot.
 *
 * Re-registering the same callback function is a silent no-op — useful for
 * test contexts that re-import a module or for hot-reload scenarios where
 * the registration code path runs multiple times.
 */
export function registerServerExtension(extension: ServerExtension): void {
  if (!extensions.includes(extension)) {
    extensions.push(extension);
  }
}

/** Snapshot of the registered extensions in insertion order. */
export function getRegisteredServerExtensions(): readonly ServerExtension[] {
  return extensions.slice();
}

/**
 * Test-only helper — clear the extension registry between fixtures.
 * Production code does not need this; registration happens once per
 * process lifetime.
 */
export function clearServerExtensions(): void {
  extensions.length = 0;
}
