// src/core/dashboard-service.ts
import * as os from "node:os";
import * as path from "node:path";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServerConnection } from "../server/connection.js";
import {
  getSystemdSystemDir,
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

export interface DashboardServiceStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  pid?: number;
  uptime?: string;
  portResponding: boolean;
}

/**
 * Resolve the absolute path to the claw-pilot dist/index.js.
 * Uses import.meta.url to find the binary relative to this file — local filesystem only.
 */
function resolveClawPilotBin(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // In dev: src/core/ -> go up 2 levels to project root, then dist/index.js
  // In prod (bundled): dist/ -> dist/index.js
  const candidates = [
    path.resolve(currentDir, "../../dist/index.js"), // dev
    path.resolve(currentDir, "../index.js"), // prod (bundled in dist/)
    path.resolve(currentDir, "index.js"), // prod (same dir)
  ];
  for (const c of candidates) {
    try {
      statSync(c);
      return c;
    } catch (err) {
      logger.debug("[dashboard-service] candidate binary path not found", { error: String(err) });
    }
  }
  throw new Error("Cannot find claw-pilot binary. Ensure it is installed.");
}

/** Check if port is responding (any HTTP response = server is up, even 401) */
async function isPortResponding(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    // Any response (including 401 Unauthorized) means the server is up
    return true;
  } catch (err) {
    logger.debug("[dashboard-service] port health check failed", { error: String(err) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Node binary resolution
// ---------------------------------------------------------------------------

/** Resolve the node binary path, checking PATH then known fallback locations. */
async function resolveNodeBinary(
  conn: ServerConnection,
  sm: string,
  home: string,
): Promise<string> {
  const nodeResult = await conn.execFile("which", ["node"]);
  let nodeBin = nodeResult.stdout.trim();
  if (nodeBin) return nodeBin;

  // Fallback: check known paths including nvm/volta/fnm
  const nodeCandidates =
    sm === "launchd"
      ? ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
      : ["/usr/local/bin/node", "/usr/bin/node"];
  for (const candidate of nodeCandidates) {
    if (await conn.exists(candidate)) return candidate;
  }

  // nvm glob fallback (macOS + Linux)
  const nvmResult = await conn.exec(
    `ls ${home}/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1`,
  );
  const nvmBin = nvmResult.stdout.trim();
  if (nvmBin) return nvmBin;

  // volta fallback
  if (await conn.exists(`${home}/.volta/bin/node`)) {
    return `${home}/.volta/bin/node`;
  }

  throw new Error("Cannot find node binary. Ensure Node.js is in PATH.");
}

// ---------------------------------------------------------------------------
// macOS service installation
// ---------------------------------------------------------------------------

/** Install the dashboard as a macOS launchd agent. */
async function installMacOSService(
  conn: ServerConnection,
  nodeBin: string,
  clawPilotBin: string,
  port: number,
  home: string,
): Promise<void> {
  const plistContent = generateDashboardLaunchdPlist({ nodeBin, clawPilotBin, port, home });

  const launchdDir = getLaunchdDir();
  await conn.mkdir(launchdDir);

  const plistPath = getDashboardLaunchdPlistPath();
  await conn.writeFile(plistPath, plistContent, 0o644);
  logger.success(`Launchd plist written: ${plistPath}`);

  // Load the agent
  await conn.execFile("launchctl", ["load", "-w", plistPath]);
  logger.success(`Launchd agent loaded: ${DASHBOARD_LAUNCHD_LABEL}`);
}

// ---------------------------------------------------------------------------
// Linux service installation
// ---------------------------------------------------------------------------

/** Install the dashboard as a Linux systemd system service. */
async function installLinuxService(
  conn: ServerConnection,
  nodeBin: string,
  clawPilotBin: string,
  port: number,
  home: string,
): Promise<void> {
  // System services work without linger and survive reboots regardless of user login
  //
  // When install.sh runs `sudo claw-pilot service install`, this process is root.
  // Use SUDO_USER / SUDO_UID to resolve the real user who invoked sudo,
  // so the service runs as the correct non-root user.
  const isRoot = process.getuid?.() === 0;
  const uid =
    isRoot && process.env.SUDO_UID
      ? parseInt(process.env.SUDO_UID, 10)
      : (process.getuid?.() ?? 1000);
  const username = isRoot && process.env.SUDO_USER ? process.env.SUDO_USER : os.userInfo().username;
  const serviceHome = isRoot && process.env.SUDO_USER ? `/home/${process.env.SUDO_USER}` : home;

  // Generate service file content (system-level)
  const serviceContent = generateDashboardService({
    nodeBin,
    clawPilotBin,
    port,
    home: serviceHome,
    uid,
    username,
  });

  // Ensure systemd system dir exists
  const systemdSystemDir = getSystemdSystemDir();
  await conn.mkdir(systemdSystemDir);

  // Write service file to /etc/systemd/system/
  const servicePath = getDashboardServicePath(true);
  await conn.writeFile(servicePath, serviceContent, 0o644);
  logger.success(`Service file written: ${servicePath}`);

  // System services require root — use sudo directly to avoid polkit/pkttyagent noise.
  // If already root (e.g. called via sudo from install.sh), sudo is a no-op.
  const sudo = isRoot ? "" : "sudo ";

  const reload = await conn.exec(`${sudo}systemctl daemon-reload`);
  if (reload.exitCode !== 0) {
    throw new Error(`systemctl daemon-reload failed: ${reload.stderr}`);
  }

  const enable = await conn.exec(`${sudo}systemctl enable ${DASHBOARD_SERVICE_UNIT}`);
  if (enable.exitCode !== 0) {
    throw new Error(`systemctl enable failed: ${enable.stderr}`);
  }

  const start = await conn.exec(`${sudo}systemctl start ${DASHBOARD_SERVICE_UNIT}`);
  if (start.exitCode !== 0) {
    throw new Error(`systemctl start failed: ${start.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Port readiness check
// ---------------------------------------------------------------------------

/** Wait for the dashboard port to respond, with a timeout. */
async function waitForPortReady(sm: string, port: number, home: string): Promise<void> {
  logger.info(`Waiting for dashboard to be ready on port ${port}...`);
  try {
    await pollUntilReady({
      check: () => isPortResponding(port),
      timeoutMs: 15_000,
      label: `dashboard port ${port}`,
    });
    logger.success(`Dashboard is ready at http://localhost:${port}`);
  } catch (err) {
    logger.warn(`[dashboard-service] port ${port} not responding after install`, {
      error: String(err),
    });
    if (sm === "launchd") {
      logger.dim(`Check logs: tail -f ${home}/.claw-pilot/dashboard.log`);
    } else {
      logger.dim(`Check logs: sudo journalctl -u ${DASHBOARD_SERVICE_UNIT} -n 50`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function installDashboardService(
  conn: ServerConnection,
  xdgRuntimeDir: string,
  port: number = constants.DASHBOARD_PORT,
): Promise<void> {
  const sm = getServiceManager();
  const home = os.homedir();

  // Resolve node binary via conn
  const nodeBin = await resolveNodeBinary(conn, sm, home);
  const clawPilotBin = resolveClawPilotBin();

  if (sm === "launchd") {
    await installMacOSService(conn, nodeBin, clawPilotBin, port, home);
  } else {
    await installLinuxService(conn, nodeBin, clawPilotBin, port, home);
  }

  // Wait for port to respond
  await waitForPortReady(sm, port, home);
}

export async function uninstallDashboardService(
  conn: ServerConnection,
  _xdgRuntimeDir: string,
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
    // Linux: systemd system service — use sudo directly to avoid polkit/pkttyagent noise
    const isRoot = process.getuid?.() === 0;
    const sudo = isRoot ? "" : "sudo ";

    // stop (ignore errors if not running)
    await conn.exec(`${sudo}systemctl stop ${DASHBOARD_SERVICE_UNIT}`).catch(() => {});

    // disable (ignore errors if not enabled)
    await conn.exec(`${sudo}systemctl disable ${DASHBOARD_SERVICE_UNIT}`).catch(() => {});

    // Remove service file from /etc/systemd/system/
    const servicePath = getDashboardServicePath(true);
    try {
      await conn.remove(servicePath);
      logger.success(`Service file removed: ${servicePath}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      logger.info(`Service file not found (already removed): ${servicePath}`);
    }

    // daemon-reload
    await conn.exec(`${sudo}systemctl daemon-reload`).catch(() => {});
  }

  logger.success(`Dashboard service uninstalled.`);
}

export async function restartDashboardService(
  conn: ServerConnection,
  _xdgRuntimeDir: string,
): Promise<void> {
  const sm = getServiceManager();

  if (sm === "launchd") {
    const plistPath = getDashboardLaunchdPlistPath();
    await conn.execFile("launchctl", ["unload", plistPath]).catch(() => {});
    await conn.execFile("launchctl", ["load", "-w", plistPath]);
    logger.success(`Dashboard service restarted.`);
  } else {
    // Linux: systemd system service — use sudo directly to avoid polkit/pkttyagent noise
    const isRoot = process.getuid?.() === 0;
    const sudo = isRoot ? "" : "sudo ";
    const result = await conn.exec(`${sudo}systemctl restart ${DASHBOARD_SERVICE_UNIT}`);
    if (result.exitCode !== 0) {
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
    const listResult = await conn
      .execFile("launchctl", ["list", DASHBOARD_LAUNCHD_LABEL])
      .catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
    const active = listResult.exitCode === 0;
    // launchd agents with RunAtLoad=true are always "enabled" when the plist exists
    const enabled = installed;

    const portResponding = await isPortResponding(port);
    return { installed, active, enabled, portResponding };
  }

  // Linux: systemd system service
  const servicePath = getDashboardServicePath(true);
  const installed = await conn.exists(servicePath);

  const activeResult = await conn.exec(`systemctl is-active ${DASHBOARD_SERVICE_UNIT}`);
  const active = activeResult.exitCode === 0;

  const enabledResult = await conn.exec(`systemctl is-enabled ${DASHBOARD_SERVICE_UNIT}`);
  const enabled = enabledResult.exitCode === 0;

  // Get PID
  let pid: number | undefined;
  const showResult = await conn.exec(`systemctl show ${DASHBOARD_SERVICE_UNIT} --property=MainPID`);
  const pidMatch = showResult.stdout.match(/MainPID=(\d+)/);
  if (pidMatch && pidMatch[1] != null && pidMatch[1] !== "0") {
    pid = parseInt(pidMatch[1], 10);
  }

  // Get uptime
  let uptime: string | undefined;
  const uptimeResult = await conn.exec(
    `systemctl show ${DASHBOARD_SERVICE_UNIT} --property=ActiveEnterTimestamp`,
  );
  const tsMatch = uptimeResult.stdout.match(/ActiveEnterTimestamp=(.+)/);
  if (tsMatch && tsMatch[1] != null) {
    uptime = tsMatch[1].trim();
  }

  const portResponding = await isPortResponding(port);

  return {
    installed,
    active,
    enabled,
    portResponding,
    ...(pid !== undefined && { pid }),
    ...(uptime !== undefined && { uptime }),
  };
}
