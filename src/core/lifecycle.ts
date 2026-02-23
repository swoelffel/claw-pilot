// src/core/lifecycle.ts
import type { ServerConnection, ExecResult } from "../server/connection.js";
// ExecResult is used as the return type of the private systemctl() method
import type { Registry } from "./registry.js";
import { InstanceNotFoundError, GatewayUnhealthyError } from "../lib/errors.js";
import { constants } from "../lib/constants.js";
import { pollUntilReady } from "../lib/poll.js";

export class Lifecycle {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
  ) {}

  private systemctl(action: string, unit: string): Promise<ExecResult> {
    return this.conn.execFile("systemctl", ["--user", action, unit], {
      env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir },
    });
  }

  async start(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.systemctl("start", instance.systemd_unit);
    await this.waitForHealth(instance.port, slug, constants.GATEWAY_READY_TIMEOUT);
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "started");
  }

  async stop(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.systemctl("stop", instance.systemd_unit);
    this.registry.updateInstanceState(slug, "stopped");
    this.registry.logEvent(slug, "stopped");
  }

  async restart(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.systemctl("restart", instance.systemd_unit);
    await this.waitForHealth(instance.port, slug, constants.GATEWAY_READY_TIMEOUT);
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "restarted");
  }

  async enable(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);
    await this.systemctl("enable", instance.systemd_unit);
  }

  async daemonReload(): Promise<void> {
    await this.conn.execFile("systemctl", ["--user", "daemon-reload"], {
      env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir },
    });
  }

  private async waitForHealth(
    port: number,
    slug: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      await pollUntilReady({
        check: async () => {
          const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          return res.ok;
        },
        timeoutMs,
        label: `gateway ${slug}:${port}`,
      });
    } catch {
      throw new GatewayUnhealthyError(slug, port);
    }
  }
}
