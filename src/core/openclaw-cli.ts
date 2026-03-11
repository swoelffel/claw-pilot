// src/core/openclaw-cli.ts
import type { ServerConnection, ExecResult } from "../server/connection.js";
import { constants } from "../lib/constants.js";
import { shellEscape } from "../lib/shell.js";
import { isDarwin } from "../lib/platform.js";

export class OpenClawCLI {
  constructor(private conn: ServerConnection) {}

  /**
   * Install OpenClaw via its official install script.
   * Returns true if installation succeeded (binary detected after install).
   * The install URL can be overridden with the OPENCLAW_INSTALL_URL env var.
   * Uses exec() because the command is a shell pipe (curl | sh).
   */
  async install(): Promise<boolean> {
    const url = process.env["OPENCLAW_INSTALL_URL"] ?? constants.OPENCLAW_INSTALL_URL;
    // Validate URL to prevent shell injection via env var override
    if (!url.startsWith("https://")) {
      throw new Error(`OPENCLAW_INSTALL_URL must start with https:// (got: ${url.slice(0, 40)})`);
    }
    const result = await this.conn.exec(`curl -fsSL ${shellEscape(url)} | sh 2>&1`);
    if (result.exitCode !== 0) {
      return false;
    }
    // Verify the binary is now reachable
    const detected = await this.detect();
    return detected !== null;
  }

  /** Detect openclaw binary path and version */
  /**
   * Detect openclaw binary path, version, and home directory.
   *
   * Uses 3 passes in order — stops at the first successful detection:
   *   1. Running process  — reads HOME from /proc/<pid>/environ (Linux only)
   *   2. Systemd services — parses ExecStart in openclaw-*.service files
   *   3. Hardcoded paths  — conventional npm-global locations
   *
   * Returns { bin, version, home } where home is the openclaw user's home
   * directory (e.g. /opt/openclaw), used to locate stateDirs for instances.
   */
  async detect(): Promise<{ bin: string; version: string; home: string } | null> {
    return (
      (await this._detectFromProcess()) ??
      (await this._detectFromService()) ??
      (await this._detectFromPaths())
    );
  }

  /** Derive npm-global root and home from a bin path. */
  private _binInfo(bin: string): { npmGlobalRoot: string; home: string } {
    // bin:          /opt/openclaw/.npm-global/bin/openclaw
    // npmGlobalRoot: /opt/openclaw/.npm-global
    // home:          /opt/openclaw
    const npmGlobalRoot = bin.replace(/\/bin\/openclaw$/, "");
    const home = npmGlobalRoot.replace(/\/\.npm-global$/, "");
    return { npmGlobalRoot, home };
  }

  /** Read openclaw version from package.json (no TTY needed). */
  private async _readVersion(npmGlobalRoot: string): Promise<string> {
    const pkgPath = `${npmGlobalRoot}/lib/node_modules/openclaw/package.json`;
    try {
      const raw = await this.conn.readFile(pkgPath);
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version ?? "unknown";
    } catch {
      // intentionally ignored — package.json unreadable or missing, version is non-critical
      return "unknown";
    }
  }

  /** Build a detection result from a bin path if the file exists. */
  private async _resultFromBin(
    bin: string,
  ): Promise<{ bin: string; version: string; home: string } | null> {
    if (!(await this.conn.exists(bin))) return null;
    const { npmGlobalRoot, home } = this._binInfo(bin);
    const version = await this._readVersion(npmGlobalRoot);
    return { bin, version, home };
  }

