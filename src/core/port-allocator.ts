// src/core/port-allocator.ts
import type { Registry } from "./registry.js";
import type { ServerConnection } from "../server/connection.js";
import { PortConflictError } from "../lib/errors.js";

export class PortAllocator {
  constructor(
    private registry: Registry,
    private conn: ServerConnection,
  ) {}

  /** Find the first free port in the configured range */
  async findFreePort(serverId: number): Promise<number> {
    const start = parseInt(
      this.registry.getConfig("port_range_start") ?? "18789",
    );
    const end = parseInt(
      this.registry.getConfig("port_range_end") ?? "18799",
    );
    const usedPorts = new Set(this.registry.getUsedPorts(serverId));

    for (let port = start; port <= end; port++) {
      if (!usedPorts.has(port)) {
        const isFree = await this.isPortFree(port);
        if (isFree) return port;
      }
    }

    throw new PortConflictError(-1);
  }

  /** Check if a specific port is free on the system */
  async isPortFree(port: number): Promise<boolean> {
    // ss -tlnp is Linux-only; fall back to lsof on macOS
    const result = await this.conn.exec(
      `(ss -tlnp 2>/dev/null || lsof -i :${port} -sTCP:LISTEN 2>/dev/null) | grep :${port} || true`,
    );
    return result.stdout.trim() === "";
  }

  /** Verify a specific port is available (not in registry AND free on system) */
  async verifyPort(serverId: number, port: number): Promise<boolean> {
    const usedPorts = new Set(this.registry.getUsedPorts(serverId));
    if (usedPorts.has(port)) return false;
    return this.isPortFree(port);
  }
}
