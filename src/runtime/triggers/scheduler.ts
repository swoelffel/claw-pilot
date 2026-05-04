// src/runtime/triggers/scheduler.ts
//
// In-process cron scheduler for TRIGGER-001.
//
// Loads every `kind='cron' AND enabled=1` row from `rt_flow_triggers` at
// `start()`, schedules each via `croner`, and on every tick:
//   - Skips disabled or deleted triggers (defensive re-read)
//   - Honours the per-trigger concurrency lock (`hasActiveTriggerRun`)
//   - Inserts a `rt_flow_trigger_runs` row with status `pending`
//   - Calls the injected `runtimeStarter` to start the flow run
//   - Updates the run with the resulting `flow_run_id` + status
//   - Touches `last_fired_at`
//   - Emits an audit event (`trigger.fired` / `trigger.failed`)
//
// `runtimeStarter` is dependency-injected so unit tests can stub the flow
// engine without pulling its full graph. The sole concrete wiring lives in
// `src/dashboard/server.ts`.

import { Cron } from "croner";
import type Database from "better-sqlite3";
import {
  createTriggerRun,
  getFlowTrigger,
  hasActiveTriggerRun,
  listFlowTriggers,
  touchTriggerLastFired,
  updateTriggerRun,
  type FlowTriggerRow,
} from "../../core/repositories/flow-trigger-repository.js";
import { emitAudit } from "../../core/audit/emitter.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Starts a flow run and returns its id. Provided by the host (typically
 * wraps `startFlowRun()` in `src/runtime/flow/engine.ts`). Implementations
 * may be sync or async; the scheduler awaits the returned value.
 */
export type RuntimeStarter = (
  instanceSlug: string,
  flowId: number,
  triggerType: "cron" | "webhook",
  triggerDetail: string,
) => number | Promise<number>;

/** Minimal interface a scheduler-internal job must implement. */
export interface ScheduledJob {
  stop(): void;
}

/** Factory that creates a scheduled job. Defaults to `croner`. */
export type CronFactory = (
  expr: string,
  options: { timezone?: string; name: string },
  callback: () => void,
) => ScheduledJob;

export interface TriggerSchedulerOptions {
  db: Database.Database;
  runtimeStarter: RuntimeStarter;
  /**
   * Optional gate: returns the current state of an instance. When the state
   * is anything other than `"running"`, the scheduler aborts the fire early
   * with a clear "instance not running" failure rather than letting the
   * runtime starter blow up with a cryptic `fetch failed`. When omitted,
   * the gate is bypassed (back-compat for tests).
   */
  getInstanceState?: (instanceSlug: string) => string | undefined;
  /** Override cron factory (test-only). Defaults to `croner.Cron`. */
  cronFactory?: CronFactory;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const defaultCronFactory: CronFactory = (expr, options, cb) =>
  new Cron(
    expr,
    {
      ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
      name: options.name,
    },
    cb,
  );

export class TriggerScheduler {
  private readonly db: Database.Database;
  private readonly runtimeStarter: RuntimeStarter;
  private readonly cronFactory: CronFactory;
  private readonly getInstanceState: ((instanceSlug: string) => string | undefined) | undefined;
  private readonly jobs = new Map<number, ScheduledJob>();
  private started = false;

  constructor(options: TriggerSchedulerOptions) {
    this.db = options.db;
    this.runtimeStarter = options.runtimeStarter;
    this.cronFactory = options.cronFactory ?? defaultCronFactory;
    this.getInstanceState = options.getInstanceState;
  }

