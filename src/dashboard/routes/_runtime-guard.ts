// src/dashboard/routes/_runtime-guard.ts
//
// Guard that checks if an instance's runtime daemon is running.
// Returns an error response if not, null if OK.

import type { Context } from "hono";
import { getRuntimeStateDir, isRuntimeRunning } from "../../lib/platform.js";
import { apiError } from "../route-deps.js";

/**
 * Check that the runtime daemon for `slug` is running.
 * Returns an error Response to send if not running, null if OK.
 */
export function runtimeGuard(c: Context, slug: string): Response | null {
  const stateDir = getRuntimeStateDir(slug);
  if (!isRuntimeRunning(stateDir)) {
    return apiError(
      c,
      503,
      "RUNTIME_NOT_RUNNING",
      "Instance runtime is not running",
    ) as unknown as Response;
  }
  return null;
}
