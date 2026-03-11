// src/core/self-updater.ts
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { ServerConnection } from "../server/connection.js";
import { constants } from "../lib/constants.js";
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

  constructor(private conn: ServerConnection) {}

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
      fromVersion,
      toVersion,
    };

    this._execute(jobId, tag).catch(() => {
      // Erreurs capturees dans _execute
    });
  }

  // PATH etendu pour les sessions non-interactives (nvm, pnpm, node)
  private static readonly _PATH =
    "~/.nvm/versions/node/v24.14.0/bin:~/.npm-global/bin:/usr/local/bin:/usr/bin:/bin";

  private _exec(cmd: string, opts?: { timeout?: number }) {
    return this.conn.exec(
      `export PATH="${SelfUpdater._PATH}:$PATH" && ${cmd}`,
      opts,
    );
  }

  private async _execute(jobId: string, tag?: string): Promise<void> {
    const installDir = this._resolveInstallDir();
    const targetRef = tag ?? "main";

    logger.info(`[self-updater] Starting claw-pilot update to ${targetRef} in ${installDir}`);

    try {
      // 1. git fetch
      const fetch = await this._exec(
        `git -C "${installDir}" fetch --tags --prune`,
        { timeout: 60_000 },
      );
      if (fetch.exitCode !== 0) {
        throw new Error(fetch.stderr.trim() || fetch.stdout.trim() || "git fetch failed");
      }

      // 2. git checkout tag
      const checkout = await this._exec(
        `git -C "${installDir}" checkout "${targetRef}"`,
        { timeout: 30_000 },
      );
      if (checkout.exitCode !== 0) {
        throw new Error(checkout.stderr.trim() || checkout.stdout.trim() || "git checkout failed");
      }

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

      const msg = `Updated successfully to ${targetRef}. Restarting dashboard service…`;
      logger.info(`[self-updater] ${msg}`);

      this._job = {
        ...this._job,
        jobId,
        status: "done",
        finishedAt: new Date().toISOString(),
        message: msg,
      };

      // 5. systemctl restart — tue le process en cours, donc en dernier
      // On ne verifie pas le code de retour : le process sera tue avant
      this._exec(
        "systemctl --user restart claw-pilot-dashboard.service",
        { timeout: 10_000 },
      ).catch(() => {
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

  // Remonte depuis dist/index.mjs → racine du projet (ou /opt/claw-pilot en fallback)
  _resolveInstallDir(): string {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      // dist/server-*.mjs ou dist/index.mjs → parent = dist/ → parent = racine
      const distDir = path.dirname(thisFile);
      const candidate = path.resolve(distDir, "..");
      return candidate;
    } catch {
      return "/opt/claw-pilot";
    }
  }
}
