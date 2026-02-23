// src/core/health.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import { constants } from "../lib/constants.js";
import { shellEscape } from "../lib/shell.js";

export interface HealthStatus {
  slug: string;
  port: number;
  gateway: "healthy" | "unhealthy" | "unknown";
  systemd: "active" | "inactive" | "failed" | "unknown";
  pid?: number;
  uptime?: string;
  agentCount?: number;
  telegram?: "connected" | "disconnected" | "not_configured";
  pairedDevices?: number;
}

export class HealthChecker {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
  ) {}

  async check(slug: string): Promise<HealthStatus> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    const status: HealthStatus = {
      slug,
      port: instance.port,
      gateway: "unknown",
      systemd: "unknown",
    };

    // 1. Systemd status
    const systemdResult = await this.conn.execFile(
      "systemctl",
      ["--user", "is-active", instance.systemd_unit],
      { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
    );
    const systemdState = systemdResult.stdout.trim();
    status.systemd = (
      ["active", "inactive", "failed"].includes(systemdState)
        ? systemdState
        : "unknown"
    ) as HealthStatus["systemd"];

    // 2. Gateway health (HTTP)
    try {
      const res = await fetch(`http://127.0.0.1:${instance.port}/health`, {
        signal: AbortSignal.timeout(constants.HEALTH_CHECK_TIMEOUT),
      });
      status.gateway = res.ok ? "healthy" : "unhealthy";
    } catch {
      status.gateway = "unhealthy";
    }

    // 3. PID and uptime
    if (status.systemd === "active") {
      const [pidResult, uptimeResult] = await Promise.all([
        this.conn.execFile(
          "systemctl",
          ["--user", "show", instance.systemd_unit, "--property=MainPID", "--value"],
          { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
        ),
        this.conn.execFile(
          "systemctl",
          ["--user", "show", instance.systemd_unit, "--property=ActiveEnterTimestamp", "--value"],
          { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
        ),
      ]);
      status.pid =
        parseInt(pidResult.stdout.trim()) || undefined;
      status.uptime = uptimeResult.stdout.trim() || undefined;
    }

    // 4. Agent count
    const agents = this.registry.listAgents(slug);
    status.agentCount = agents.length;

    // 5. Telegram status — check registry field OR openclaw.json channels.telegram.enabled
    let telegramConfigured = !!instance.telegram_bot;
    if (!telegramConfigured) {
      try {
        const raw = await this.conn.readFile(instance.config_path);
        const cfg = JSON.parse(raw) as {
          channels?: { telegram?: { enabled?: boolean } };
        };
        telegramConfigured = cfg.channels?.telegram?.enabled === true;
      } catch {
        // config unreadable — fall through
      }
    }

    if (telegramConfigured) {
      // OpenClaw logs are JSONL in /tmp/openclaw/openclaw-YYYY-MM-DD.log
      // Look for "Telegram: ok" in today's log (last 200 lines is enough)
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const logPath = `/tmp/openclaw/openclaw-${today}.log`;
      const logResult = await this.conn.exec(
        `tail -200 ${shellEscape(logPath)} 2>/dev/null | grep -c "Telegram: ok" || echo 0`,
      );
      const connected = parseInt(logResult.stdout.trim()) > 0;
      status.telegram = connected ? "connected" : "disconnected";
    } else {
      status.telegram = "not_configured";
    }

    // Update registry state
    const newState =
      status.gateway === "healthy"
        ? "running"
        : status.systemd === "inactive"
          ? "stopped"
          : status.systemd === "failed"
            ? "error"
            : "unknown";
    this.registry.updateInstanceState(slug, newState);

    return status;
  }

  async checkAll(): Promise<HealthStatus[]> {
    const instances = this.registry.listInstances();
    return Promise.all(instances.map((i) => this.check(i.slug)));
  }
}
