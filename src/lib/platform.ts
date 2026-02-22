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
  // Production (Linux): /opt/openclaw
  // Dev (macOS): ~/
  return isLinux() ? constants.OPENCLAW_HOME : os.homedir();
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