  /**
   * Pass 1 — detect from a running openclaw-gateway process.
   * openclaw-gateway renames argv[0] so ps shows no path. Instead we read
   * HOME from /proc/<pid>/environ (Linux only, requires sudo which is a
   * pre-req of the installer).
   */
  private async _detectFromProcess(): Promise<{
    bin: string;
    version: string;
    home: string;
  } | null> {
    if (isDarwin()) return null; // /proc not available on macOS

    const psResult = await this.conn.exec(
      `ps -eo pid,args 2>/dev/null | grep 'openclaw-gateway' | grep -v grep | awk '{print $1}'`,
    );
    const pids = psResult.stdout.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      const envResult = await this.conn.exec(
        `sudo cat /proc/${pid}/environ 2>/dev/null | tr '\\0' '\\n' | grep '^HOME=' | sed 's/^HOME=//' | head -1`,
      );
      const ocHome = envResult.stdout.trim();
      if (!ocHome) continue;
      const bin = `${ocHome}/.npm-global/bin/openclaw`;
      const result = await this._resultFromBin(bin);
      if (result) return result;
    }
    return null;
  }

  /**
   * Pass 2 — detect from systemd user service files (openclaw-*.service).
   * Parses ExecStart to extract the dist/index.js path, derives bin from it.
   * Uses sudo to read files in other users' homes.
   */
  private async _detectFromService(): Promise<{
    bin: string;
    version: string;
    home: string;
  } | null> {
    const findResult = await this.conn.exec(
      `find /home /opt /root -maxdepth 6 -name "openclaw-*.service" 2>/dev/null | head -20`,
    );
    const svcFiles = findResult.stdout.trim().split("\n").filter(Boolean);
    for (const svc of svcFiles) {
      const catResult = await this.conn.exec(
        `sudo cat ${JSON.stringify(svc)} 2>/dev/null | grep 'ExecStart' | sed 's|.* \\(/[^ ]*/node_modules/openclaw/dist/index\\.js\\).*|\\1|' | head -1`,
      );
      const distPath = catResult.stdout.trim();
      if (!distPath || !distPath.includes("node_modules/openclaw")) continue;
      const bin = distPath.replace(
        /\/lib\/node_modules\/openclaw\/dist\/index\.js$/,
        "/bin/openclaw",
      );
      const result = await this._resultFromBin(bin);
      if (result) return result;
    }
    return null;
  }

  /**
   * Pass 3 — hardcoded candidate paths.
   * On Linux, /opt/openclaw/.npm-global/bin/openclaw is checked BEFORE
   * $HOME/.npm-global/bin/openclaw to prefer the dedicated openclaw user.
   */
  private async _detectFromPaths(): Promise<{ bin: string; version: string; home: string } | null> {
    const userHome = process.env["HOME"] ?? "";
    const candidates = isDarwin()
      ? [
          `${userHome}/.npm-global/bin/openclaw`,
          "/opt/homebrew/bin/openclaw",
          "/usr/local/bin/openclaw",
        ]
      : [
          "/opt/openclaw/.npm-global/bin/openclaw",
          `${userHome}/.npm-global/bin/openclaw`,
          "/usr/local/bin/openclaw",
        ];

    for (const bin of candidates) {
      const result = await this._resultFromBin(bin);
      if (result) return result;
    }

    // Last resort: which/command -v
    const whichResult = await this.conn.exec(
      `which openclaw 2>/dev/null || command -v openclaw 2>/dev/null || true`,
    );
    const bin = whichResult.stdout.trim();
    if (bin) {
      const { npmGlobalRoot, home } = this._binInfo(bin);
      const version = await this._readVersion(npmGlobalRoot);
      return { bin, version, home };
    }

    return null;
  }

  /** Run an openclaw command for a specific instance */
  async run(slug: string, stateDir: string, configPath: string, args: string): Promise<ExecResult> {
    const home = process.env["HOME"] ?? "";
    // Split args string into array — callers always pass simple args (no pipes/redirections)
    const argsArray = args.split(/\s+/).filter(Boolean);
    return this.conn.execFile("openclaw", ["--profile", slug, ...argsArray], {
      env: {
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CONFIG_PATH: configPath,
        // Extended PATH covering all known npm-global locations (platform-aware)
        PATH: isDarwin()
          ? `/opt/homebrew/bin:${home}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`
          : `${home}/.npm-global/bin:/opt/openclaw/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    });
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
  async doctor(slug: string, stateDir: string, configPath: string): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, "doctor");
  }

  /** List devices for an instance */
  async listDevices(slug: string, stateDir: string, configPath: string): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, "devices list --json");
  }

  /** Approve a device pairing request */
  async approveDevice(
    slug: string,
    stateDir: string,
    configPath: string,
    requestId: string,
  ): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, `devices approve ${requestId}`);
  }
}
