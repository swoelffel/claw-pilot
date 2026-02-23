// src/core/lifecycle.ts
import type { ServerConnection, ExecResult } from "../server/connection.js";
import type { Registry } from "./registry.js";
import { InstanceNotFoundError, GatewayUnhealthyError } from "../lib/errors.js";

export class Lifecycle {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private xdgRuntimeDir: string,
  ) {}

  private systemctl(action: string, unit: string): Promise<ExecResult> {
    return this.conn.exec(
      `XDG_RUNTIME_DIR=${this.xdgRuntimeDir} systemctl --user ${action} ${unit}`,
    );
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
    await this.conn.exec(
      `XDG_RUNTIME_DIR=${this.xdgRuntimeDir} systemctl --user daemon-reload`,
    );
  }

  private async waitForHealth(
    port: number,
    slug: string,
    timeoutMs: number,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new GatewayUnhealthyError(slug, port);
  }
}
