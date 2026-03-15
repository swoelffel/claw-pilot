// src/core/health.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import { getRuntimeStateDir, getRuntimePid } from "../lib/platform.js";

export type InstanceState = "running" | "stopped" | "error" | "unknown";

export interface HealthStatus {
  slug: string;
  port: number;
  /** Derived instance state — single source of truth, computed in HealthChecker.check() */
  state: InstanceState;
  pid?: number;
  agentCount?: number;
  telegram?: "connected" | "disconnected" | "not_configured";
  /** Number of persisted permission rules awaiting a decision (action = 'ask') */
  pendingPermissions?: number;
  /** Number of MCP servers currently connected */
  mcpConnected?: number;
  /** Number of agents with heartbeat enabled */
  heartbeatAgents?: number;
  /** Number of heartbeat alerts in the last 24h */
  heartbeatAlerts?: number;
}

/** Minimal interface for a runtime that exposes channel statuses. */
export interface RuntimeWithChannelStatuses {
  getChannelStatuses(): Record<string, "connected" | "disconnected" | "not_configured">;
}

export class HealthChecker {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
    private getRuntimeForSlug?: (slug: string) => RuntimeWithChannelStatuses | undefined,
  ) {}

  async check(slug: string): Promise<HealthStatus> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    // PID-based health check
    const runtimeStateDir = getRuntimeStateDir(slug);
    const pid = getRuntimePid(runtimeStateDir);
    const state: InstanceState = pid !== null ? "running" : "stopped";

    // Telegram status — lire depuis le runtime en mémoire si disponible
    let telegramStatus: "connected" | "disconnected" | "not_configured" = "not_configured";
    if (this.getRuntimeForSlug) {
      const runtime = this.getRuntimeForSlug(slug);
      if (runtime) {
        telegramStatus = runtime.getChannelStatuses()["telegram"] ?? "not_configured";
      }
    }

    const status: HealthStatus = {
      slug,
      port: instance.port,
      state,
      agentCount: this.registry.listAgents(slug).length,
      telegram: telegramStatus,
      ...(pid !== null ? { pid } : {}),
    };

    this.registry.updateInstanceState(slug, state);
    return status;
  }

  async checkAll(): Promise<HealthStatus[]> {
    const instances = this.registry.listInstances();
    const BATCH_SIZE = 5;
    const results: HealthStatus[] = [];

    for (let i = 0; i < instances.length; i += BATCH_SIZE) {
      const batch = instances.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map((inst) => this.check(inst.slug)));
      results.push(...batchResults);
    }

    return results;
  }
}
