// src/core/__tests__/task-activity-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { createTask } from "../repositories/task-repository.js";
import {
  insertActivity,
  getActivities,
  getActivityCount,
  recordFieldChanges,
} from "../repositories/task-activity-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-activity-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// insertActivity
// ---------------------------------------------------------------------------

describe("insertActivity", () => {
  it("inserts and returns a row with correct fields", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test task",
      createdBy: "user",
    });
    const row = insertActivity(db, {
      taskId: task.id,
      activityType: "created",
      actorId: "user",
      details: { status: "pending", priority: "medium" },
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.task_id).toBe(task.id);
    expect(row.activity_type).toBe("created");
    expect(row.actor_id).toBe("user");
    expect(JSON.parse(row.details_json!)).toEqual({ status: "pending", priority: "medium" });
    expect(row.created_at).toBeTruthy();
  });

  it("handles null details", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    const row = insertActivity(db, {
      taskId: task.id,
      activityType: "description_changed",
      actorId: "agent-1",
    });
    expect(row.details_json).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getActivities
// ---------------------------------------------------------------------------

describe("getActivities", () => {
  it("returns activities in chronological order", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    insertActivity(db, { taskId: task.id, activityType: "created", actorId: "user" });
    insertActivity(db, {
      taskId: task.id,
      activityType: "status_changed",
      actorId: "agent-1",
      details: { from: "pending", to: "in_progress" },
    });
    insertActivity(db, {
      taskId: task.id,
      activityType: "assigned",
      actorId: "agent-1",
      details: { from: null, to: "agent-1" },
    });

    const activities = getActivities(db, task.id);
    expect(activities).toHaveLength(3);
    expect(activities[0]!.activity_type).toBe("created");
    expect(activities[1]!.activity_type).toBe("status_changed");
    expect(activities[2]!.activity_type).toBe("assigned");
  });

  it("respects limit and offset", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    for (let i = 0; i < 10; i++) {
      insertActivity(db, { taskId: task.id, activityType: "comment", actorId: "user" });
    }

    const page1 = getActivities(db, task.id, { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = getActivities(db, task.id, { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0]!.id).not.toBe(page1[0]!.id);

    const all = getActivities(db, task.id, { limit: 100 });
    expect(all).toHaveLength(10);
  });

  it("returns empty array for task with no activities", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    expect(getActivities(db, task.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActivityCount
// ---------------------------------------------------------------------------

describe("getActivityCount", () => {
  it("returns correct count", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    expect(getActivityCount(db, task.id)).toBe(0);

    insertActivity(db, { taskId: task.id, activityType: "created", actorId: "user" });
    insertActivity(db, { taskId: task.id, activityType: "comment", actorId: "user" });
    expect(getActivityCount(db, task.id)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// recordFieldChanges
// ---------------------------------------------------------------------------

describe("recordFieldChanges", () => {
  it("records priority change", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { priority: "high" });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.activity_type).toBe("priority_changed");
    const details = JSON.parse(activities[0]!.details_json!);
    expect(details).toEqual({ from: "medium", to: "high" });
  });

  it("records assignee change", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { assigneeId: "agent-1" });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities[0]!.activity_type).toBe("assigned");
    const details = JSON.parse(activities[0]!.details_json!);
    expect(details).toEqual({ from: null, to: "agent-1" });
  });

  it("records title change", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Old title",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { title: "New title" });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities[0]!.activity_type).toBe("title_changed");
    const details = JSON.parse(activities[0]!.details_json!);
    expect(details).toEqual({ from: "Old title", to: "New title" });
  });

  it("records description change", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { description: "New desc" });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities[0]!.activity_type).toBe("description_changed");
    expect(activities[0]!.details_json).toBeNull();
  });

  it("records labels change", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      labels: ["bug"],
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { labels: ["bug", "urgent"] });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities[0]!.activity_type).toBe("labels_changed");
    const details = JSON.parse(activities[0]!.details_json!);
    expect(details).toEqual({ from: ["bug"], to: ["bug", "urgent"] });
  });

  it("records parent change", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Task",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { parentId: epic.id });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities[0]!.activity_type).toBe("parent_changed");
    const details = JSON.parse(activities[0]!.details_json!);
    expect(details).toEqual({ from: null, to: epic.id });
  });

  it("skips unchanged fields", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      priority: "medium",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, {
      title: "Test",
      priority: "medium",
    });
    expect(count).toBe(0);
    expect(getActivities(db, task.id)).toHaveLength(0);
  });

  it("records multiple changes at once", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "agent-1", task, {
      title: "New title",
      priority: "high",
      assigneeId: "agent-1",
    });
    expect(count).toBe(3);
    expect(getActivities(db, task.id)).toHaveLength(3);
  });

  it("handles unassign (value→null)", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Test",
      assigneeId: "agent-1",
      createdBy: "user",
    });
    const count = recordFieldChanges(db, task.id, "user", task, { assigneeId: null });
    expect(count).toBe(1);

    const activities = getActivities(db, task.id);
    expect(activities[0]!.activity_type).toBe("assigned");
    const details = JSON.parse(activities[0]!.details_json!);
    expect(details).toEqual({ from: "agent-1", to: null });
  });
});
