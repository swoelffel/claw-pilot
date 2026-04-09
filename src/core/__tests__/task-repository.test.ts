// src/core/__tests__/task-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import {
  createTask,
  getTask,
  getTasksForInstance,
  updateTask,
  deleteTask,
  changeStatus,
  reorderTask,
  checkoutTask,
  getTaskCountsByStatus,
  addComment,
  getComments,
  getActiveTasksForAgent,
  getEpicsForInstance,
  getChildTasks,
  getEpicProgress,
  getAncestryChain,
  validateParentId,
  tryAutoCompleteEpic,
} from "../repositories/task-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-task-test-"));
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
// CRUD
// ---------------------------------------------------------------------------

describe("createTask", () => {
  it("creates a task with defaults", () => {
    const t = createTask(db, {
      instanceSlug: "test-inst",
      title: "Fix auth bug",
      createdBy: "user",
    });
    expect(t.id).toBeGreaterThan(0);
    expect(t.title).toBe("Fix auth bug");
    expect(t.status).toBe("pending");
    expect(t.priority).toBe("medium");
    expect(t.assignee_id).toBeNull();
    expect(t.position).toBe(100);
    expect(t.created_by).toBe("user");
  });

  it("increments position for each new task", () => {
    const t1 = createTask(db, { instanceSlug: "test-inst", title: "T1", createdBy: "user" });
    const t2 = createTask(db, { instanceSlug: "test-inst", title: "T2", createdBy: "user" });
    const t3 = createTask(db, { instanceSlug: "test-inst", title: "T3", createdBy: "user" });
    expect(t1.position).toBe(100);
    expect(t2.position).toBe(200);
    expect(t3.position).toBe(300);
  });

  it("stores labels as JSON", () => {
    const t = createTask(db, {
      instanceSlug: "test-inst",
      title: "With labels",
      createdBy: "user",
      labels: ["api", "urgent"],
    });
    expect(JSON.parse(t.labels!)).toEqual(["api", "urgent"]);
  });
});

describe("getTask", () => {
  it("returns undefined for missing id", () => {
    expect(getTask(db, 9999)).toBeUndefined();
  });
});

describe("getTasksForInstance", () => {
  it("returns all tasks ordered by position", () => {
    createTask(db, { instanceSlug: "test-inst", title: "T1", createdBy: "user" });
    createTask(db, { instanceSlug: "test-inst", title: "T2", createdBy: "user" });
    const tasks = getTasksForInstance(db, "test-inst");
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toBe("T1");
    expect(tasks[1]!.title).toBe("T2");
  });

  it("filters by status", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T1", createdBy: "user" });
    changeStatus(db, t.id, "completed");
    createTask(db, { instanceSlug: "test-inst", title: "T2", createdBy: "user" });
    expect(getTasksForInstance(db, "test-inst", "pending")).toHaveLength(1);
    expect(getTasksForInstance(db, "test-inst", "completed")).toHaveLength(1);
  });

  it("returns empty for unknown slug", () => {
    expect(getTasksForInstance(db, "unknown")).toEqual([]);
  });
});

describe("updateTask", () => {
  it("updates title and priority", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "Old", createdBy: "user" });
    const updated = updateTask(db, t.id, { title: "New", priority: "critical" });
    expect(updated!.title).toBe("New");
    expect(updated!.priority).toBe("critical");
  });

  it("updates labels", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const updated = updateTask(db, t.id, { labels: ["backend"] });
    expect(JSON.parse(updated!.labels!)).toEqual(["backend"]);
  });

  it("clears assignee with null", () => {
    const t = createTask(db, {
      instanceSlug: "test-inst",
      title: "T",
      createdBy: "user",
      assigneeId: "pilot",
    });
    const updated = updateTask(db, t.id, { assigneeId: null });
    expect(updated!.assignee_id).toBeNull();
  });

  it("returns unchanged row when no fields provided", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const same = updateTask(db, t.id, {});
    expect(same!.title).toBe("T");
  });
});

