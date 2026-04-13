// src/core/self-updater.ts
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import type { Lifecycle } from "./lifecycle.js";
import type { Registry } from "./registry.js";
import { constants } from "../lib/constants.js";
import { DASHBOARD_SERVICE_UNIT } from "../lib/platform.js";
import { logger } from "../lib/logger.js";

export type SelfUpdateJobStatus = "idle" | "running" | "done" | "error";

export interface SelfUpdateJob {
  status: SelfUpdateJobStatus;
  jobId: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  fromVersion?: string;
  toVersion?: string;
}

export class SelfUpdater {
  private _job: SelfUpdateJob = { status: "idle", jobId: "" };

  constructor(
    private conn: ServerConnection,
    private lifecycle?: Lifecycle,
    private registry?: Registry,
  ) {}

  getJob(): SelfUpdateJob {
    return { ...this._job };
  }

  // Lance la mise a jour en background (non-bloquant)
  run(fromVersion?: string, toVersion?: string, tag?: string): void {
    if (this._job.status === "running") return;

    const jobId = randomUUID();
    this._job = {
      status: "running",
      jobId,
      startedAt: new Date().toISOString(),
      ...(fromVersion !== undefined && { fromVersion }),
      ...(toVersion !== undefined && { toVersion }),
    };

    this._execute(jobId, tag).catch(() => {
      // Erreurs capturees dans _execute
    });
  }

  // PATH etendu pour les sessions non-interactives (nvm, pnpm, node)
  // Use the current Node.js bin dir so the update works regardless of nvm version or volta.
  private static readonly _PATH = [
    path.dirname(process.execPath), // current Node.js bin dir (works with nvm, volta, etc.)
    "~/.local/bin", // corepack install dir (pnpm via corepack enable --install-directory)
    "~/.local/share/pnpm", // pnpm setup dir (official install script)
    "~/.npm-global/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");

  private _exec(cmd: string, opts?: { timeout?: number }) {
    return this.conn.exec(`export PATH="${SelfUpdater._PATH}:$PATH" && ${cmd}`, opts);
  }

