// src/core/self-update-checker.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { constants } from "../lib/constants.js";

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
    } catch {
      // intentionally ignored — package.json unreadable at runtime, fall back to 0.0.0
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

  // Comparaison semver MAJOR.MINOR.PATCH
  _isNewer(candidate: string, current: string): boolean {
    const parse = (v: string): [number, number, number] => {
      // Strip prefixe "v" et suffixe pre-release
      const clean = v.startsWith("v") ? v.slice(1) : v;
      const base = clean.split("-")[0] ?? clean;
      const parts = base.split(".").map((n) => parseInt(n, 10));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };

    const [cMaj, cMin, cPat] = parse(current);
    const [lMaj, lMin, lPat] = parse(candidate);

    if (lMaj !== cMaj) return lMaj > cMaj;
    if (lMin !== cMin) return lMin > cMin;
    return lPat > cPat;
  }
}