describe("deleteTask", () => {
  it("deletes task and cascades comments", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    addComment(db, { taskId: t.id, authorId: "user", content: "hello" });
    expect(deleteTask(db, t.id)).toBe(true);
    expect(getTask(db, t.id)).toBeUndefined();
    expect(getComments(db, t.id)).toEqual([]);
  });

  it("returns false for non-existent id", () => {
    expect(deleteTask(db, 9999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

describe("changeStatus", () => {
  it("changes status and appends at end of target column", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const updated = changeStatus(db, t.id, "in_progress");
    expect(updated!.status).toBe("in_progress");
    expect(updated!.position).toBe(100); // first in the column
  });

  it("sets completed_at when completing", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const updated = changeStatus(db, t.id, "completed");
    expect(updated!.completed_at).toBeTruthy();
  });

  it("accepts explicit position for drag & drop", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const updated = changeStatus(db, t.id, "in_progress", 250);
    expect(updated!.position).toBe(250);
  });

  it("returns undefined for missing task", () => {
    expect(changeStatus(db, 9999, "completed")).toBeUndefined();
  });
});

describe("reorderTask", () => {
  it("updates position", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    reorderTask(db, t.id, 500);
    expect(getTask(db, t.id)!.position).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Atomic checkout
// ---------------------------------------------------------------------------

describe("checkoutTask", () => {
  it("claims a pending task", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const claimed = checkoutTask(db, t.id, "sess-1", "pilot");
    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe("in_progress");
    expect(claimed!.assignee_id).toBe("pilot");
    expect(claimed!.session_id).toBe("sess-1");
  });

  it("rejects double checkout", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    checkoutTask(db, t.id, "sess-1", "pilot");
    const second = checkoutTask(db, t.id, "sess-2", "builder");
    expect(second).toBeUndefined();
  });

  it("rejects checkout on non-pending task", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    changeStatus(db, t.id, "blocked");
    expect(checkoutTask(db, t.id, "sess-1", "pilot")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

describe("getTaskCountsByStatus", () => {
  it("returns zero counts for empty instance", () => {
    const counts = getTaskCountsByStatus(db, "test-inst");
    expect(counts.pending).toBe(0);
    expect(counts.in_progress).toBe(0);
    expect(counts.completed).toBe(0);
  });

  it("counts tasks per status", () => {
    createTask(db, { instanceSlug: "test-inst", title: "T1", createdBy: "user" });
    createTask(db, { instanceSlug: "test-inst", title: "T2", createdBy: "user" });
    const t3 = createTask(db, { instanceSlug: "test-inst", title: "T3", createdBy: "user" });
    changeStatus(db, t3.id, "in_progress");
    const counts = getTaskCountsByStatus(db, "test-inst");
    expect(counts.pending).toBe(2);
    expect(counts.in_progress).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe("comments", () => {
  it("adds and retrieves comments", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    addComment(db, { taskId: t.id, authorId: "pilot", content: "Working on it" });
    addComment(db, { taskId: t.id, authorId: "user", content: "OK thanks" });
    const comments = getComments(db, t.id);
    expect(comments).toHaveLength(2);
    const contents = comments.map((c) => c.content);
    expect(contents).toContain("Working on it");
    expect(contents).toContain("OK thanks");
  });

  it("respects limit", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    for (let i = 0; i < 5; i++) {
      addComment(db, { taskId: t.id, authorId: "user", content: `Comment ${i}` });
    }
    expect(getComments(db, t.id, 3)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Active tasks for agent
// ---------------------------------------------------------------------------

describe("getActiveTasksForAgent", () => {
  it("returns pending and in_progress tasks assigned to agent", () => {
    const t1 = createTask(db, {
      instanceSlug: "test-inst",
      title: "Task A",
      createdBy: "user",
      assigneeId: "builder",
    });
    checkoutTask(db, t1.id, "sess-1", "builder");
    createTask(db, {
      instanceSlug: "test-inst",
      title: "Task B",
      createdBy: "user",
      assigneeId: "builder",
    });
    // Completed task — should NOT appear
    const t3 = createTask(db, {
      instanceSlug: "test-inst",
      title: "Task C",
      createdBy: "user",
      assigneeId: "builder",
    });
    changeStatus(db, t3.id, "completed");
    // Different agent — should NOT appear
    createTask(db, {
      instanceSlug: "test-inst",
      title: "Task D",
      createdBy: "user",
      assigneeId: "pilot",
    });

    const active = getActiveTasksForAgent(db, "test-inst", "builder");
    expect(active).toHaveLength(2);
    const titles = active.map((t) => t.title);
    expect(titles).toContain("Task A");
    expect(titles).toContain("Task B");
  });

  it("returns empty for agent with no tasks", () => {
    expect(getActiveTasksForAgent(db, "test-inst", "nobody")).toEqual([]);
  });

  it("orders by priority (critical first) then position", () => {
    createTask(db, {
      instanceSlug: "test-inst",
      title: "Low priority task",
      createdBy: "user",
      assigneeId: "builder",
      priority: "low",
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "Critical priority task",
      createdBy: "user",
      assigneeId: "builder",
      priority: "critical",
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "High priority task",
      createdBy: "user",
      assigneeId: "builder",
      priority: "high",
    });

    const active = getActiveTasksForAgent(db, "test-inst", "builder");
    expect(active[0]!.title).toBe("Critical priority task");
    expect(active[1]!.title).toBe("High priority task");
    expect(active[2]!.title).toBe("Low priority task");
  });

  it("includes epic context via LEFT JOIN", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Reliability",
      createdBy: "user",
      type: "epic",
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "Write tests",
      createdBy: "user",
      assigneeId: "builder",
      parentId: epic.id,
    });
    const active = getActiveTasksForAgent(db, "test-inst", "builder");
    expect(active).toHaveLength(1);
    expect(active[0]!.epic_id).toBe(epic.id);
    expect(active[0]!.epic_title).toBe("Reliability");
  });

  it("excludes epics from active tasks", () => {
    createTask(db, {
      instanceSlug: "test-inst",
      title: "My Epic",
      createdBy: "user",
      assigneeId: "builder",
      type: "epic",
    });
    const active = getActiveTasksForAgent(db, "test-inst", "builder");
    expect(active).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Epic hierarchy
// ---------------------------------------------------------------------------

describe("createTask with type", () => {
  it("creates an epic", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Reliability",
      createdBy: "user",
      type: "epic",
    });
    expect(epic.type).toBe("epic");
    expect(epic.parent_id).toBeNull();
  });

  it("creates a task with parentId", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Child",
      createdBy: "user",
      parentId: epic.id,
    });
    expect(task.parent_id).toBe(epic.id);
    expect(task.type).toBe("task");
  });

  it("rejects parentId pointing to a non-epic", () => {
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "Task",
      createdBy: "user",
    });
    expect(() =>
      createTask(db, {
        instanceSlug: "test-inst",
        title: "Child",
        createdBy: "user",
        parentId: task.id,
      }),
    ).toThrow(/not an epic/);
  });

  it("rejects parentId pointing to non-existent task", () => {
    expect(() =>
      createTask(db, {
        instanceSlug: "test-inst",
        title: "Child",
        createdBy: "user",
        parentId: 9999,
      }),
    ).toThrow(/not found/);
  });
});

describe("getEpicsForInstance", () => {
  it("returns only epics", () => {
    createTask(db, { instanceSlug: "test-inst", title: "E1", createdBy: "user", type: "epic" });
    createTask(db, { instanceSlug: "test-inst", title: "T1", createdBy: "user" });
    createTask(db, { instanceSlug: "test-inst", title: "E2", createdBy: "user", type: "epic" });
    const epics = getEpicsForInstance(db, "test-inst");
    expect(epics).toHaveLength(2);
    expect(epics.every((e) => e.type === "epic")).toBe(true);
  });
});

describe("getChildTasks", () => {
  it("returns children of an epic", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "C1",
      createdBy: "user",
      parentId: epic.id,
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "C2",
      createdBy: "user",
      parentId: epic.id,
    });
    createTask(db, { instanceSlug: "test-inst", title: "Orphan", createdBy: "user" });
    const children = getChildTasks(db, epic.id);
    expect(children).toHaveLength(2);
  });
});

describe("getEpicProgress", () => {
  it("counts completed children", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const c1 = createTask(db, {
      instanceSlug: "test-inst",
      title: "C1",
      createdBy: "user",
      parentId: epic.id,
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "C2",
      createdBy: "user",
      parentId: epic.id,
    });
    changeStatus(db, c1.id, "completed");
    const progress = getEpicProgress(db, epic.id);
    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(1);
  });

  it("returns zeros for epic with no children", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Empty Epic",
      createdBy: "user",
      type: "epic",
    });
    const progress = getEpicProgress(db, epic.id);
    expect(progress.total).toBe(0);
    expect(progress.completed).toBe(0);
  });
});

