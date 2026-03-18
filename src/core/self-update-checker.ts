// src/core/self-update-checker.ts
import { createRequire } from "node:module";
import { constants } from "../lib/constants.js";

const require = createRequire(import.meta.url);

export interface SelfUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null; // tag git exact pour checkout, ex: "v0.11.0"
  updateAvailable: boolean;
}

export class SelfUpdateChecker {
  private _currentVersion: string | null = null;
  // Cache le résultat du check GitHub pour éviter les appels répétés (TTL = 5 min)
  private _cachedStatus: SelfUpdateStatus | null = null;
  private _cacheExpiresAt = 0;
  private static readonly _CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  check(): Promise<SelfUpdateStatus> {
    return this._check();
  }

  private async _check(): Promise<SelfUpdateStatus> {
    // Retourner le cache si encore valide (sauf si un job est en cours — pas pertinent ici)
    const now = Date.now();
    if (this._cachedStatus && now < this._cacheExpiresAt) {
      return this._cachedStatus;
    }

    const [currentResult, latestResult] = await Promise.allSettled([
      Promise.resolve(this._getCurrentVersion()),
      this._getLatestRelease(),
    ]);

    const currentVersion = currentResult.status === "fulfilled" ? currentResult.value : "0.0.0";
    const latest = latestResult.status === "fulfilled" ? latestResult.value : null;

    const latestVersion = latest?.version ?? null;
    const latestTag = latest?.tag ?? null;
    const updateAvailable = latestVersion !== null && this._isNewer(latestVersion, currentVersion);

    const result: SelfUpdateStatus = { currentVersion, latestVersion, latestTag, updateAvailable };
    // Mettre en cache seulement si le check GitHub a réussi
    if (latestResult.status === "fulfilled") {
      this._cachedStatus = result;
      this._cacheExpiresAt = Date.now() + SelfUpdateChecker._CACHE_TTL_MS;
    }
    return result;
  }

  /** Invalide le cache (utilisé après un update pour forcer un re-check). */
  invalidateCache(): void {
    this._cachedStatus = null;
    this._cacheExpiresAt = 0;
  }

  private _getCurrentVersion(): string {
    // Utilise le cache pour eviter de relire package.json a chaque appel
    if (this._currentVersion) return this._currentVersion;
    try {
      // Apres bundling, tous les chunks sont dans dist/ — un seul niveau remonte
      // vers la racine du projet (meme pattern que src/index.ts).
      const pkg = require("../package.json") as { version?: string };
      this._currentVersion = pkg.version ?? "0.0.0";
      return this._currentVersion;
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
