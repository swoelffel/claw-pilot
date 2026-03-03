// src/core/device-manager.ts
//
// Reads device files and wraps openclaw devices approve/revoke commands.
// Always uses ServerConnection — never child_process or fs directly.

import type { ServerConnection } from "../server/connection.js";
import type { DeviceList, PendingDevice, PairedDevice } from "./devices.js";

const PATH_PREFIX = "export PATH=~/.npm-global/bin:/usr/local/bin:/usr/bin:/bin";

export class DeviceManager {
  constructor(private conn: ServerConnection) {}

  /**
   * Read pending.json + paired.json from stateDir.
   * Returns empty lists if files don't exist.
   */
  async list(stateDir: string): Promise<DeviceList> {
    const pendingPath = `${stateDir}/devices/pending.json`;
    const pairedPath = `${stateDir}/devices/paired.json`;

    let pending: PendingDevice[] = [];
    let paired: PairedDevice[] = [];

    try {
      const raw = await this.conn.readFile(pendingPath);
      pending = JSON.parse(raw) as PendingDevice[];
    } catch {
      // File doesn't exist or is unreadable — return empty list
    }

    try {
      const raw = await this.conn.readFile(pairedPath);
      paired = JSON.parse(raw) as PairedDevice[];
    } catch {
      // File doesn't exist or is unreadable — return empty list
    }

    return { pending, paired };
  }

  /** Approve a pending device request via `openclaw devices approve <requestId>` */
  async approve(stateDir: string, requestId: string): Promise<void> {
    const result = await this.conn.exec(
      `${PATH_PREFIX} && OPENCLAW_STATE_DIR=${stateDir} openclaw devices approve ${requestId}`,
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "approve failed");
    }
  }

  /** Revoke a paired device via `openclaw devices revoke <deviceId>` */
  async revoke(stateDir: string, deviceId: string): Promise<void> {
    const result = await this.conn.exec(
      `${PATH_PREFIX} && OPENCLAW_STATE_DIR=${stateDir} openclaw devices revoke ${deviceId}`,
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "revoke failed");
    }
  }
}