describe("getAncestryChain", () => {
  it("returns ancestry from immediate parent to root", () => {
    const root = createTask(db, {
      instanceSlug: "test-inst",
      title: "Root Epic",
      createdBy: "user",
      type: "epic",
    });
    const child = createTask(db, {
      instanceSlug: "test-inst",
      title: "Sub Epic",
      createdBy: "user",
      type: "epic",
      parentId: root.id,
    });
    const leaf = createTask(db, {
      instanceSlug: "test-inst",
      title: "Task",
      createdBy: "user",
      parentId: child.id,
    });
    const chain = getAncestryChain(db, leaf.id);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.title).toBe("Sub Epic");
    expect(chain[1]!.title).toBe("Root Epic");
  });

  it("returns empty for task with no parent", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    expect(getAncestryChain(db, t.id)).toEqual([]);
  });
});

describe("validateParentId", () => {
  it("rejects self-reference", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    expect(validateParentId(db, t.id, t.id)).toMatch(/own parent/);
  });

  it("rejects non-epic parent", () => {
    const t = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    expect(validateParentId(db, null, t.id)).toMatch(/not an epic/);
  });

  it("accepts valid epic parent", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "E",
      createdBy: "user",
      type: "epic",
    });
    expect(validateParentId(db, null, epic.id, "test-inst")).toBeNull();
  });
});

