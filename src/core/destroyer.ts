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

    const xdg = `XDG_RUNTIME_DIR=${this.xdgRuntimeDir}`;

    // 1. Stop service
    await this.conn.exec(
      `${xdg} systemctl --user stop ${instance.systemd_unit} 2>/dev/null || true`,
    );

    // 2. Disable service
    await this.conn.exec(
      `${xdg} systemctl --user disable ${instance.systemd_unit} 2>/dev/null || true`,
    );

    // 3. Remove service file
    const serviceFile = path.join(getSystemdDir(), instance.systemd_unit);
    await this.conn.remove(serviceFile);

    // 4. Reload systemd
    await this.conn.exec(`${xdg} systemctl --user daemon-reload`);

    // 5. Remove state directory
    await this.conn.remove(instance.state_dir, { recursive: true });

    // 6. Remove nginx vhost (if exists)
    if (instance.nginx_domain) {
      const vhostFile = `/etc/nginx/sites-available/${instance.nginx_domain}`;
      const enabledLink = `/etc/nginx/sites-enabled/${instance.nginx_domain}`;
      await this.conn.remove(enabledLink);
      await this.conn.remove(vhostFile);
      await this.conn.exec(
        "sudo nginx -t && sudo systemctl reload nginx 2>/dev/null || true",
      );
    }

    // 7. Release port in registry
    this.registry.releasePort(instance.server_id, instance.port);

    // 8. Delete agents from registry
    this.registry.deleteAgents(instance.id);

    // 9. Delete instance from registry
    this.registry.deleteInstance(slug);

    // 10. Log event
    this.registry.logEvent(slug, "destroyed");
  }
}
