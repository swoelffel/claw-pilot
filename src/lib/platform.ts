// src/lib/platform.ts
import * as os from "node:os";
import * as path from "node:path";
import { constants } from "./constants.js";

export function getDataDir(): string {
  return path.join(os.homedir(), constants.DATA_DIR);
}

export function getDbPath(): string {
  return path.join(getDataDir(), constants.DB_FILE);
}

export function getDashboardTokenPath(): string {
  return path.join(getDataDir(), constants.DASHBOARD_TOKEN_FILE);
}

export function isLinux(): boolean {
  return os.platform() === "linux";
}

export function isDarwin(): boolean {
  return os.platform() === "darwin";
}

export function getOpenClawHome(dbPath?: string): string {
  // Priority: OPENCLAW_HOME env var > openclaw_home stored in DB > os.homedir()
  if (process.env["OPENCLAW_HOME"]) return process.env["OPENCLAW_HOME"];

  // Read from DB if available (set during `claw-pilot init` from detected openclaw binary)
  const resolvedDbPath = dbPath ?? getDbPath();
  try {
    // Lazy require to avoid circular dependency — only used at runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(resolvedDbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT openclaw_home FROM servers WHERE id = 1")
        .get() as { openclaw_home: string } | undefined;
      if (row?.openclaw_home) return row.openclaw_home;
    } finally {
      db.close();
    }
  } catch {
    // DB not yet initialized or not accessible — fall through to default
  }

  return os.homedir();
}

export function getStateDir(slug: string): string {
  return path.join(
    getOpenClawHome(),
    `${constants.OPENCLAW_STATE_PREFIX}${slug}`,
  );
}

export function getConfigPath(slug: string): string {
  return path.join(getStateDir(slug), "openclaw.json");
}

export function getSystemdDir(): string {
  // Systemd --user units always live in $HOME/.config/systemd/user/,
  // regardless of OPENCLAW_HOME.
  return path.join(os.homedir(), ".config/systemd/user");
}

export function getSystemdUnit(slug: string): string {
  return `openclaw-${slug}.service`;
}

export const DASHBOARD_SERVICE_UNIT = "claw-pilot-dashboard.service";

export function getDashboardServicePath(): string {
  // Uses getSystemdDir() which follows the same home as other systemd units
  return path.join(getSystemdDir(), DASHBOARD_SERVICE_UNIT);
}

// --- Service manager abstraction ---

export type ServiceManager = "systemd" | "launchd";

export const SERVICE_MANAGER: ServiceManager = isDarwin() ? "launchd" : "systemd";

/** @deprecated Use SERVICE_MANAGER constant directly */
export function getServiceManager(): ServiceManager {
  return SERVICE_MANAGER;
}

// --- launchd helpers (macOS) ---

export function getLaunchdDir(): string {
  return path.join(os.homedir(), "Library/LaunchAgents");
}

export function getLaunchdLabel(slug: string): string {
  return `ai.openclaw.${slug}`;
}

export function getLaunchdPlistPath(slug: string): string {
  return path.join(getLaunchdDir(), `${getLaunchdLabel(slug)}.plist`);
}

export const DASHBOARD_LAUNCHD_LABEL = "io.claw-pilot.dashboard";

export function getDashboardLaunchdPlistPath(): string {
  return path.join(getLaunchdDir(), `${DASHBOARD_LAUNCHD_LABEL}.plist`);
}
