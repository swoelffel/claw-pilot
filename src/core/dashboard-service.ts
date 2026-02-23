// src/core/dashboard-service.ts
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { statSync } from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { isLinux, getSystemdDir, getDashboardServicePath, DASHBOARD_SERVICE_UNIT } from "../lib/platform.js";
import { generateDashboardService } from "./systemd-generator.js";
import { constants } from "../lib/constants.js";

export interface DashboardServiceStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  pid?: number;
  uptime?: string;
  portResponding: boolean;
}

/** Resolve the absolute path to the node binary */
function resolveNodeBin(): string {
  try {
    const result = spawnSync("which", ["node"], { encoding: "utf-8" });
    const bin = result.stdout.trim();
    if (bin) return bin;
  } catch { /* ignore */ }
  // Fallback common paths
  for (const p of ["/usr/local/bin/node", "/usr/bin/node"]) {
    try {
      spawnSync(p, ["--version"], { encoding: "utf-8" });
      return p;
    } catch { /* ignore */ }
  }
  throw new Error("Cannot find node binary. Ensure Node.js is in PATH.");
}

/** Resolve the absolute path to the claw-pilot dist/index.mjs */
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
    } catch { /* ignore */ }
  }
  // Last resort: use the symlink in PATH
  try {
    const result = spawnSync("which", ["claw-pilot"], { encoding: "utf-8" });
    const bin = result.stdout.trim();
    if (bin) return bin;
  } catch { /* ignore */ }
  throw new Error("Cannot find claw-pilot binary. Ensure it is installed.");
}

/** Run a systemctl --user command, returns exit code */
function systemctlUser(args: string[]): { code: number; stdout: string; stderr: string } {
  const uid = process.getuid?.() ?? 1000;
  const xdgRuntimeDir = `/run/user/${uid}`;
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf-8",
    env: { ...process.env, XDG_RUNTIME_DIR: xdgRuntimeDir },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Check if linger is enabled for the current user, enable it if not */
async function ensureLinger(): Promise<void> {
  const username = os.userInfo().username;
  const result = spawnSync("loginctl", ["show-user", username, "-p", "Linger"], {
    encoding: "utf-8",
  });
  if (result.stdout.includes("Linger=yes")) return;

  // Try to enable linger (may need sudo)
  const enableResult = spawnSync("loginctl", ["enable-linger", username], {
    encoding: "utf-8",
  });
  if (enableResult.status !== 0) {
    // Try with sudo
    const sudoResult = spawnSync("sudo", ["loginctl", "enable-linger", username], {
      stdio: "inherit",
    });
    if (sudoResult.status !== 0) {
      console.warn(`[!] Could not enable linger for ${username}. The dashboard service may stop on logout.`);
      console.warn(`    Run manually: sudo loginctl enable-linger ${username}`);
    }
  }
}

/** Check if port is responding */
async function isPortResponding(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Wait for port to respond, with timeout */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortResponding(port)) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

export async function installDashboardService(port = constants.DASHBOARD_PORT): Promise<void> {
  if (!isLinux()) {
    throw new Error("systemd services are only supported on Linux.");
  }

  const nodeBin = resolveNodeBin();
  const clawPilotBin = resolveClawPilotBin();
  const home = os.homedir();
  const uid = process.getuid?.() ?? 1000;

  // Generate service file content
  const serviceContent = generateDashboardService({ nodeBin, clawPilotBin, port, home, uid });

  // Ensure systemd user dir exists
  const systemdDir = getSystemdDir();
  await fs.mkdir(systemdDir, { recursive: true });

  // Write service file
  const servicePath = getDashboardServicePath();
  await fs.writeFile(servicePath, serviceContent, { mode: 0o644 });
  console.log(`[+] Service file written: ${servicePath}`);

  // Ensure linger is enabled
  await ensureLinger();

  // daemon-reload
  const reload = systemctlUser(["daemon-reload"]);
  if (reload.code !== 0) {
    throw new Error(`systemctl daemon-reload failed: ${reload.stderr}`);
  }

  // enable
  const enable = systemctlUser(["enable", DASHBOARD_SERVICE_UNIT]);
  if (enable.code !== 0) {
    throw new Error(`systemctl enable failed: ${enable.stderr}`);
  }

  // start
  const start = systemctlUser(["start", DASHBOARD_SERVICE_UNIT]);
  if (start.code !== 0) {
    throw new Error(`systemctl start failed: ${start.stderr}`);
  }

  // Wait for port to respond
  console.log(`[+] Waiting for dashboard to be ready on port ${port}...`);
  const ready = await waitForPort(port, 15_000);
  if (!ready) {
    console.warn(`[!] Dashboard service started but port ${port} is not responding yet.`);
    console.warn(`    Check logs: journalctl --user -u ${DASHBOARD_SERVICE_UNIT} -n 50`);
  } else {
    console.log(`[+] Dashboard is ready at http://localhost:${port}`);
  }
}

export async function uninstallDashboardService(): Promise<void> {
  if (!isLinux()) {
    throw new Error("systemd services are only supported on Linux.");
  }

  // stop (ignore errors if not running)
  systemctlUser(["stop", DASHBOARD_SERVICE_UNIT]);

  // disable (ignore errors if not enabled)
  systemctlUser(["disable", DASHBOARD_SERVICE_UNIT]);

  // Remove service file
  const servicePath = getDashboardServicePath();
  try {
    await fs.unlink(servicePath);
    console.log(`[+] Service file removed: ${servicePath}`);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    console.log(`[!] Service file not found (already removed): ${servicePath}`);
  }

  // daemon-reload
  systemctlUser(["daemon-reload"]);
  console.log(`[+] Dashboard service uninstalled.`);
}

export async function restartDashboardService(): Promise<void> {
  if (!isLinux()) {
    throw new Error("systemd services are only supported on Linux.");
  }
  const result = systemctlUser(["restart", DASHBOARD_SERVICE_UNIT]);
  if (result.code !== 0) {
    throw new Error(`systemctl restart failed: ${result.stderr}`);
  }
  console.log(`[+] Dashboard service restarted.`);
}

export async function getDashboardServiceStatus(port = constants.DASHBOARD_PORT): Promise<DashboardServiceStatus> {
  if (!isLinux()) {
    return { installed: false, active: false, enabled: false, portResponding: false };
  }

  const servicePath = getDashboardServicePath();
  let installed = false;
  try {
    await fs.access(servicePath);
    installed = true;
  } catch { /* not installed */ }

  const activeResult = systemctlUser(["is-active", DASHBOARD_SERVICE_UNIT]);
  const active = activeResult.code === 0;

  const enabledResult = systemctlUser(["is-enabled", DASHBOARD_SERVICE_UNIT]);
  const enabled = enabledResult.code === 0;

  // Get PID
  let pid: number | undefined;
  const showResult = systemctlUser(["show", DASHBOARD_SERVICE_UNIT, "--property=MainPID"]);
  const pidMatch = showResult.stdout.match(/MainPID=(\d+)/);
  if (pidMatch && pidMatch[1] !== "0") {
    pid = parseInt(pidMatch[1]);
  }

  // Get uptime
  let uptime: string | undefined;
  const uptimeResult = systemctlUser(["show", DASHBOARD_SERVICE_UNIT, "--property=ActiveEnterTimestamp"]);
  const tsMatch = uptimeResult.stdout.match(/ActiveEnterTimestamp=(.+)/);
  if (tsMatch) {
    uptime = tsMatch[1].trim();
  }

  const portResponding = await isPortResponding(port);

  return { installed, active, enabled, pid, uptime, portResponding };
}
