// src/core/lifecycle.ts
import type { ServerConnection, ExecResult } from "../server/connection.js";
// ExecResult is used as the return type of the private systemctl() method
import type { Registry } from "./registry.js";
import { InstanceNotFoundError, GatewayUnhealthyError } from "../lib/errors.js";
import { constants } from "../lib/constants.js";
import { pollUntilReady } from "../lib/poll.js";
import { getServiceManager, getLaunchdPlistPath, isDocker } from "../lib/platform.js";
import { logger } from "../lib/logger.js";

export class Lifecycle {
  private sm = getServiceManager();

  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
  ) {}

  private systemctl(action: string, unit: string): Promise<ExecResult> {
    return this.conn.execFile("systemctl", ["--user", action, unit], {
      env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir },
    });
  }

  private async launchdLoad(slug: string): Promise<void> {
    const plistPath = getLaunchdPlistPath(slug);
    await this.conn.execFile("launchctl", ["load", "-w", plistPath]);
  }

  private async launchdUnload(slug: string): Promise<void> {
    const plistPath = getLaunchdPlistPath(slug);
    await this.conn.execFile("launchctl", ["unload", plistPath]);
  }

  async start(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    if (isDocker()) {
      // In Docker mode, process management is handled externally (supervisord / manual)
      logger.dim(`[lifecycle] Docker mode — skipping service manager for ${slug}`);
    } else if (this.sm === "launchd") {
      await this.launchdLoad(slug);
    } else {
      await this.systemctl("start", instance.systemd_unit);
    }
    await this.waitForHealth(
      instance.port,
      slug,
      instance.state_dir,
      constants.GATEWAY_READY_TIMEOUT,
    );
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "started");
  }

  async stop(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    if (isDocker()) {
      // In Docker mode, process management is handled externally (supervisord / manual)
      logger.dim(`[lifecycle] Docker mode — skipping service manager for ${slug}`);
    } else if (this.sm === "launchd") {
      await this.launchdUnload(slug);
    } else {
      await this.systemctl("stop", instance.systemd_unit);
    }
    this.registry.updateInstanceState(slug, "stopped");
    this.registry.logEvent(slug, "stopped");
  }

  async restart(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    if (isDocker()) {
      // In Docker mode, process management is handled externally (supervisord / manual)
      logger.dim(`[lifecycle] Docker mode — skipping service manager for ${slug}`);
    } else if (this.sm === "launchd") {
      await this.launchdUnload(slug);
      await this.launchdLoad(slug);
    } else {
      await this.systemctl("restart", instance.systemd_unit);
    }
    await this.waitForHealth(
      instance.port,
      slug,
      instance.state_dir,
      constants.GATEWAY_READY_TIMEOUT,
    );
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "restarted");
  }

  async enable(slug: string): Promise<void> {
    if (isDocker()) {
      // No-op: Docker mode uses supervisord, no service manager needed
      return;
    }
    if (this.sm === "launchd") {
      // No-op: RunAtLoad=true in the plist handles auto-start
      return;
    }
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);
    await this.systemctl("enable", instance.systemd_unit);
  }

  async daemonReload(): Promise<void> {
    if (isDocker()) {
      // No-op: Docker mode uses supervisord, no daemon-reload needed
      return;
    }
    if (this.sm === "launchd") {
      // No-op: launchd does not need daemon-reload
      return;
    }
    await this.conn.execFile("systemctl", ["--user", "daemon-reload"], {
      env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir },
    });
  }

  private async waitForHealth(
    port: number,
    slug: string,
    stateDir: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      await pollUntilReady({
        check: async () => {
          const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          return res.ok;
        },
        timeoutMs,
        label: `gateway ${slug}:${port}`,
      });
    } catch {
      const detail = await this.readGatewayErrorDetail(stateDir);
      throw new GatewayUnhealthyError(slug, port, detail ?? undefined);
    }
  }

  /**
   * Read the last meaningful error line from gateway.err.log (systemd stderr capture).
   * Falls back to gateway.log if err.log is empty or missing.
   * Returns null if no useful detail found.
   */
  private async readGatewayErrorDetail(stateDir: string): Promise<string | null> {
    const candidates = [`${stateDir}/logs/gateway.err.log`, `${stateDir}/logs/gateway.log`];

    // Known error patterns from OpenClaw diagnostics
    const errorPatterns = [
      /gateway start blocked[^.\n]*/i,
      /refusing to bind gateway[^.\n]*/i,
      /gateway auth mode[^.\n]*/i,
      /failed to bind gateway socket[^.\n]*/i,
      /error[^.\n]*/i,
    ];

    for (const logPath of candidates) {
      try {
        const content = await this.conn.readFile(logPath);
        const lines = content.split("\n").filter((l) => l.trim());
        // Scan from the end for a known error pattern
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
          const line = lines[i]!;
          for (const pattern of errorPatterns) {
            const match = line.match(pattern);
            if (match) {
              // Strip JSONL timestamp prefix if present, return clean message
              const clean = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.+Z]+\s+/, "").trim();
              logger.dim(`[lifecycle] gateway error detail: ${clean}`);
              return clean;
            }
          }
        }
      } catch {
        // Log file missing or unreadable — try next
      }
    }
    return null;
  }
}
