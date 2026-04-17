// src/core/__tests__/notification-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import {
  insertNotification,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
  pruneNotifications,
} from "../repositories/notification-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-notif-repo-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// insertNotification
// ---------------------------------------------------------------------------

describe("insertNotification", () => {
  it("inserts a basic notification and returns the row", () => {
    const row = insertNotification(db, {
      instanceSlug: "demo",
      eventType: "budget.soft_alert",
      severity: "warning",
      title: "Budget alert: build-agent at 80%",
      body: "Budget threshold crossed",
      linkRoute: "/instances/demo/costs",
    });

    expect(row).not.toBeNull();
    expect(row!.instance_slug).toBe("demo");
    expect(row!.event_type).toBe("budget.soft_alert");
    expect(row!.severity).toBe("warning");
    expect(row!.title).toBe("Budget alert: build-agent at 80%");
    expect(row!.body).toBe("Budget threshold crossed");
    expect(row!.link_route).toBe("/instances/demo/costs");
    expect(row!.is_read).toBe(0);
    expect(row!.created_at).toBeTruthy();
  });

  it("inserts with null optional fields", () => {
    const row = insertNotification(db, {
      eventType: "runtime.error",
      severity: "error",
      title: "Runtime error",
    });

    expect(row).not.toBeNull();
    expect(row!.instance_slug).toBeNull();
    expect(row!.body).toBeNull();
    expect(row!.link_route).toBeNull();
    expect(row!.dedup_key).toBeNull();
  });

  it("deduplicates within the 15-minute window", () => {
    const row1 = insertNotification(db, {
      eventType: "heartbeat.alert",
      severity: "error",
      title: "Heartbeat lost: pilot",
      dedupKey: "hb-demo-pilot",
    });
    expect(row1).not.toBeNull();

    const row2 = insertNotification(db, {
      eventType: "heartbeat.alert",
      severity: "error",
      title: "Heartbeat lost: pilot",
      dedupKey: "hb-demo-pilot",
    });
    expect(row2).toBeNull();

    // Only one notification in DB
    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
  });

  it("allows insert after dedup window expires", () => {
    // Insert an old notification by manipulating created_at
    db.prepare(
      `INSERT INTO notifications (event_type, severity, title, dedup_key, created_at)
       VALUES (?, ?, ?, ?, datetime('now', '-20 minutes'))`,
    ).run("heartbeat.alert", "error", "Heartbeat lost: pilot", "hb-demo-pilot");

    // New insert with same dedup_key should succeed (> 15 min)
    const row = insertNotification(db, {
      eventType: "heartbeat.alert",
      severity: "error",
      title: "Heartbeat lost: pilot",
      dedupKey: "hb-demo-pilot",
    });
    expect(row).not.toBeNull();
  });

  it("does not deduplicate when dedupKey is not provided", () => {
    const row1 = insertNotification(db, {
      eventType: "task.status_changed",
      severity: "success",
      title: "Task completed: #1",
    });
    const row2 = insertNotification(db, {
      eventType: "task.status_changed",
      severity: "success",
      title: "Task completed: #2",
    });
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
    expect(row1!.id).not.toBe(row2!.id);
  });

  it("allows different dedup keys", () => {
    const row1 = insertNotification(db, {
      eventType: "heartbeat.alert",
      severity: "error",
      title: "Heartbeat lost: pilot",
      dedupKey: "hb-demo-pilot",
    });
    const row2 = insertNotification(db, {
      eventType: "heartbeat.alert",
      severity: "error",
      title: "Heartbeat lost: build",
      dedupKey: "hb-demo-build",
    });
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

function seedNotifications(count: number): void {
  for (let i = 0; i < count; i++) {
    insertNotification(db, {
      instanceSlug: "demo",
      eventType: "task.status_changed",
      severity: i % 2 === 0 ? "success" : "error",
      title: `Notification ${i}`,
    });
  }
}

describe("listNotifications", () => {
  it("returns notifications in descending ID order", () => {
    seedNotifications(5);
    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(5);
    for (let i = 1; i < page.notifications.length; i++) {
      expect(page.notifications[i - 1]!.id).toBeGreaterThan(page.notifications[i]!.id);
    }
  });

  it("returns empty page when no notifications", () => {
    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", () => {
    seedNotifications(10);

    const page1 = listNotifications(db, { limit: 4 });
    expect(page1.notifications).toHaveLength(4);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listNotifications(db, { limit: 4, cursor: page1.nextCursor! });
    expect(page2.notifications).toHaveLength(4);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = listNotifications(db, { limit: 4, cursor: page2.nextCursor! });
    expect(page3.notifications).toHaveLength(2);
    expect(page3.nextCursor).toBeNull();

    // No overlap
    const allIds = [
      ...page1.notifications.map((n) => n.id),
      ...page2.notifications.map((n) => n.id),
      ...page3.notifications.map((n) => n.id),
    ];
    expect(new Set(allIds).size).toBe(10);
  });

  it("caps limit at 100", () => {
    seedNotifications(5);
    const page = listNotifications(db, { limit: 999 });
    expect(page.notifications).toHaveLength(5);
  });

  it("filters unread only", () => {
    seedNotifications(5);
    // Mark first two as read
    const all = listNotifications(db);
    markRead(db, all.notifications[0]!.id);
    markRead(db, all.notifications[1]!.id);

    const unread = listNotifications(db, { unreadOnly: true });
    expect(unread.notifications).toHaveLength(3);
    expect(unread.notifications.every((n) => n.is_read === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// countUnread
// ---------------------------------------------------------------------------

describe("countUnread", () => {
  it("returns 0 when no notifications", () => {
    expect(countUnread(db)).toBe(0);
  });

  it("counts only unread notifications", () => {
    seedNotifications(5);
    expect(countUnread(db)).toBe(5);

    const all = listNotifications(db);
    markRead(db, all.notifications[0]!.id);
    expect(countUnread(db)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// markRead / markAllRead
// ---------------------------------------------------------------------------

describe("markRead", () => {
  it("marks a single notification as read", () => {
    const row = insertNotification(db, {
      eventType: "task.status_changed",
      severity: "success",
      title: "Task completed",
    });

    markRead(db, row!.id);
    const page = listNotifications(db);
    expect(page.notifications[0]!.is_read).toBe(1);
  });
});

describe("markAllRead", () => {
  it("marks all unread notifications as read", () => {
    seedNotifications(5);
    expect(countUnread(db)).toBe(5);

    markAllRead(db);
    expect(countUnread(db)).toBe(0);

    const page = listNotifications(db);
    expect(page.notifications.every((n) => n.is_read === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pruneNotifications
// ---------------------------------------------------------------------------

describe("pruneNotifications", () => {
  it("deletes notifications older than the threshold", () => {
    // Insert an old notification
    db.prepare(
      `INSERT INTO notifications (event_type, severity, title, created_at)
       VALUES (?, ?, ?, datetime('now', '-40 days'))`,
    ).run("task.status_changed", "success", "Old task");

    // Insert a recent notification
    insertNotification(db, {
      eventType: "task.status_changed",
      severity: "success",
      title: "Recent task",
    });

    const deleted = pruneNotifications(db, 30);
    expect(deleted).toBe(1);

    const page = listNotifications(db);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.title).toBe("Recent task");
  });

  it("returns 0 when nothing to prune", () => {
    insertNotification(db, {
      eventType: "task.status_changed",
      severity: "success",
      title: "Recent task",
    });

    const deleted = pruneNotifications(db, 30);
    expect(deleted).toBe(0);
  });
});
