// src/runtime/engine/__tests__/notification-emitter.test.ts
//
// Tests for bus → notifications emitter wiring.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { getBus, disposeBus } from "../../bus/index.js";
import {
  BudgetSoftAlert,
  BudgetHardStop,
  TaskStatusChanged,
  HeartbeatAlert,
  RuntimeError,
  PermissionAsked,
  FlowRunCompleted,
} from "../../bus/events.js";
import { wireNotificationEmitter } from "../notification-emitter.js";
import {
  listNotifications,
  countUnread,
} from "../../../core/repositories/notification-repository.js";
import type { InstanceSlug } from "../../types.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
const SLUG = "test-inst" as InstanceSlug;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-notif-emit-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("wireNotificationEmitter", () => {
  it("creates a notification on budget.soft_alert", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(BudgetSoftAlert, {
      instanceSlug: SLUG,
      budgetId: 1,
      scope: "agent",
      scopeId: "pilot",
      spentUsd: 8,
      limitUsd: 10,
      pct: 80,
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("warning");
    expect(page.notifications[0]!.title).toContain("pilot");
    expect(page.notifications[0]!.title).toContain("80%");
    expect(page.notifications[0]!.link_route).toBe("/instances/test-inst/costs");

    unsub();
  });

  it("creates a notification on budget.hard_stop", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(BudgetHardStop, {
      instanceSlug: SLUG,
      budgetId: 2,
      scope: "instance",
      scopeId: null,
      spentUsd: 10,
      limitUsd: 10,
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("error");
    expect(page.notifications[0]!.title).toContain("exceeded");

    unsub();
  });

  it("creates a success notification on task completed", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(TaskStatusChanged, {
      instanceSlug: SLUG,
      taskId: 42,
      oldStatus: "in_progress",
      newStatus: "completed",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("success");
    expect(page.notifications[0]!.title).toContain("#42");

    unsub();
  });

  it("creates an error notification on task cancelled", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(TaskStatusChanged, {
      instanceSlug: SLUG,
      taskId: 7,
      oldStatus: "in_progress",
      newStatus: "cancelled",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("error");
    expect(page.notifications[0]!.title).toContain("cancelled");

    unsub();
  });

  it("ignores non-terminal task status changes", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(TaskStatusChanged, {
      instanceSlug: SLUG,
      taskId: 1,
      oldStatus: "pending",
      newStatus: "in_progress",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(0);

    unsub();
  });

  it("creates a notification on heartbeat.alert with dedup", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(HeartbeatAlert, {
      agentId: "pilot" as string,
      instanceSlug: SLUG,
      text: "Agent unresponsive",
    });

    // Second alert for same agent should be deduplicated
    bus.publish(HeartbeatAlert, {
      agentId: "pilot" as string,
      instanceSlug: SLUG,
      text: "Still unresponsive",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("error");
    expect(page.notifications[0]!.dedup_key).toBe("hb-test-inst-pilot");

    unsub();
  });

  it("creates a notification on runtime.error", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(RuntimeError, {
      slug: SLUG,
      error: "Segmentation fault",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("error");
    expect(page.notifications[0]!.body).toBe("Segmentation fault");

    unsub();
  });

  it("creates a notification on permission.asked", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(PermissionAsked, {
      id: "perm-123",
      sessionId: "s-1" as string,
      permission: "shell",
      pattern: "rm -rf *",
      description: "Agent wants to delete files",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.severity).toBe("warning");
    expect(page.notifications[0]!.title).toContain("shell");

    unsub();
  });

  it("creates notifications for flow completion", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(FlowRunCompleted, {
      instanceSlug: SLUG,
      runId: 10,
      flowId: 1,
      status: "completed",
    });

    bus.publish(FlowRunCompleted, {
      instanceSlug: SLUG,
      runId: 11,
      flowId: 1,
      status: "failed",
    });

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(2);
    // Newest first
    expect(page.notifications[0]!.severity).toBe("error");
    expect(page.notifications[1]!.severity).toBe("success");

    unsub();
  });

  it("calls onNotification callback for new notifications", () => {
    const callback = vi.fn();
    const unsub = wireNotificationEmitter(db, SLUG, callback);
    const bus = getBus(SLUG);

    bus.publish(RuntimeError, {
      slug: SLUG,
      error: "Test error",
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]!.severity).toBe("error");

    unsub();
  });

  it("does not call callback when deduplicated", () => {
    const callback = vi.fn();
    const unsub = wireNotificationEmitter(db, SLUG, callback);
    const bus = getBus(SLUG);

    bus.publish(HeartbeatAlert, {
      agentId: "pilot" as string,
      instanceSlug: SLUG,
      text: "Alert 1",
    });
    bus.publish(HeartbeatAlert, {
      agentId: "pilot" as string,
      instanceSlug: SLUG,
      text: "Alert 2",
    });

    expect(callback).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("stops emitting after unsubscribe", () => {
    const unsub = wireNotificationEmitter(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(RuntimeError, { slug: SLUG, error: "Before unsub" });
    expect(countUnread(db)).toBe(1);

    unsub();

    bus.publish(RuntimeError, { slug: SLUG, error: "After unsub" });
    // Still 1 — the second event was not captured
    expect(countUnread(db)).toBe(1);
  });
});
