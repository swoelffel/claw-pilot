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

/** @public */
export function isLinux(): boolean {
  return os.platform() === "linux";
}

export function isDarwin(): boolean {
  return os.platform() === "darwin";
}

export function isDocker(): boolean {
  return process.env["CLAW_PILOT_ENV"] === "docker";
}

/** Instances directory: ~/.claw-pilot/instances/ */
export function getInstancesDir(): string {
  return path.join(getDataDir(), constants.INSTANCES_DIR);
}

/** State directory for a claw-runtime instance. */
export function getRuntimeStateDir(slug: string): string {
  return path.join(getInstancesDir(), slug);
}

/** @public Path to runtime.json config for a claw-runtime instance. */
export function getRuntimeConfigPath(slug: string): string {
  return path.join(getRuntimeStateDir(slug), "runtime.json");
}

export function getSystemdDir(): string {
  return path.join(os.homedir(), ".config/systemd/user");
}

export const DASHBOARD_SERVICE_UNIT = "claw-pilot-dashboard.service";

export function getDashboardServicePath(): string {
  return path.join(getSystemdDir(), DASHBOARD_SERVICE_UNIT);
}

// --- Service manager abstraction ---

export type ServiceManager = "systemd" | "launchd";

export const SERVICE_MANAGER: ServiceManager = isDarwin() ? "launchd" : "systemd";

/** @deprecated Use SERVICE_MANAGER constant directly */
export function getServiceManager(): ServiceManager {
  return SERVICE_MANAGER;
}

// --- launchd helpers (macOS) — dashboard only ---

export function getLaunchdDir(): string {
  return path.join(os.homedir(), "Library/LaunchAgents");
}

export const DASHBOARD_LAUNCHD_LABEL = "io.claw-pilot.dashboard";

export function getDashboardLaunchdPlistPath(): string {
  return path.join(getLaunchdDir(), `${DASHBOARD_LAUNCHD_LABEL}.plist`);
}

// --- claw-runtime PID helpers ---

export function getRuntimePidPath(stateDir: string): string {
  return path.join(stateDir, "runtime.pid");
}

/**
 * Returns the PID of the running claw-runtime daemon for the given stateDir,
 * or null if the PID file is absent or the process is no longer alive.
 */
export function getRuntimePid(stateDir: string): number | null {
  const pidPath = getRuntimePidPath(stateDir);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (!pid || isNaN(pid)) return null;
    // Probe the process — kill(pid, 0) throws if it does not exist
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function isRuntimeRunning(stateDir: string): boolean {
  return getRuntimePid(stateDir) !== null;
}