describe("tryAutoCompleteEpic", () => {
  it("auto-completes epic when all children are done (direct call)", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const c1 = createTask(db, {
      instanceSlug: "test-inst",
      title: "C1",
      createdBy: "user",
      parentId: epic.id,
    });
    const c2 = createTask(db, {
      instanceSlug: "test-inst",
      title: "C2",
      createdBy: "user",
      parentId: epic.id,
    });
    // Use direct SQL to complete children without triggering auto-complete
    db.prepare("UPDATE rt_tasks SET status = 'completed' WHERE id = ?").run(c1.id);
    db.prepare("UPDATE rt_tasks SET status = 'cancelled' WHERE id = ?").run(c2.id);
    const updated = tryAutoCompleteEpic(db, epic.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("completed");
  });

  it("does NOT auto-complete when children are still pending", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const c1 = createTask(db, {
      instanceSlug: "test-inst",
      title: "C1",
      createdBy: "user",
      parentId: epic.id,
    });
    createTask(db, {
      instanceSlug: "test-inst",
      title: "C2",
      createdBy: "user",
      parentId: epic.id,
    });
    db.prepare("UPDATE rt_tasks SET status = 'completed' WHERE id = ?").run(c1.id);
    expect(tryAutoCompleteEpic(db, epic.id)).toBeUndefined();
  });

  it("does NOT auto-complete epic with no children", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    expect(tryAutoCompleteEpic(db, epic.id)).toBeUndefined();
  });
});

describe("changeStatus triggers auto-complete", () => {
  it("auto-completes parent epic when last child is completed", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const c1 = createTask(db, {
      instanceSlug: "test-inst",
      title: "C1",
      createdBy: "user",
      parentId: epic.id,
    });
    changeStatus(db, c1.id, "completed");
    const epicNow = getTask(db, epic.id);
    expect(epicNow!.status).toBe("completed");
  });
});

describe("updateTask with parentId", () => {
  it("assigns a parent epic", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const task = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    const updated = updateTask(db, task.id, { parentId: epic.id });
    expect(updated!.parent_id).toBe(epic.id);
  });

  it("unlinks from parent with null", () => {
    const epic = createTask(db, {
      instanceSlug: "test-inst",
      title: "Epic",
      createdBy: "user",
      type: "epic",
    });
    const task = createTask(db, {
      instanceSlug: "test-inst",
      title: "T",
      createdBy: "user",
      parentId: epic.id,
    });
    const updated = updateTask(db, task.id, { parentId: null });
    expect(updated!.parent_id).toBeNull();
  });

  it("rejects invalid parentId", () => {
    const task = createTask(db, { instanceSlug: "test-inst", title: "T", createdBy: "user" });
    expect(() => updateTask(db, task.id, { parentId: task.id })).toThrow(/own parent/);
  });
});
