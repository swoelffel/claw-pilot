// src/core/openclaw-cli.ts
import type { ServerConnection, ExecResult } from "../server/connection.js";
import { constants } from "../lib/constants.js";
import { shellEscape } from "../lib/shell.js";

export class OpenClawCLI {
  constructor(private conn: ServerConnection) {}

  /**
   * Install OpenClaw via its official install script.
   * Returns true if installation succeeded (binary detected after install).
   * The install URL can be overridden with the OPENCLAW_INSTALL_URL env var.
   * Uses exec() because the command is a shell pipe (curl | sh).
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
    const candidates = [
      "openclaw",
      "/opt/openclaw/.npm-global/bin/openclaw",
      `${process.env["HOME"] ?? ""}/.npm-global/bin/openclaw`,
    ];

    for (const candidate of candidates) {
      // Use execFile for the version check — no shell interpolation needed
      const result = await this.conn.execFile(candidate, ["--version"], {
        timeout: 5_000,
      });
      if (result.exitCode === 0 && result.stdout.trim()) {
        const version = result.stdout.trim();
        // Resolve to absolute path so systemd ExecStart works without PATH lookup.
        // Uses exec() because the resolution uses shell pipes (command -v, readlink).
        const absResult = await this.conn.exec(
          `command -v ${shellEscape(candidate)} 2>/dev/null || readlink -f $(which ${shellEscape(candidate)} 2>/dev/null) 2>/dev/null || echo ${shellEscape(candidate)}`,
        );
        const bin = absResult.stdout.trim() || candidate;
        return { bin, version };
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
    // Split args string into array — callers always pass simple args (no pipes/redirections)
    const argsArray = args.split(/\s+/).filter(Boolean);
    return this.conn.execFile(
      "openclaw",
      ["--profile", slug, ...argsArray],
      {
        env: {
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: configPath,
          PATH: "/opt/openclaw/.npm-global/bin:/usr/local/bin:/usr/bin:/bin",
        },
      },
    );
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
