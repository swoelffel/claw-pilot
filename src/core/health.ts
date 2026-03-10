// src/core/health.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import { constants } from "../lib/constants.js";
import { shellEscape } from "../lib/shell.js";
import { getServiceManager, getLaunchdLabel } from "../lib/platform.js";

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
  pendingDevices?: number;
}

export class HealthChecker {
  private readonly _sm = getServiceManager();

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
      agentCount: 0,
      pendingDevices: 0,
    };

    // 1. Service status (systemd or launchd)
    if (this._sm === "systemd") {
      const systemdResult = await this.conn.execFile(
        "systemctl",
        ["--user", "is-active", instance.systemd_unit],
        { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
      );
      const s = systemdResult.stdout.trim();
      status.systemd = (["active", "inactive", "failed"].includes(s) ? s : "unknown") as typeof status.systemd;
    } else {
      // launchd: launchctl list <label> — exit 0 = running
      const result = await this.conn.execFile("launchctl", ["list", getLaunchdLabel(slug)]);
      status.systemd = result.exitCode === 0 ? "active" : "inactive";
    }

    // 2. Gateway health (HTTP)
    try {
      const res = await fetch(`http://127.0.0.1:${instance.port}/health`, {
        signal: AbortSignal.timeout(constants.HEALTH_CHECK_TIMEOUT),
      });
      status.gateway = res.ok ? "healthy" : "unhealthy";
    } catch {
      status.gateway = "unhealthy";
    }

    // 3. PID and uptime (systemd only — launchd does not expose these easily)
    if (this._sm === "systemd" && status.systemd === "active") {
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
      const logPath = path.join(constants.OPENCLAW_LOG_DIR, `openclaw-${today}.log`);
      const logResult = await this.conn.exec(
        `tail -200 ${shellEscape(logPath)} 2>/dev/null | grep -c "Telegram: ok" || echo 0`,
      );
      const connected = parseInt(logResult.stdout.trim()) > 0;
      status.telegram = connected ? "connected" : "disconnected";
    } else {
      status.telegram = "not_configured";
    }

    // 6. Pending device count (best-effort — non-fatal)
    // pending.json can be an array OR an object keyed by requestId — handle both
    try {
      const pendingPath = `${instance.state_dir}/devices/pending.json`;
      const raw = await this.conn.readFile(pendingPath);
      const parsed = JSON.parse(raw) as Array<unknown> | Record<string, unknown>;
      const pending = Array.isArray(parsed) ? parsed : Object.values(parsed);
      status.pendingDevices = pending.length;
    } catch {
      status.pendingDevices = 0;
    }

    // Update registry state
    // "error" only when systemd reports active but gateway is unreachable (process stuck/zombie).
    // A "failed" or "inactive" systemd unit with no responding gateway means the instance is
    // simply stopped — systemd retains "failed" state after a crash even when the process is gone.
    const newState =
      status.gateway === "healthy"
        ? "running"
        : status.systemd === "active"
          ? "error"
          : "stopped";
    this.registry.updateInstanceState(slug, newState);

    return status;
  }

  async checkAll(): Promise<HealthStatus[]> {
    const instances = this.registry.listInstances();
    const BATCH_SIZE = 5;
    const results: HealthStatus[] = [];

    for (let i = 0; i < instances.length; i += BATCH_SIZE) {
      const batch = instances.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((inst) => this.check(inst.slug)),
      );
      results.push(...batchResults);
    }

    return results;
  }
}
