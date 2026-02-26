// src/core/pairing.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { constants } from "../lib/constants.js";
import { InstanceNotFoundError, ClawPilotError } from "../lib/errors.js";
import { shellEscape } from "../lib/shell.js";

export class PairingManager {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  /**
   * Bootstrap device pairing for a new instance (trap 2 from CDC).
   * Triggers a pairing request by connecting to the gateway, then auto-approves.
   */
  async bootstrapDevicePairing(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    // Step 1: Trigger a pairing request by attempting an HTTP connection
    try {
      await fetch(`http://127.0.0.1:${instance.port}/`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Expected: connection rejected or 1008, pairing request is now pending
    }

    // Step 2: List pending device requests
    const listResult = await this.conn.execFile(
      "openclaw",
      ["--profile", slug, "devices", "list", "--json"],
      { env: this.getOpenClawEnvObj(instance) },
    );

    // Step 3: Parse the pending request ID
    const requestId = this.parsePendingRequestId(listResult.stdout);
    if (!requestId) {
      throw new ClawPilotError(
        `No pending pairing request found for "${slug}"`,
        "PAIRING_NO_REQUEST",
      );
    }

    // Step 4: Approve the request
    const approveResult = await this.conn.execFile(
      "openclaw",
      ["--profile", slug, "devices", "approve", requestId],
      { env: this.getOpenClawEnvObj(instance) },
    );
    if (approveResult.exitCode !== 0) {
      throw new ClawPilotError(
        `Failed to approve pairing: ${approveResult.stderr}`,
        "PAIRING_APPROVE_FAILED",
      );
    }
  }

  /**
   * Guide Telegram pairing (trap 3).
   * Watches gateway logs for the pairing code, then auto-approves.
   */
  async waitForTelegramPairing(
    slug: string,
    timeoutMs: number = constants.PAIRING_DETECT_TIMEOUT,
  ): Promise<string> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    const logPath = `${instance.state_dir}/logs/gateway.log`;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      // Uses exec() because the command uses a shell pipe (tail | grep)
      const result = await this.conn.exec(
        `tail -20 ${shellEscape(logPath)} 2>/dev/null | grep "pairing.*telegram" || true`,
      );

      const code = this.parseTelegramPairingCode(result.stdout);
      if (code) {
        await this.conn.execFile(
          "openclaw",
          ["--profile", slug, "pairing", "approve", "telegram", code],
          { env: this.getOpenClawEnvObj(instance) },
        );
        return code;
      }

      await new Promise((r) => setTimeout(r, 2_000));
    }

    throw new ClawPilotError(
      "Telegram pairing code not detected within timeout",
      "TELEGRAM_PAIRING_TIMEOUT",
    );
  }

  private getOpenClawEnvObj(instance: InstanceRecord): Record<string, string> {
    return {
      OPENCLAW_STATE_DIR: instance.state_dir,
      OPENCLAW_CONFIG_PATH: instance.config_path,
    };
  }

  private parsePendingRequestId(output: string): string | null {
    try {
      const data = JSON.parse(output) as Array<{
        id?: string;
        status?: string;
      }>;
      const pending = data.find?.((d) => d.status === "pending");
      return pending?.id ?? null;
    } catch {
      // Not valid JSON — fall through to regex fallback
      const match = output.match(/id[:\s]+(\S+).*pending/i);
      return match?.[1] ?? null;
    }
  }

  private parseTelegramPairingCode(output: string): string | null {
    const match = output.match(/code[:\s]+([A-Z0-9]{8})/i);
    return match?.[1] ?? null;
  }
}
