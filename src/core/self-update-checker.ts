// src/core/self-update-checker.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";

export interface SelfUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null; // tag git exact pour checkout, ex: "v0.11.0"
  updateAvailable: boolean;
}

export class SelfUpdateChecker {
  // Cache uniquement le résultat GitHub (latestVersion + latestTag) — pas la version locale.
  // La version locale est relue à chaque check depuis package.json sur disque, de façon
  // à refléter immédiatement un déploiement manuel (sans restart du process).
  private _cachedLatest: { version: string; tag: string } | null = null;
  private _cacheExpiresAt = 0;
  private static readonly _CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  check(): Promise<SelfUpdateStatus> {
    return this._check();
  }

  private async _check(): Promise<SelfUpdateStatus> {
    // La version courante est toujours relue depuis le disque (pas de cache local)
    const currentVersion = this._getCurrentVersion();

    // Le résultat GitHub est mis en cache 5 min pour limiter les appels API
    const now = Date.now();
    let latest = this._cachedLatest && now < this._cacheExpiresAt ? this._cachedLatest : null;

    if (!latest) {
      const latestResult = await this._getLatestRelease().catch(() => null);
      if (latestResult) {
        latest = latestResult;
        this._cachedLatest = latestResult;
        this._cacheExpiresAt = Date.now() + SelfUpdateChecker._CACHE_TTL_MS;
      }
    }

    const latestVersion = latest?.version ?? null;
    const latestTag = latest?.tag ?? null;
    const updateAvailable = latestVersion !== null && this._isNewer(latestVersion, currentVersion);

    return { currentVersion, latestVersion, latestTag, updateAvailable };
  }

  /** Invalide le cache GitHub (forcera un re-check au prochain appel). */
  invalidateCache(): void {
    this._cachedLatest = null;
    this._cacheExpiresAt = 0;
  }

  private _getCurrentVersion(): string {
    try {
      // Lire package.json depuis le disque à chaque appel (pas de cache — le fichier peut
      // changer après un déploiement manuel sans restart du process dashboard).
      // import.meta.url pointe sur le chunk bundlé dans dist/, donc "../package.json" = racine.
      const thisFile = fileURLToPath(import.meta.url);
      const pkgPath = path.resolve(path.dirname(thisFile), "../package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
      return pkg.version ?? "0.0.0";
    } catch (err) {
      logger.debug("[self-update-checker] failed to read package.json", { error: String(err) });
      return "0.0.0";
    }
  }

  private async _getLatestRelease(): Promise<{ version: string; tag: string }> {
    const url = `${constants.GITHUB_API_BASE}/repos/${constants.GITHUB_REPO}/releases/latest`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(constants.SELF_UPDATE_CHECK_TIMEOUT),
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = (await res.json()) as { tag_name?: string };
    const tag = data.tag_name;
    if (!tag) throw new Error("No tag_name in GitHub release response");
    // Strip le prefixe "v" pour la comparaison semver
    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    return { version, tag };
  }

  // Semver MAJOR.MINOR.PATCH comparison with pre-release flavor gating.
  //
  // The "flavor" is the leading alphanumeric token of the pre-release suffix
  // (e.g. "ent" in "0.83.3-ent.7", "beta" in "0.11.0-beta.1"). When `current`
  // carries a flavor — typically because the running build comes from a side
  // channel like the Enterprise Edition fork — we only consider candidates
  // sharing the same flavor as upgrades. Without this gate, an EE build
  // (`0.83.3-ent.7`) would treat the next CE stable tag (`v0.83.4`) as a
  // valid upgrade and prompt the operator with a confusing cross-channel
  // banner. The CE update channel has no awareness of EE releases.
  _isNewer(candidate: string, current: string): boolean {
    const stripV = (v: string): string => (v.startsWith("v") ? v.slice(1) : v);

    const flavor = (v: string): string | null => {
      const dash = v.indexOf("-");
      if (dash === -1) return null;
      const suffix = v.slice(dash + 1);
      return suffix.split(".")[0] ?? null;
    };

    const parseBase = (v: string): [number, number, number] => {
      const base = v.split("-")[0] ?? v;
      const parts = base.split(".").map((n) => parseInt(n, 10));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };

    const cleanCurrent = stripV(current);
    const cleanCandidate = stripV(candidate);

    const currentFlavor = flavor(cleanCurrent);
    if (currentFlavor !== null && flavor(cleanCandidate) !== currentFlavor) {
      return false;
    }

    const [cMaj, cMin, cPat] = parseBase(cleanCurrent);
    const [lMaj, lMin, lPat] = parseBase(cleanCandidate);

    if (lMaj !== cMaj) return lMaj > cMaj;
    if (lMin !== cMin) return lMin > cMin;
    return lPat > cPat;
  }
}