  private async _execute(jobId: string, tag?: string): Promise<void> {
    const installDir = this._resolveInstallDir();
    const targetRef = tag ?? "main";

    logger.info(`[self-updater] Starting claw-pilot update to ${targetRef} in ${installDir}`);

    try {
      // 1. git fetch (--force so moved/recreated tags don't cause "would clobber" errors)
      const fetch = await this._exec(`git -C "${installDir}" fetch --tags --force --prune`, {
        timeout: 60_000,
      });
      if (fetch.exitCode !== 0) {
        throw new Error(fetch.stderr.trim() || fetch.stdout.trim() || "git fetch failed");
      }

      // 2. git checkout tag
      const checkout = await this._exec(`git -C "${installDir}" checkout "${targetRef}"`, {
        timeout: 30_000,
      });
      if (checkout.exitCode !== 0) {
        throw new Error(checkout.stderr.trim() || checkout.stdout.trim() || "git checkout failed");
      }

      // 2b. Bootstrap the pnpm version pinned in package.json's `packageManager` field
      // via corepack. This ensures pnpm version switches across releases never leave
      // the host stuck on the old binary trying to read a newer lockfile format.
      // Non-fatal — older releases without the field, or hosts without corepack, are skipped.
      await this._bootstrapPackageManager(installDir);

      // 3. pnpm install — use sudo if node_modules/ is not writable by current user
      const nmDir = `${installDir}/node_modules`;
      const nmWriteCheck = await this._exec(`test -w "${nmDir}" || test ! -e "${nmDir}"`);
      const nmNeedsSudo = nmWriteCheck.exitCode !== 0;
      const installCmd = nmNeedsSudo
        ? `sudo -E env PATH="$PATH" pnpm --dir "${installDir}" install --frozen-lockfile`
        : `pnpm --dir "${installDir}" install --frozen-lockfile`;
      if (nmNeedsSudo) {
        logger.info(`[self-updater] node_modules/ not writable, retrying install with sudo`);
      }
      const install = await this._exec(installCmd, { timeout: 180_000 });
      if (install.exitCode !== 0) {
        throw new Error(install.stderr.trim() || install.stdout.trim() || "pnpm install failed");
      }

      // 4. pnpm build — use sudo if dist/ is not writable by current user
      const distDir = `${installDir}/dist`;
      const writeCheck = await this._exec(`test -w "${distDir}" || test ! -e "${distDir}"`);
      const needsSudo = writeCheck.exitCode !== 0;
      const buildCmd = needsSudo
        ? `sudo -E env PATH="$PATH" pnpm --dir "${installDir}" build`
        : `pnpm --dir "${installDir}" build`;
      if (needsSudo) {
        logger.info(`[self-updater] dist/ not writable, retrying build with sudo`);
      }
      const build = await this._exec(buildCmd, { timeout: constants.SELF_UPDATE_TIMEOUT });
      if (build.exitCode !== 0) {
        throw new Error(build.stderr.trim() || build.stdout.trim() || "pnpm build failed");
      }

      // 5. Restart running runtimes so they pick up the new code
      const runtimeSummary = await this._restartRuntimes();

      const msg = `Updated successfully to ${targetRef}. ${runtimeSummary} Restarting dashboard service…`;
      logger.info(`[self-updater] ${msg}`);

      this._job = {
        ...this._job,
        jobId,
        status: "done",
        finishedAt: new Date().toISOString(),
        message: msg,
      };

      // 5. Restart du service — tue le process en cours, donc en dernier.
      // On ne verifie pas le code de retour : le process sera tue avant.
      // Both macOS and Linux use a detached subprocess (nohup + &) because the
      // restart kills the current process before the command can return.
      let restartCmd: string;
      if (process.platform === "darwin") {
        restartCmd = `nohup sh -c 'sleep 3 && launchctl start io.claw-pilot.dashboard' >/dev/null 2>&1 & launchctl stop io.claw-pilot.dashboard`;
      } else {
        // Detect system service (/etc/systemd/system/) vs user service (~/.config/systemd/user/)
        const sysCheck = await this._exec(`test -f /etc/systemd/system/${DASHBOARD_SERVICE_UNIT}`);
        if (sysCheck.exitCode === 0) {
          // System service — requires sudo; detach so the restart outlives this process
          restartCmd = `nohup sh -c 'sleep 2 && sudo systemctl restart ${DASHBOARD_SERVICE_UNIT}' >/dev/null 2>&1 &`;
        } else {
          // User service fallback
          restartCmd = `systemctl --user restart ${DASHBOARD_SERVICE_UNIT}`;
        }
      }
      this._exec(restartCmd, { timeout: 15_000 }).catch(() => {
        // Attendu : le process est tue par le restart
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.info(`[self-updater] Update failed: ${msg}`);

      this._job = {
        ...this._job,
        jobId,
        status: "error",
        finishedAt: new Date().toISOString(),
        message: msg,
      };
    }
  }

  /** Restart all running runtime instances so they pick up the new code. */
  private async _restartRuntimes(): Promise<string> {
    if (!this.lifecycle || !this.registry) {
      return "Runtime restart skipped (CLI mode).";
    }

    const instances = this.registry.listInstances();
    const running = instances.filter((i) => i.state === "running");
    if (running.length === 0) return "No running runtimes to restart.";

    let ok = 0;
    for (const inst of running) {
      try {
        await this.lifecycle.restart(inst.slug);
        ok++;
        logger.info(`[self-updater] Restarted runtime "${inst.slug}"`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.info(`[self-updater] Failed to restart runtime "${inst.slug}": ${errMsg}`);
      }
    }

    const total = running.length;
    if (ok === total) return `Restarted ${total} runtime(s).`;
    return `Restarted ${ok}/${total} runtime(s). ${total - ok} failed.`;
  }

  /**
   * Read `packageManager` from `<installDir>/package.json` and, if it pins a pnpm
   * version, run `corepack prepare <value> --activate` so the next `pnpm install`
   * uses the correct binary. Silent no-op when the field is missing, points to
   * another package manager, or the file cannot be read.
   *
   * Failure of `corepack prepare` itself is logged as a warning but does NOT
   * abort the update — the subsequent `pnpm install` may still succeed if the
   * existing pnpm binary can read the new lockfile.
   */
  private async _bootstrapPackageManager(installDir: string): Promise<void> {
    let pmField: string | undefined;
    try {
      const pkgJsonPath = path.join(installDir, "package.json");
      const raw = await this.conn.readFile(pkgJsonPath);
      const parsed = JSON.parse(raw) as { packageManager?: string };
      pmField = parsed.packageManager;
    } catch (err) {
      logger.debug("[self-updater] cannot read package.json for bootstrap, skipping", {
        error: String(err),
      });
      return;
    }

    if (!pmField || !pmField.startsWith("pnpm@")) {
      logger.debug("[self-updater] no pnpm packageManager field, skipping corepack bootstrap");
      return;
    }

    logger.info(`[self-updater] Bootstrapping ${pmField} via corepack...`);
    const res = await this._exec(`corepack prepare ${pmField} --activate`, { timeout: 60_000 });
    if (res.exitCode !== 0) {
      logger.warn(
        `[self-updater] corepack prepare failed (continuing): ${res.stderr.trim() || res.stdout.trim() || "unknown error"}`,
      );
    }
  }

  // Remonte depuis dist/index.mjs → racine du projet (ou /opt/claw-pilot en fallback)
  _resolveInstallDir(): string {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      // dist/server-*.mjs ou dist/index.mjs → parent = dist/ → parent = racine
      const distDir = path.dirname(thisFile);
      const candidate = path.resolve(distDir, "..");
      return candidate;
    } catch (err) {
      logger.debug("[self-updater] failed to resolve install dir from import.meta.url", {
        error: String(err),
      });
      return "/opt/claw-pilot";
    }
  }
}
