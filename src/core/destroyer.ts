// src/core/destroyer.ts
import * as fs from "node:fs";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import type { PortAllocator } from "./port-allocator.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import {
  getRuntimeStateDir,
  getRuntimePid,
  getRuntimePidPath,
  isRuntimeRunning,
} from "../lib/platform.js";
import { logger } from "../lib/logger.js";

export class Destroyer {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
    private portAllocator?: PortAllocator,
  ) {}

  async destroy(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    // 1. Stop the claw-runtime daemon via SIGTERM (PID file)
    const stateDir = getRuntimeStateDir(slug);
    const pid = getRuntimePid(stateDir);
    if (pid) {
      logger.dim(`[destroyer] Stopping claw-runtime for "${slug}" (PID ${pid})...`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited
      }

      // Poll until stopped (up to 8 s)
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        if (!isRuntimeRunning(stateDir)) break;
      }

      // Clean up stale PID file
      try {
        fs.unlinkSync(getRuntimePidPath(stateDir));
      } catch {
        /* already gone */
      }
    }

    // 2. Remove state directory
    await this.conn.remove(instance.state_dir, { recursive: true });

    // 3. Release port in registry (gateway + sidecar ports P+1, P+2, P+4)
    this.registry.releasePort(instance.server_id, instance.port);
    this.portAllocator?.releaseSidecarPorts(instance.server_id, instance.port);

    // 4. Delete agents from registry
    this.registry.deleteAgents(instance.id);

    // 5. Delete instance from registry
    this.registry.deleteInstance(slug);

    // 6. Log event
    this.registry.logEvent(slug, "destroyed");
  }
}
