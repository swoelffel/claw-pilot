// src/core/destroyer.ts
import * as fs from "node:fs";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
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
      } catch (err) {
        logger.debug("[destroyer] SIGTERM failed, process may have already exited", {
          error: String(err),
        });
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
      } catch (err) {
        logger.debug("[destroyer] PID file already removed", { error: String(err) });
      }
    } else {
      // Fallback: no usable PID file. The runtime may still be alive as an orphan
      // (PID file never written, manually deleted, or stateDir already wiped).
      // Scan the process list for a matching `runtime start <slug>` argv and kill,
      // so we never leave a node process behind after a destroy.
      const orphans = await this.findOrphanRuntimePids(slug);
      for (const orphanPid of orphans) {
        logger.warn(`[destroyer] Killing orphan claw-runtime for "${slug}" (PID ${orphanPid})`);
        try {
          process.kill(orphanPid, "SIGTERM");
        } catch (err) {
          logger.debug("[destroyer] SIGTERM on orphan failed", { error: String(err) });
        }
      }
    }

    // 2. Remove state directory
    await this.conn.remove(instance.state_dir, { recursive: true });

    // 3. Release port in registry
    this.registry.releasePort(instance.server_id, instance.port);

    // 4. Delete agents from registry
    this.registry.deleteAgents(instance.id);

    // 5. Delete instance from registry
    this.registry.deleteInstance(slug);

    // 6. Log event
    this.registry.logEvent(slug, "destroyed");
  }

  /**
   * Return PIDs of running processes whose argv contains `runtime start <slug>`
   * as an exact token (followed by end-of-line or whitespace). Used as a
   * last-resort fallback when the PID file is absent or stale.
   */
  private async findOrphanRuntimePids(slug: string): Promise<number[]> {
    try {
      // `ps -A -o pid=,args=` works on both Linux and macOS: header-less
      // output of `<pid> <full command line>` for every process.
      const res = await this.conn.execFile("ps", ["-A", "-o", "pid=,args="]);
      if (res.exitCode !== 0) return [];

      const needle = `runtime start ${slug}`;
      const pids: number[] = [];
      for (const line of res.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = /^(\d+)\s+(.+)$/.exec(trimmed);
        if (!match) continue;
        const pidStr = match[1]!;
        const args = match[2]!;
        const idx = args.indexOf(needle);
        if (idx === -1) continue;
        // Require exact slug boundary: end-of-string or whitespace after.
        const after = args.charAt(idx + needle.length);
        if (after !== "" && after !== " " && after !== "\t") continue;
        const candidate = parseInt(pidStr, 10);
        if (!isNaN(candidate) && candidate > 0 && candidate !== process.pid) {
          pids.push(candidate);
        }
      }
      return pids;
    } catch (err) {
      logger.debug("[destroyer] orphan process scan failed", { error: String(err) });
      return [];
    }
  }
}
