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
    const home = process.env["HOME"] ?? "";

    // Absolute candidate paths — checked via conn.exists() to avoid spawning
    // openclaw --version which blocks when there is no TTY (openclaw writes
    // version info directly to the terminal, not to stdout/stderr).
    const absoluteCandidates = [
      `${home}/.npm-global/bin/openclaw`,
      "/opt/openclaw/.npm-global/bin/openclaw",
    ];

    for (const bin of absoluteCandidates) {
      if (await this.conn.exists(bin)) {
        // Read version from package.json (reliable, no TTY needed).
        // bin is e.g. /home/user/.npm-global/bin/openclaw
        // package.json is at   /home/user/.npm-global/lib/node_modules/openclaw/package.json
        const npmGlobalRoot = bin.replace(/\/bin\/openclaw$/, "");
        const pkgPath = `${npmGlobalRoot}/lib/node_modules/openclaw/package.json`;
        let version = "unknown";
        try {
          const raw = await this.conn.readFile(pkgPath);
          const pkg = JSON.parse(raw) as { version?: string };
          if (pkg.version) version = pkg.version;
        } catch {
          // package.json not readable — version stays "unknown", bin is still valid
        }
        return { bin, version };
      }
    }

    // Fallback: resolve via which (works in interactive sessions, may fail in systemd)
    const whichResult = await this.conn.exec(
      `which openclaw 2>/dev/null || command -v openclaw 2>/dev/null || true`,
    );
    const bin = whichResult.stdout.trim();
    if (bin) {
      return { bin, version: "unknown" };
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
    const home = process.env["HOME"] ?? "";
    // Split args string into array — callers always pass simple args (no pipes/redirections)
    const argsArray = args.split(/\s+/).filter(Boolean);
    return this.conn.execFile(
      "openclaw",
      ["--profile", slug, ...argsArray],
      {
        env: {
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: configPath,
          // Extended PATH covering all known npm-global locations
          PATH: `${home}/.npm-global/bin:/opt/openclaw/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
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
