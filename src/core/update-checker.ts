// src/core/update-checker.ts
import type { ServerConnection } from "../server/connection.js";

export interface UpdateStatus {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

export class UpdateChecker {
  constructor(private conn: ServerConnection) {}

  async check(): Promise<UpdateStatus> {
    const [current, latest] = await Promise.allSettled([
      this._getCurrentVersion(),
      this._getLatestVersion(),
    ]);

    const currentVersion = current.status === "fulfilled" ? current.value : null;
    const latestVersion = latest.status === "fulfilled" ? latest.value : null;
    const updateAvailable =
      currentVersion !== null &&
      latestVersion !== null &&
      this._isNewer(latestVersion, currentVersion);

    return { currentVersion, latestVersion, updateAvailable };
  }

  private async _getCurrentVersion(): Promise<string> {
    // openclaw --version est plus fiable que npm list -g car il ne depend pas
    // du prefix npm global ni du PATH de execFile (on utilise exec shell)
    const result = await this.conn.exec("openclaw --version 2>/dev/null", { timeout: 10_000 });
    const version = result.stdout.trim();
    if (!version || result.exitCode !== 0) {
      throw new Error("Could not determine openclaw version");
    }
    return version;
  }

  private async _getLatestVersion(): Promise<string> {
    const res = await fetch("https://registry.npmjs.org/openclaw/latest", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`npm registry error: ${res.status}`);
    const data = (await res.json()) as { version?: string };
    if (!data.version) throw new Error("No version in npm registry response");
    return data.version;
  }

  // Format YYYY.M.D — compare numeriquement segment par segment
  // Gere aussi les pre-releases (ex: 2026.3.1-beta.1) en les ignorant
  _isNewer(candidate: string, current: string): boolean {
    const normalize = (v: string) => v.split("-")[0] ?? v; // strip pre-release suffix
    const parse = (v: string): [number, number, number] => {
      const parts = normalize(v)
        .split(".")
        .map((n) => parseInt(n, 10));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };

    const [cy, cm, cd] = parse(current);
    const [ly, lm, ld] = parse(candidate);

    if (ly !== cy) return ly > cy;
    if (lm !== cm) return lm > cm;
    return ld > cd;
  }
}
