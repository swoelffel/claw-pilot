// src/core/updater.ts
import { randomUUID } from "node:crypto";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import type { Lifecycle } from "./lifecycle.js";
import { logger } from "../lib/logger.js";

export type UpdateJobStatus = "idle" | "running" | "done" | "error";

export interface UpdateJob {
  status: UpdateJobStatus;
  jobId: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  fromVersion?: string;
  toVersion?: string;
}

export class Updater {
  private _job: UpdateJob = { status: "idle", jobId: "" };

  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private lifecycle: Lifecycle,
  ) {}

  getJob(): UpdateJob {
    return { ...this._job };
  }

  // Lance la mise a jour en background (non-bloquant)
  run(fromVersion?: string, toVersion?: string): void {
    if (this._job.status === "running") return;

    const jobId = randomUUID();
    this._job = {
      status: "running",
      jobId,
      startedAt: new Date().toISOString(),
      ...(fromVersion !== undefined && { fromVersion }),
      ...(toVersion !== undefined && { toVersion }),
    };

    this._execute(jobId).catch(() => {
      // Erreurs capturees dans _execute
    });
  }

  private async _execute(jobId: string): Promise<void> {
    logger.info("[updater] Starting openclaw update via npm install -g");

    try {
      // 1. npm install -g openclaw@latest
      // On utilise exec (shell) pour beneficier du PATH systemd qui inclut ~/.npm-global/bin.
      // --omit=optional evite le telechargement de binaires natifs lourds (ffmpeg-static, etc.)
      // timeout 300s : l'install peut prendre 2-3 minutes selon la connexion
      const result = await this.conn.exec(
        "npm install -g openclaw@latest --no-fund --no-audit --omit=optional --loglevel=error 2>&1",
        { timeout: 300_000 },
      );

      if (result.exitCode !== 0) {
        throw new Error(result.stdout.trim() || result.stderr.trim() || "npm install failed");
      }

      logger.info("[updater] npm install done, restarting active instances");

      // 2. Restart toutes les instances actives
      const instances = this.registry.listInstances();
      const running = instances.filter((i) => i.state === "running");

      for (const inst of running) {
        try {
          logger.info(`[updater] Restarting instance: ${inst.slug}`);
          await this.lifecycle.restart(inst.slug);
        } catch (err) {
          // On continue meme si un restart echoue
          logger.info(
            `[updater] Restart failed for ${inst.slug}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const msg = `Updated successfully. ${running.length} instance(s) restarted.`;
      logger.info(`[updater] ${msg}`);

      this._job = {
        ...this._job,
        jobId,
        status: "done",
        finishedAt: new Date().toISOString(),
        message: msg,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.info(`[updater] Update failed: ${msg}`);

      this._job = {
        ...this._job,
        jobId,
        status: "error",
        finishedAt: new Date().toISOString(),
        message: msg,
      };
    }
  }
}
