// src/core/destroyer.ts
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { InstanceNotFoundError } from "../lib/errors.js";
import { getSystemdDir } from "../lib/platform.js";

export class Destroyer {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
  ) {}

  async destroy(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    // 1. Stop service
    await this.conn.execFile(
      "systemctl",
      ["--user", "stop", instance.systemd_unit],
      { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
    );

    // 2. Disable service
    await this.conn.execFile(
      "systemctl",
      ["--user", "disable", instance.systemd_unit],
      { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
    );

    // 3. Remove service file
    const serviceFile = path.join(getSystemdDir(), instance.systemd_unit);
    await this.conn.remove(serviceFile);

    // 4. Reload systemd
    await this.conn.execFile("systemctl", ["--user", "daemon-reload"], {
      env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir },
    });

    // 5. Remove state directory
    await this.conn.remove(instance.state_dir, { recursive: true });

    // 6. Release port in registry
    this.registry.releasePort(instance.server_id, instance.port);

    // 7. Delete agents from registry
    this.registry.deleteAgents(instance.id);

    // 8. Delete instance from registry
    this.registry.deleteInstance(slug);

    // 9. Log event
    this.registry.logEvent(slug, "destroyed");
  }
}
