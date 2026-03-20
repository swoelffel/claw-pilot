// src/dashboard/route-deps.ts
import type { Context } from "hono";
import type Database from "better-sqlite3";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import type { HealthChecker } from "../core/health.js";
import type { Lifecycle } from "../core/lifecycle.js";
import type { Monitor } from "./monitor.js";
import type { SelfUpdateChecker } from "../core/self-update-checker.js";
import type { SelfUpdater } from "../core/self-updater.js";
import type { TokenCache } from "./token-cache.js";
import type { SessionStore } from "./session-store.js";

export interface RouteDeps {
  registry: Registry;
  conn: ServerConnection;
  health: HealthChecker;
  lifecycle: Lifecycle;
  monitor: Monitor;
  selfUpdateChecker: SelfUpdateChecker;
  selfUpdater: SelfUpdater;
  tokenCache: TokenCache;
  xdgRuntimeDir: string;
  sessionStore: SessionStore;
  /** Timestamp (ms) when the dashboard server started — used for uptime calculation. */
  startedAt: number;
  /** SQLite database handle — used for DB size reporting in /api/health. */
  db: Database.Database;
}

// Structured error helper — all API error responses go through this function.
// Returns { error: <human message for logs>, code: <machine code for i18n> }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiError(c: Context<any, any, any>, status: number, code: string, message: string) {
  return c.json({ error: message, code }, status as 400 | 401 | 403 | 404 | 409 | 413 | 500);
}
