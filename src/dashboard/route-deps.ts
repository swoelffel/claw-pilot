// src/dashboard/route-deps.ts
import type { Context } from "hono";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import type { HealthChecker } from "../core/health.js";
import type { Lifecycle } from "../core/lifecycle.js";
import type { UpdateChecker } from "../core/update-checker.js";
import type { Updater } from "../core/updater.js";
import type { SelfUpdateChecker } from "../core/self-update-checker.js";
import type { SelfUpdater } from "../core/self-updater.js";
import type { TokenCache } from "./token-cache.js";
import type { SessionStore } from "./session-store.js";

export interface RouteDeps {
  registry: Registry;
  conn: ServerConnection;
  health: HealthChecker;
  lifecycle: Lifecycle;
  updateChecker: UpdateChecker;
  updater: Updater;
  selfUpdateChecker: SelfUpdateChecker;
  selfUpdater: SelfUpdater;
  tokenCache: TokenCache;
  xdgRuntimeDir: string;
  sessionStore: SessionStore;
}

// Structured error helper — all API error responses go through this function.
// Returns { error: <human message for logs>, code: <machine code for i18n> }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiError(c: Context<any, any, any>, status: number, code: string, message: string) {
  return c.json({ error: message, code }, status as 400 | 401 | 403 | 404 | 409 | 413 | 500);
}
