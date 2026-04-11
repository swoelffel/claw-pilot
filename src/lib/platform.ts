// src/lib/platform.ts
import * as os from "node:os";
import * as path from "node:path";
import { constants } from "./constants.js";
import { logger } from "./logger.js";

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

export function getSystemdUserDir(): string {
  return path.join(os.homedir(), ".config/systemd/user");
}

export function getSystemdSystemDir(): string {
  return "/etc/systemd/system";
}

export const DASHBOARD_SERVICE_UNIT = "claw-pilot-dashboard.service";

export function getDashboardServicePath(systemLevel = false): string {
  const dir = systemLevel ? getSystemdSystemDir() : getSystemdUserDir();
  return path.join(dir, DASHBOARD_SERVICE_UNIT);
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
  } catch (err) {
    logger.debug("[platform] getRuntimePid failed", { error: String(err) });
    return null;
  }
}

export function isRuntimeRunning(stateDir: string): boolean {
  return getRuntimePid(stateDir) !== null;
}

// --- Web-chat port derivation ---

/** Base port for web-chat channels (dashboard is 19000, instances start at 19100) */
const WEB_CHAT_BASE_PORT = 19100;

/** Number of ports in the web-chat range (max instances before hash collision) */
const WEB_CHAT_PORT_RANGE = 100;

/**
 * Derive a deterministic web-chat port from the instance slug.
 * Uses a djb2-style hash to spread ports across the 19100–19199 range.
 */
export function deriveWebChatPort(slug: string): number {
  return WEB_CHAT_BASE_PORT + (djb2Hash(slug) % WEB_CHAT_PORT_RANGE);
}

// ---------------------------------------------------------------------------
// Internal API port (runtime daemon ← dashboard IPC)
// ---------------------------------------------------------------------------

/** Base port for the internal API HTTP server used by dashboard→runtime IPC. */
const INTERNAL_API_BASE_PORT = 19200;

/** Number of ports in the internal API range. */
const INTERNAL_API_PORT_RANGE = 100;

/**
 * Derive a deterministic internal API port from the instance slug.
 * Uses the same djb2 hash to spread ports across the 19200–19299 range.
 */
export function deriveInternalApiPort(slug: string): number {
  return INTERNAL_API_BASE_PORT + (djb2Hash(slug) % INTERNAL_API_PORT_RANGE);
}

/**
 * Resolve the internal API token for dashboard→runtime IPC.
 * Checks env `CLAW_RUNTIME_INTERNAL_TOKEN`, falls back to dev token.
 */
export function resolveInternalApiToken(slug: string): string {
  return process.env["CLAW_RUNTIME_INTERNAL_TOKEN"] ?? `internal-dev-${slug}`;
}

// ---------------------------------------------------------------------------
// djb2 hash helper
// ---------------------------------------------------------------------------

/** djb2-style hash — deterministic, fast, good distribution. */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash;
}
