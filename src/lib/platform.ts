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

export function getOpenClawHome(): string {
  // Use OPENCLAW_HOME env var if set, otherwise default to current user's home.
  // ~/.openclaw-<slug>/ and ~/.openclaw/ (legacy) live under the home directory.
  return process.env["OPENCLAW_HOME"] ?? os.homedir();
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
  return path.join(getOpenClawHome(), ".config/systemd/user");
}

export function getSystemdUnit(slug: string): string {
  return `openclaw-${slug}.service`;
}

export const DASHBOARD_SERVICE_UNIT = "claw-pilot-dashboard.service";

export function getDashboardServicePath(): string {
  // Uses getSystemdDir() which follows the same home as other systemd units
  return path.join(getSystemdDir(), DASHBOARD_SERVICE_UNIT);
}
