// src/dashboard/monitor.ts
import type { WebSocket } from "ws";
import type { HealthChecker, HealthStatus } from "../core/health.js";
import { constants } from "../lib/constants.js";

interface WSMessage {
  type: "health_update" | "instance_created" | "instance_destroyed" | "log_line";
  payload: unknown;
}

export class Monitor {
  private interval: NodeJS.Timeout | null = null;
  private clients: Set<WebSocket> = new Set();
  private previousState = "";

  constructor(
    private health: HealthChecker,
    private intervalMs: number = constants.HEALTH_POLL_INTERVAL,
  ) {}

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  start(): void {
    this.interval = setInterval(async () => {
      try {
        const statuses = await this.health.checkAll();
        const msg = {
          type: "health_update" as const,
          payload: { instances: statuses },
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
