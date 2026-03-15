// src/core/lifecycle.ts
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import {
  isDocker,
  getServiceManager,
  getRuntimeStateDir,
  getRuntimePidPath,
  getRuntimePid,
  isRuntimeRunning,
} from "../lib/platform.js";
import { logger } from "../lib/logger.js";
import { ensureRuntimeConfig } from "../runtime/engine/config-loader.js";

/** Read the last N lines of a file. Returns empty string if file is missing or unreadable. */
function readLastLines(filePath: string, n: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.trimEnd().split("\n");
    return lines.slice(-n).join("\n");
  } catch {
    return "";
  }
}

export class Lifecycle {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
  ) {}

  async start(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.startRuntime(slug, instance.state_dir);
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "started");
  }

  async stop(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.stopRuntime(slug, instance.state_dir);
    this.registry.updateInstanceState(slug, "stopped");
    this.registry.logEvent(slug, "stopped");
  }

  async restart(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.stopRuntime(slug, instance.state_dir);
    await this.startRuntime(slug, instance.state_dir);
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "restarted");
  }

  async enable(_slug: string): Promise<void> {
    // No-op: claw-runtime has no service file to enable
  }

  async daemonReload(): Promise<void> {
    // Dashboard service may still use systemd/launchd — keep this for dashboard-service.ts
    if (isDocker()) return;
    if (getServiceManager() === "launchd") return;
    await this.conn.execFile("systemctl", ["--user", "daemon-reload"], {
      env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir },
    });
  }

  // ---------------------------------------------------------------------------
  // claw-runtime daemon helpers
  // ---------------------------------------------------------------------------

  /**
   * Start a claw-runtime daemon for the given slug.
   * Spawns `claw-pilot runtime start <slug>` as a detached child,
   * then polls the PID file until the process is alive (up to 10 s).
   * If the child exits prematurely, throws immediately with the last log lines.
   */
  private async startRuntime(slug: string, _stateDir: string): Promise<void> {
    // Always derive stateDir from slug — DB value may be stale after migration.
    const stateDir = getRuntimeStateDir(slug);
    if (isRuntimeRunning(stateDir)) {
      const pid = getRuntimePid(stateDir);
      logger.dim(`[lifecycle] claw-runtime for "${slug}" already running (PID ${pid})`);
      return;
    }

    // Ensure runtime.json exists before spawning — creates it with defaults if absent.
    // Without this, the daemon exits immediately (silently) and the PID file never appears.
    ensureRuntimeConfig(stateDir);

    logger.dim(`[lifecycle] Starting claw-runtime daemon for "${slug}"...`);

    // Always redirect stdout+stderr to the log file so we can read it on failure.
    const logDir = `${stateDir}/logs`;
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = `${logDir}/runtime.log`;
    const logFd = fs.openSync(logFile, "a");

    // Spawn `runtime start <slug>` (foreground mode — writes PID file then runs).
    // On Linux (including Docker), wrap with nohup so the child survives when the
    // docker exec session ends. Without nohup, Docker kills the child process
    // even with detached:true + setsid.
    const nodeArgs = [process.argv[1]!, "runtime", "start", slug];
    const isDarwinPlatform = process.platform === "darwin";
    const [spawnCmd, spawnArgs] = isDarwinPlatform
      ? [process.execPath, nodeArgs]
      : ["nohup", [process.execPath, ...nodeArgs]];

    const child = spawn(spawnCmd, spawnArgs, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();

    // Track premature exit — if the child dies before writing the PID file, fail fast.
    let childExitCode: number | null = null;
    child.once("exit", (code) => {
      childExitCode = code ?? 1;
    });

    // Poll for PID file (up to 10 s)
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));

      if (isRuntimeRunning(stateDir)) {
        logger.dim(`[lifecycle] claw-runtime started (PID ${getRuntimePid(stateDir)})`);
        return;
      }

      // Child exited without writing a valid PID file — fail immediately
      if (childExitCode !== null) {
        const tail = readLastLines(logFile, 20);
        const hint = tail ? `\n\nLast log lines (${logFile}):\n${tail}` : "";
        throw new Error(
          `claw-runtime for "${slug}" exited with code ${childExitCode} before writing PID file.${hint}`,
        );
      }
    }

    const tail = readLastLines(logFile, 20);
    const hint = tail ? `\n\nLast log lines (${logFile}):\n${tail}` : "";
    throw new Error(
      `claw-runtime for "${slug}" did not start within 10 s (PID file not found at ${getRuntimePidPath(stateDir)}).${hint}`,
    );
  }

  /**
   * Stop a running claw-runtime daemon for the given slug.
   * Sends SIGTERM and polls until the process exits (up to 8 s).
   */
  private async stopRuntime(slug: string, _stateDir: string): Promise<void> {
    // Always derive stateDir from slug — DB value may be stale after migration.
    const stateDir = getRuntimeStateDir(slug);
    const pid = getRuntimePid(stateDir);
    if (!pid) {
      logger.dim(`[lifecycle] claw-runtime for "${slug}" is not running — nothing to stop`);
      return;
    }

    logger.dim(`[lifecycle] Stopping claw-runtime for "${slug}" (PID ${pid})...`);

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }

    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      if (!isRuntimeRunning(stateDir)) {
        // Clean up stale PID file if still present
        try {
          fs.unlinkSync(getRuntimePidPath(stateDir));
        } catch {
          /* already gone */
        }
        logger.dim(`[lifecycle] claw-runtime stopped (slug: ${slug})`);
        return;
      }
    }

    throw new Error(`claw-runtime for "${slug}" (PID ${pid}) did not stop within 8 s`);
  }
}
