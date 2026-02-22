// src/core/openclaw-cli.ts
import type { ServerConnection, ExecResult } from "../server/connection.js";
import { constants } from "../lib/constants.js";

export class OpenClawCLI {
  constructor(private conn: ServerConnection) {}

  /**
   * Install OpenClaw via its official install script.
   * Returns true if installation succeeded (binary detected after install).
   * The install URL can be overridden with the OPENCLAW_INSTALL_URL env var.
   */
  async install(): Promise<boolean> {
    const url =
      process.env["OPENCLAW_INSTALL_URL"] ?? constants.OPENCLAW_INSTALL_URL;
    const result = await this.conn.exec(
      `curl -fsSL ${url} | sh 2>&1`,
    );
    if (result.exitCode !== 0) {
      return false;
    }
    // Verify the binary is now reachable
    const detected = await this.detect();
    return detected !== null;
  }

  /** Detect openclaw binary path and version */
  async detect(): Promise<{ bin: string; version: string } | null> {
    const paths = [
      "openclaw",
      "/opt/openclaw/.npm-global/bin/openclaw",
      `${process.env["HOME"] ?? ""}/.npm-global/bin/openclaw`,
    ];

    for (const bin of paths) {
      const result = await this.conn.exec(
        `${bin} --version 2>/dev/null || true`,
      );
      if (result.exitCode === 0 && result.stdout.trim()) {
        return { bin, version: result.stdout.trim() };
      }
    }
    return null;
  }

  /** Run an openclaw command for a specific instance */
  async run(
    slug: string,
    stateDir: string,
    configPath: string,
    args: string,
  ): Promise<ExecResult> {
    const env = [
      `OPENCLAW_STATE_DIR=${stateDir}`,
      `OPENCLAW_CONFIG_PATH=${configPath}`,
      `PATH=/opt/openclaw/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
    ].join(" ");

    return this.conn.exec(`${env} openclaw --profile ${slug} ${args}`);
  }

  /** Install a plugin for an instance */
  async installPlugin(
    slug: string,
    stateDir: string,
    configPath: string,
    pkg: string,
  ): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, `plugins install ${pkg}`);
  }

  /** Run doctor for an instance */
  async doctor(
    slug: string,
    stateDir: string,
    configPath: string,
  ): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, "doctor");
  }

  /** List devices for an instance */
  async listDevices(
    slug: string,
    stateDir: string,
    configPath: string,
  ): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, "devices list --json");
  }

  /** Approve a device pairing request */
  async approveDevice(
    slug: string,
    stateDir: string,
    configPath: string,
    requestId: string,
  ): Promise<ExecResult> {
    return this.run(
      slug,
      stateDir,
      configPath,
      `devices approve ${requestId}`,
    );
  }
}
