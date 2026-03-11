// src/core/port-allocator.ts
import type { Registry } from "./registry.js";
import type { ServerConnection } from "../server/connection.js";
import { PortConflictError } from "../lib/errors.js";

/**
 * Sidecar port offsets reserved by OpenClaw 2026.3.x per instance.
 * P+1 = internal bridge, P+2 = browser control server, P+4 = canvas host.
 * P+3 is intentionally not reserved.
 */
const SIDECAR_OFFSETS = [1, 2, 4] as const;

/**
 * Minimum step between allocated gateway ports.
 * Must be > max(SIDECAR_OFFSETS) = 4, so 5 gives one free port between instances.
 */
const PORT_STEP = 5;

export class PortAllocator {
  constructor(
    private registry: Registry,
    private conn: ServerConnection,
  ) {}

  /** Find the first free port block in the configured range */
  async findFreePort(serverId: number): Promise<number> {
    const start = parseInt(this.registry.getConfig("port_range_start") ?? "18789");
    const end = parseInt(this.registry.getConfig("port_range_end") ?? "18838");
    const usedPorts = new Set(this.registry.getUsedPorts(serverId));

    for (let port = start; port <= end; port += PORT_STEP) {
      if (!usedPorts.has(port)) {
        const allFree = await this.arePortsFree(port);
        if (allFree) return port;
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

  /**
   * Check that the gateway port AND all sidecar ports (P+1, P+2, P+4) are free.
   * OpenClaw 2026.3.x reserves these automatically on startup.
   */
  async arePortsFree(port: number): Promise<boolean> {
    for (const offset of [0, ...SIDECAR_OFFSETS]) {
      if (!(await this.isPortFree(port + offset))) return false;
    }
    return true;
  }

  /**
   * Reserve sidecar ports (P+1, P+2, P+4) in the ports table.
   * Call this immediately after allocating the gateway port.
   */
  reserveSidecarPorts(serverId: number, port: number, instanceSlug: string): void {
    for (const offset of SIDECAR_OFFSETS) {
      this.registry.allocatePort(serverId, port + offset, `sidecar:${instanceSlug}`);
    }
  }

  /**
   * Release sidecar ports (P+1, P+2, P+4) from the ports table.
   * Call this when destroying an instance.
   */
  releaseSidecarPorts(serverId: number, port: number): void {
    for (const offset of SIDECAR_OFFSETS) {
      this.registry.releasePort(serverId, port + offset);
    }
  }

  /** Verify a specific port is available (not in registry AND all sidecar ports free on system) */
  async verifyPort(serverId: number, port: number): Promise<boolean> {
    const usedPorts = new Set(this.registry.getUsedPorts(serverId));
    if (usedPorts.has(port)) return false;
    return this.arePortsFree(port);
  }
}
