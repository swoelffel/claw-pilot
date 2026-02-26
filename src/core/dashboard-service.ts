// src/core/dashboard-service.ts
import * as os from "node:os";
import * as path from "node:path";
import { statSync } from "node:fs";
import type { ServerConnection } from "../server/connection.js";
import {
  getSystemdDir,
  getDashboardServicePath,
  DASHBOARD_SERVICE_UNIT,
  getServiceManager,
  getLaunchdDir,
  getDashboardLaunchdPlistPath,
  DASHBOARD_LAUNCHD_LABEL,
} from "../lib/platform.js";
import { generateDashboardService } from "./systemd-generator.js";
import { generateDashboardLaunchdPlist } from "./launchd-generator.js";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";
import { pollUntilReady } from "../lib/poll.js";
import { shellEscape } from "../lib/shell.js";

export interface DashboardServiceStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  pid?: number;
  uptime?: string;
  portResponding: boolean;
}

/**
 * Resolve the absolute path to the claw-pilot dist/index.mjs.
 * Uses import.meta.url to find the binary relative to this file — local filesystem only.
 */
function resolveClawPilotBin(): string {
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  // In dev: src/core/ -> go up 2 levels to project root, then dist/index.mjs
  // In prod (bundled): dist/ -> dist/index.mjs
  const candidates = [
    path.resolve(currentDir, "../../dist/index.mjs"),  // dev
    path.resolve(currentDir, "../index.mjs"),           // prod (bundled in dist/)
    path.resolve(currentDir, "index.mjs"),              // prod (same dir)
  ];
  for (const c of candidates) {
    try {
      statSync(c);
      return c;
    } catch {
      // Candidate path not found
    }
  }
  throw new Error("Cannot find claw-pilot binary. Ensure it is installed.");
}

/** Run a systemctl --user command via ServerConnection */
async function systemctlUser(
  conn: ServerConnection,
  xdgRuntimeDir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await conn.execFile("systemctl", ["--user", ...args], {
    env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
  });
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

/** Check if linger is enabled for the current user, enable it if not */
async function ensureLinger(conn: ServerConnection): Promise<void> {
  const whoami = await conn.execFile("whoami", []);
  const username = whoami.stdout.trim() || os.userInfo().username;

  const check = await conn.execFile("loginctl", ["show-user", username, "-p", "Linger"]);
  if (check.stdout.includes("Linger=yes")) return;

  // Try to enable linger directly
  logger.step("Enabling lingering for systemd user services...");
  const enable = await conn.execFile("loginctl", ["enable-linger", username]);
  if (enable.exitCode === 0) {
    logger.success("Linger enabled");
    return;
  }

  // Fallback: sudo
  logger.dim("Retrying with sudo...");
  const sudo = await conn.exec(`sudo loginctl enable-linger ${shellEscape(username)}`);
  if (sudo.exitCode !== 0) {
    logger.warn(`Could not enable linger for ${username}. The dashboard service may stop on logout.`);
    logger.dim(`Run manually: sudo loginctl enable-linger ${username}`);
  } else {
    logger.success("Linger enabled (via sudo)");
  }
}

/** Check if port is responding (any HTTP response = server is up, even 401) */
async function isPortResponding(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    // Any response (including 401 Unauthorized) means the server is up
    return true;
  } catch {
    return false;
  }
}

export async function installDashboardService(
  conn: ServerConnection,
  xdgRuntimeDir: string,
  port: number = constants.DASHBOARD_PORT,
): Promise<void> {
  const sm = getServiceManager();

  // Resolve node binary via conn
  const nodeResult = await conn.execFile("which", ["node"]);
  let nodeBin = nodeResult.stdout.trim();
  if (!nodeBin) {
    // Fallback: check known paths
    const nodeCandidates = sm === "launchd"
      ? ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
      : ["/usr/local/bin/node", "/usr/bin/node"];
    for (const candidate of nodeCandidates) {
      if (await conn.exists(candidate)) {
        nodeBin = candidate;
        break;
      }
    }
  }
  if (!nodeBin) {
    throw new Error("Cannot find node binary. Ensure Node.js is in PATH.");
  }

  const clawPilotBin = resolveClawPilotBin();
  const home = os.homedir();

  if (sm === "launchd") {
    // macOS: install as launchd agent
    const plistContent = generateDashboardLaunchdPlist({ nodeBin, clawPilotBin, port, home });

    const launchdDir = getLaunchdDir();
    await conn.mkdir(launchdDir);

    const plistPath = getDashboardLaunchdPlistPath();
    await conn.writeFile(plistPath, plistContent, 0o644);
    logger.success(`Launchd plist written: ${plistPath}`);

    // Load the agent
    await conn.execFile("launchctl", ["load", "-w", plistPath]);
    logger.success(`Launchd agent loaded: ${DASHBOARD_LAUNCHD_LABEL}`);
  } else {
    // Linux: install as systemd user service
    const uid = process.getuid?.() ?? 1000;

    // Generate service file content
    const serviceContent = generateDashboardService({ nodeBin, clawPilotBin, port, home, uid });

    // Ensure systemd user dir exists
    const systemdDir = getSystemdDir();
    await conn.mkdir(systemdDir);

    // Write service file
    const servicePath = getDashboardServicePath();
    await conn.writeFile(servicePath, serviceContent, 0o644);
    logger.success(`Service file written: ${servicePath}`);

    // Ensure linger is enabled
    await ensureLinger(conn);

    // daemon-reload
    const reload = await systemctlUser(conn, xdgRuntimeDir, ["daemon-reload"]);
    if (reload.code !== 0) {
      throw new Error(`systemctl daemon-reload failed: ${reload.stderr}`);
    }

    // enable
    const enable = await systemctlUser(conn, xdgRuntimeDir, ["enable", DASHBOARD_SERVICE_UNIT]);
    if (enable.code !== 0) {
      throw new Error(`systemctl enable failed: ${enable.stderr}`);
    }

    // start
    const start = await systemctlUser(conn, xdgRuntimeDir, ["start", DASHBOARD_SERVICE_UNIT]);
    if (start.code !== 0) {
      throw new Error(`systemctl start failed: ${start.stderr}`);
    }
  }

  // Wait for port to respond
  logger.info(`Waiting for dashboard to be ready on port ${port}...`);
  try {
    await pollUntilReady({
      check: () => isPortResponding(port),
      timeoutMs: 15_000,
      label: `dashboard port ${port}`,
    });
    logger.success(`Dashboard is ready at http://localhost:${port}`);
  } catch {
    logger.warn(`Dashboard service started but port ${port} is not responding yet.`);
    if (sm === "launchd") {
      logger.dim(`Check logs: tail -f ${home}/.claw-pilot/dashboard.log`);
    } else {
      logger.dim(`Check logs: journalctl --user -u ${DASHBOARD_SERVICE_UNIT} -n 50`);
    }
  }
}

