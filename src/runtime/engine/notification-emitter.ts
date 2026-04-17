// src/runtime/engine/notification-emitter.ts
//
// Subscribes to curated bus events and creates persistent notifications.
// Pattern mirrors event-persistence.ts but targets the notifications table
// with deduplication and severity mapping.

import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";
import { getBus } from "../bus/index.js";
import {
  BudgetSoftAlert,
  BudgetHardStop,
  TaskStatusChanged,
  HeartbeatAlert,
  RuntimeError,
  PermissionAsked,
  FlowRunCompleted,
} from "../bus/events.js";
import {
  insertNotification,
  type NotificationRow,
} from "../../core/repositories/notification-repository.js";
import { logger } from "../../lib/logger.js";

/**
 * Wire bus-to-notification bridge for an instance.
 * Subscribes to curated events and creates notifications with deduplication.
 * Returns an unsubscribe function to call on stop().
 */
export function wireNotificationEmitter(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  onNotification?: (notification: NotificationRow) => void,
): () => void {
  const bus = getBus(instanceSlug);
  const unsubs: (() => void)[] = [];

  function emit(
    eventType: string,
    severity: "info" | "warning" | "error" | "success",
    title: string,
    opts?: { body?: string; linkRoute?: string; dedupKey?: string },
  ): void {
    try {
      const row = insertNotification(db, {
        instanceSlug,
        eventType,
        severity,
        title,
        ...(opts?.body !== undefined ? { body: opts.body } : {}),
        ...(opts?.linkRoute !== undefined ? { linkRoute: opts.linkRoute } : {}),
        ...(opts?.dedupKey !== undefined ? { dedupKey: opts.dedupKey } : {}),
      });
      if (row) onNotification?.(row);
    } catch (err) {
      logger.warn("[notification-emitter] insert failed", { error: String(err) });
    }
  }

  // --- Budget events ---

  unsubs.push(
    bus.subscribe(BudgetSoftAlert, (payload) => {
      const label = payload.scopeId ?? instanceSlug;
      emit("budget.soft_alert", "warning", `Budget alert: ${label} at ${payload.pct}%`, {
        linkRoute: `/instances/${instanceSlug}/costs`,
        dedupKey: `budget-soft-${payload.budgetId}`,
      });
    }),
  );

  unsubs.push(
    bus.subscribe(BudgetHardStop, (payload) => {
      const label = payload.scopeId ?? instanceSlug;
      emit("budget.hard_stop", "error", `Budget exceeded: ${label} paused`, {
        linkRoute: `/instances/${instanceSlug}/costs`,
        dedupKey: `budget-hard-${payload.budgetId}`,
      });
    }),
  );

  // --- Task events ---

  unsubs.push(
    bus.subscribe(TaskStatusChanged, (payload) => {
      if (payload.newStatus === "completed") {
        emit("task.status_changed", "success", `Task completed: #${payload.taskId}`, {
          linkRoute: `/instances/${instanceSlug}/tasks`,
        });
      } else if (payload.newStatus === "cancelled") {
        emit("task.status_changed", "error", `Task cancelled: #${payload.taskId}`, {
          linkRoute: `/instances/${instanceSlug}/tasks`,
        });
      }
    }),
  );

  // --- Heartbeat alerts ---

  unsubs.push(
    bus.subscribe(HeartbeatAlert, (payload) => {
      emit("heartbeat.alert", "error", `Heartbeat alert: ${payload.agentId}`, {
        body: payload.text,
        linkRoute: `/instances/${instanceSlug}/heartbeat`,
        dedupKey: `hb-${instanceSlug}-${payload.agentId}`,
      });
    }),
  );

  // --- Runtime errors ---

  unsubs.push(
    bus.subscribe(RuntimeError, (payload) => {
      emit("runtime.error", "error", `Runtime error: ${instanceSlug}`, {
        body: payload.error,
        linkRoute: `/instances/${instanceSlug}/activity`,
        dedupKey: `rt-err-${instanceSlug}`,
      });
    }),
  );

  // --- Permission requests ---

  unsubs.push(
    bus.subscribe(PermissionAsked, (payload) => {
      emit(
        "permission.asked",
        "warning",
        `Permission pending: ${payload.permission} ${payload.pattern}`,
        {
          ...(payload.description !== undefined ? { body: payload.description } : {}),
          linkRoute: `/instances/${instanceSlug}/settings`,
          dedupKey: `perm-${payload.id}`,
        },
      );
    }),
  );

  // --- Flow completion ---

  unsubs.push(
    bus.subscribe(FlowRunCompleted, (payload) => {
      if (payload.status === "failed") {
        emit("flow.run.completed", "error", `Flow failed: run #${payload.runId}`, {
          linkRoute: `/instances/${instanceSlug}/flows`,
        });
      } else if (payload.status === "completed") {
        emit("flow.run.completed", "success", `Flow completed: run #${payload.runId}`, {
          linkRoute: `/instances/${instanceSlug}/flows`,
        });
      }
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
