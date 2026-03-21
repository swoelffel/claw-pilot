// src/dashboard/monitor.ts
import type { WebSocket } from "ws";
import type Database from "better-sqlite3";
import type { HealthChecker, HealthStatus } from "../core/health.js";
import { constants } from "../lib/constants.js";
import { getRuntimeStateDir } from "../lib/platform.js";
import { runtimeConfigExists, loadRuntimeConfig } from "../runtime/index.js";

interface WSMessage {
  type: "health_update" | "instance_created" | "instance_destroyed" | "log_line";
  payload: unknown;
}

export class Monitor {
  private interval: NodeJS.Timeout | null = null;
  private clients: Set<WebSocket> = new Set();
  private previousState = "";
  private _transitioning = new Map<string, "starting" | "stopping">();

  /**
   * Optional callback that returns the number of connected MCP clients for a given slug.
   * Injected from outside to avoid a direct dependency on McpRegistry in this module.
   * Returns 0 by default (unchanged behaviour when not configured).
   */
  private _getMcpConnectedCount: (slug: string) => number = () => 0;

  constructor(
    private health: HealthChecker,
    private intervalMs: number = constants.HEALTH_POLL_INTERVAL,
    private db?: Database.Database,
  ) {}

  /**
   * Register a callback for MCP connected count per slug.
   * Should be called by the runtime engine when MCP is initialized for an instance.
   */
  setMcpConnectedCountFn(fn: (slug: string) => number): void {
    this._getMcpConnectedCount = fn;
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  /**
   * Count pending permission rules (action = 'ask') for a given instance slug.
   * Returns 0 if the table does not exist or the query fails.
   */
  private countPendingPermissions(slug: string): number {
    if (!this.db) return 0;
    try {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM rt_permissions
           WHERE instance_slug = ? AND action = 'ask'`,
        )
        .get(slug) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    } catch {
      // Table may not exist on older DBs — degrade gracefully
      return 0;
    }
  }

  /**
   * Count agents with heartbeat enabled for a given instance slug.
   * Returns 0 if runtime config is unavailable.
   */
  private countHeartbeatAgents(slug: string): number {
    try {
      const stateDir = getRuntimeStateDir(slug);
      if (!runtimeConfigExists(stateDir)) return 0;
      const config = loadRuntimeConfig(stateDir);
      return config.agents.filter((a) => a.heartbeat?.every !== undefined).length;
    } catch {
      return 0;
    }
  }

  /**
   * Count heartbeat alerts (sessions with alert keywords) in the last 24h.
   * Returns 0 if the table does not exist or the query fails.
   */
  private countHeartbeatAlerts(slug: string): number {
    if (!this.db) return 0;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = this.db
        .prepare(
          `SELECT COUNT(DISTINCT m.id) AS cnt
           FROM rt_messages m
           JOIN rt_sessions s ON s.id = m.session_id
           JOIN rt_parts p ON p.message_id = m.id AND p.type = 'text'
           WHERE s.instance_slug = ?
             AND s.channel = 'internal'
             AND m.role = 'assistant'
             AND m.created_at > ?
             AND (p.content LIKE '%HEARTBEAT_ALERT%' OR p.content LIKE '%alert%')`,
        )
        .get(slug, since) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Enrich a HealthStatus with pendingPermissions, heartbeat, mcp counts and transitioning state.
   */
  private enrichStatus(status: HealthStatus): HealthStatus {
    const transitioning = this._transitioning.get(status.slug);
    return {
      ...status,
      pendingPermissions: this.countPendingPermissions(status.slug),
      heartbeatAgents: this.countHeartbeatAgents(status.slug),
      heartbeatAlerts: this.countHeartbeatAlerts(status.slug),
      mcpConnected: this._getMcpConnectedCount(status.slug),
      ...(transitioning !== undefined ? { transitioning } : {}),
    };
  }

  /**
   * Set the transitioning state for a slug and broadcast immediately.
   * Called by lifecycle routes before a start/stop operation.
   */
  setTransitioning(slug: string, state: "starting" | "stopping"): void {
    this._transitioning.set(slug, state);
    void this._broadcastNow();
  }

  /**
   * Clear the transitioning state for a slug and broadcast immediately.
   * Called by lifecycle routes in the finally block after a start/stop operation.
   */
  clearTransitioning(slug: string): void {
    this._transitioning.delete(slug);
    void this._broadcastNow();
  }

  /** Trigger an immediate health check and broadcast the result to all connected clients. */
  private async _broadcastNow(): Promise<void> {
    if (this.clients.size === 0) return;
    try {
      const statuses = await this.health.checkAll();
      const enriched = statuses.map((s) => this.enrichStatus(s));
      const msg = { type: "health_update" as const, payload: { instances: enriched } };
      const serialized = JSON.stringify(msg);
      this.previousState = serialized;
      this.broadcast(msg);
    } catch {
      // Expected: health check can fail transiently
    }
  }

  start(): void {
    this.interval = setInterval(async () => {
      // Skip serialisation work when no clients are connected
      if (this.clients.size === 0) return;
      try {
        const statuses = await this.health.checkAll();
        const enriched = statuses.map((s) => this.enrichStatus(s));
        const msg = {
          type: "health_update" as const,
          payload: { instances: enriched },
        };
        const serialized = JSON.stringify(msg);
        // Only broadcast when state actually changed — eliminates ~90% of WS traffic
        if (serialized !== this.previousState) {
          this.previousState = serialized;
          this.broadcast(msg);
        }
      } catch {
        // Expected: health check can fail transiently
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  broadcast(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(json);
      }
    }
  }
}