export async function uninstallDashboardService(
  conn: ServerConnection,
  xdgRuntimeDir: string,
): Promise<void> {
  const sm = getServiceManager();

  if (sm === "launchd") {
    const plistPath = getDashboardLaunchdPlistPath();
    // unload (ignore errors if not loaded)
    await conn.execFile("launchctl", ["unload", plistPath]).catch(() => {});
    // Remove plist file
    try {
      await conn.remove(plistPath);
      logger.success(`Launchd plist removed: ${plistPath}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      logger.info(`Launchd plist not found (already removed): ${plistPath}`);
    }
  } else {
    // stop (ignore errors if not running)
    await systemctlUser(conn, xdgRuntimeDir, ["stop", DASHBOARD_SERVICE_UNIT]);

    // disable (ignore errors if not enabled)
    await systemctlUser(conn, xdgRuntimeDir, ["disable", DASHBOARD_SERVICE_UNIT]);

    // Remove service file
    const servicePath = getDashboardServicePath();
    try {
      await conn.remove(servicePath);
      logger.success(`Service file removed: ${servicePath}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      logger.info(`Service file not found (already removed): ${servicePath}`);
    }

    // daemon-reload
    await systemctlUser(conn, xdgRuntimeDir, ["daemon-reload"]);
  }

  logger.success(`Dashboard service uninstalled.`);
}

export async function restartDashboardService(
  conn: ServerConnection,
  xdgRuntimeDir: string,
): Promise<void> {
  const sm = getServiceManager();

  if (sm === "launchd") {
    const plistPath = getDashboardLaunchdPlistPath();
    await conn.execFile("launchctl", ["unload", plistPath]).catch(() => {});
    await conn.execFile("launchctl", ["load", "-w", plistPath]);
    logger.success(`Dashboard service restarted.`);
  } else {
    const result = await systemctlUser(conn, xdgRuntimeDir, ["restart", DASHBOARD_SERVICE_UNIT]);
    if (result.code !== 0) {
      throw new Error(`systemctl restart failed: ${result.stderr}`);
    }
    logger.success(`Dashboard service restarted.`);
  }
}

export async function getDashboardServiceStatus(
  conn: ServerConnection,
  xdgRuntimeDir: string,
  port = constants.DASHBOARD_PORT,
): Promise<DashboardServiceStatus> {
  const sm = getServiceManager();

  if (sm === "launchd") {
    const plistPath = getDashboardLaunchdPlistPath();
    const installed = await conn.exists(plistPath);

    // launchctl list returns exit 0 if the agent is loaded/running
    const listResult = await conn.execFile("launchctl", ["list", DASHBOARD_LAUNCHD_LABEL]).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
    const active = listResult.exitCode === 0;
    // launchd agents with RunAtLoad=true are always "enabled" when the plist exists
    const enabled = installed;

    const portResponding = await isPortResponding(port);
    return { installed, active, enabled, portResponding };
  }

  // Linux: systemd
  const servicePath = getDashboardServicePath();
  const installed = await conn.exists(servicePath);

  const activeResult = await systemctlUser(conn, xdgRuntimeDir, ["is-active", DASHBOARD_SERVICE_UNIT]);
  const active = activeResult.code === 0;

  const enabledResult = await systemctlUser(conn, xdgRuntimeDir, ["is-enabled", DASHBOARD_SERVICE_UNIT]);
  const enabled = enabledResult.code === 0;

  // Get PID
  let pid: number | undefined;
  const showResult = await systemctlUser(conn, xdgRuntimeDir, ["show", DASHBOARD_SERVICE_UNIT, "--property=MainPID"]);
  const pidMatch = showResult.stdout.match(/MainPID=(\d+)/);
  if (pidMatch && pidMatch[1] != null && pidMatch[1] !== "0") {
    pid = parseInt(pidMatch[1], 10);
  }

  // Get uptime
  let uptime: string | undefined;
  const uptimeResult = await systemctlUser(conn, xdgRuntimeDir, ["show", DASHBOARD_SERVICE_UNIT, "--property=ActiveEnterTimestamp"]);
  const tsMatch = uptimeResult.stdout.match(/ActiveEnterTimestamp=(.+)/);
  if (tsMatch && tsMatch[1] != null) {
    uptime = tsMatch[1].trim();
  }

  const portResponding = await isPortResponding(port);

  return { installed, active, enabled, pid, uptime, portResponding };
}