  /** Load every enabled cron trigger and schedule it. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const rows = listFlowTriggers(this.db, { kind: "cron", enabledOnly: true });
    for (const row of rows) {
      this.scheduleRow(row);
    }
    logger.debug("trigger_scheduler_started", {
      event: "trigger_scheduler_started",
      count: this.jobs.size,
    });
  }

  /** Stop every scheduled job. */
  stop(): void {
    for (const job of this.jobs.values()) {
      try {
        job.stop();
      } catch (err) {
        logger.warn("trigger_scheduler_stop_failed", {
          event: "trigger_scheduler_stop_failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.jobs.clear();
    this.started = false;
  }

  /**
   * Hot-reload a single trigger: stop any existing job, then re-schedule
   * from the current DB row. Removed/disabled/non-cron rows leave no job
   * behind. Safe to call from CRUD route handlers.
   */
  reload(triggerId: number): void {
    const existing = this.jobs.get(triggerId);
    if (existing) {
      try {
        existing.stop();
      } catch (err) {
        logger.warn("trigger_scheduler_reload_stop_failed", {
          event: "trigger_scheduler_reload_stop_failed",
          triggerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.jobs.delete(triggerId);
    }
    const row = getFlowTrigger(this.db, triggerId);
    if (!row) return;
    if (row.kind !== "cron" || row.enabled !== 1) return;
    this.scheduleRow(row);
  }

  /** Number of currently scheduled jobs (test introspection). */
  get size(): number {
    return this.jobs.size;
  }

  /**
   * Manually fire a trigger. Exposed for the "Fire now" UI button and used
   * by the scheduled jobs themselves.
   */
  async fire(triggerId: number): Promise<void> {
    const row = getFlowTrigger(this.db, triggerId);
    if (!row) {
      logger.debug("trigger_fire_missing", { event: "trigger_fire_missing", triggerId });
      return;
    }
    if (row.enabled !== 1) {
      logger.debug("trigger_fire_disabled", { event: "trigger_fire_disabled", triggerId });
      return;
    }

    // Pre-check instance state — fail fast with a clear error rather than
    // letting the runtime starter throw a cryptic `fetch failed` when the
    // daemon for the instance isn't running.
    if (this.getInstanceState !== undefined) {
      const state = this.getInstanceState(row.instance_slug);
      if (state !== "running") {
        const reason = `Instance "${row.instance_slug}" is not running (state: ${state ?? "unknown"})`;
        const failed = createTriggerRun(this.db, {
          triggerId,
          status: "failed",
          payload: JSON.stringify({ kind: "cron", firedAt: new Date().toISOString() }),
        });
        updateTriggerRun(this.db, failed.id, {
          error: reason,
          finishedAt: new Date().toISOString(),
        });
        emitAudit({
          kind: "trigger.failed",
          triggerId,
          flowId: row.flow_id,
          reason,
          source: "cron",
        });
        logger.warn("trigger_fire_instance_not_running", {
          event: "trigger_fire_instance_not_running",
          triggerId,
          instanceSlug: row.instance_slug,
          state,
        });
        return;
      }
    }

    // Concurrency lock — unless explicitly opted out.
    if (row.allow_concurrent !== 1 && hasActiveTriggerRun(this.db, triggerId)) {
      const skipped = createTriggerRun(this.db, {
        triggerId,
        status: "skipped_concurrent",
      });
      updateTriggerRun(this.db, skipped.id, { finishedAt: new Date().toISOString() });
      emitAudit({
        kind: "trigger.failed",
        triggerId,
        flowId: row.flow_id,
        reason: "skipped_concurrent",
        source: "cron",
      });
      return;
    }

    const payload = JSON.stringify({ kind: "cron", firedAt: new Date().toISOString() });
    const run = createTriggerRun(this.db, {
      triggerId,
      status: "pending",
      payload,
    });

    try {
      const flowRunId = await this.runtimeStarter(
        row.instance_slug,
        row.flow_id,
        "cron",
        `trigger:${triggerId}`,
      );
      updateTriggerRun(this.db, run.id, {
        status: "succeeded",
        flowRunId,
        finishedAt: new Date().toISOString(),
      });
      touchTriggerLastFired(this.db, triggerId);
      emitAudit({
        kind: "trigger.fired",
        triggerId,
        flowId: row.flow_id,
        instanceSlug: row.instance_slug,
        source: "cron",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("trigger_fire_failed", {
        event: "trigger_fire_failed",
        triggerId,
        error: reason,
      });
      updateTriggerRun(this.db, run.id, {
        status: "failed",
        error: reason,
        finishedAt: new Date().toISOString(),
      });
      emitAudit({
        kind: "trigger.failed",
        triggerId,
        flowId: row.flow_id,
        reason,
        source: "cron",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private scheduleRow(row: FlowTriggerRow): void {
    if (!row.cron_expr) return;
    try {
      const job = this.cronFactory(
        row.cron_expr,
        {
          ...(row.cron_tz ? { timezone: row.cron_tz } : {}),
          name: `trig-${row.id}`,
        },
        () => {
          void this.fire(row.id).catch((err: unknown) => {
            logger.error("trigger_tick_unhandled", {
              event: "trigger_tick_unhandled",
              triggerId: row.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
      );
      this.jobs.set(row.id, job);
    } catch (err) {
      logger.error("trigger_schedule_failed", {
        event: "trigger_schedule_failed",
        triggerId: row.id,
        cronExpr: row.cron_expr,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
