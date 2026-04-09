/**
 * runtime/tool/task-board.ts
 *
 * Agent tool for managing the shared task board.
 * Factory pattern: createTaskBoardTool() closes over db + instanceSlug,
 * same approach as createTaskTool() in task.ts.
 */

import { z } from "zod";
import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";
import { Tool } from "./tool.js";
import {
  createTask,
  getTasksForInstance,
  getTask,
  changeStatus,
  checkoutTask,
  addComment,
  getEpicsForInstance,
  getEpicProgress,
  type TaskStatus,
  type TaskPriority,
  type TaskType,
} from "../../core/repositories/task-repository.js";
import { getBus } from "../bus/index.js";
import { TaskCreated, TaskStatusChanged, TaskAssigned } from "../bus/events.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTaskBoardTool(options: {
  db: Database.Database;
  instanceSlug: InstanceSlug;
}): Tool.Info<typeof parameters> {
  const { db, instanceSlug } = options;

  const ok = (title: string, output: string): Tool.Result => ({ title, output, truncated: false });

  return Tool.define("task_board", {
    description:
      "Manage the shared task board for this instance. " +
      "Actions: list (view tasks), list_epics (view epics with progress), " +
      "create (add a task or epic, optionally assign and/or nest under an epic), " +
      "checkout (claim a pending task), complete/block/cancel (change status), comment (add a note).",
    parameters,
    async execute(params, ctx) {
      const bus = getBus(instanceSlug);

      switch (params.action) {
        // ── List ──────────────────────────────────────────────────
        case "list": {
          const status = params.status as TaskStatus | undefined;
          const tasks = getTasksForInstance(db, instanceSlug, status);
          if (tasks.length === 0) return ok("task_board.list", "No tasks found.");
          const lines = tasks.map((t) => {
            let line = `#${t.id} [${t.status}] ${t.priority} — ${t.title}`;
            if (t.assignee_id) line += ` (→ ${t.assignee_id})`;
            if (t.parent_id) {
              const parent = getTask(db, t.parent_id);
              if (parent) line += ` (Epic: "${parent.title}")`;
            }
            if (t.type === "epic") line += " [EPIC]";
            return line;
          });
          return ok("task_board.list", lines.join("\n"));
        }

        // ── List Epics ───────────────────────────────────────────
        case "list_epics": {
          const epics = getEpicsForInstance(db, instanceSlug);
          if (epics.length === 0) return ok("task_board.list_epics", "No epics found.");
          const lines = epics.map((e) => {
            const p = getEpicProgress(db, e.id);
            return `#${e.id} [${e.status}] ${e.priority} — ${e.title} (${p.completed}/${p.total} done)`;
          });
          return ok("task_board.list_epics", lines.join("\n"));
        }

        // ── Create ───────────────────────────────────────────────
        case "create": {
          if (!params.title) return ok("task_board.create", "Error: title is required.");
          let task;
          try {
            task = createTask(db, {
              instanceSlug,
              title: params.title,
              ...(params.description !== undefined ? { description: params.description } : {}),
              ...(params.priority !== undefined
                ? { priority: params.priority as TaskPriority }
                : {}),
              ...(params.assigneeId !== undefined ? { assigneeId: params.assigneeId } : {}),
              ...(params.type !== undefined ? { type: params.type as TaskType } : {}),
              ...(params.parentId !== undefined ? { parentId: params.parentId } : {}),
              createdBy: ctx.agentId,
            });
          } catch (err) {
            return ok("task_board.create", `Error: ${String(err)}`);
          }
          bus.publish(TaskCreated, {
            instanceSlug,
            taskId: task.id,
            title: task.title,
            createdBy: ctx.agentId,
          });
          if (params.assigneeId) {
            bus.publish(TaskAssigned, {
              instanceSlug,
              taskId: task.id,
              assigneeId: params.assigneeId,
              assignedBy: ctx.agentId,
            });
          }
          const assigneeSuffix = params.assigneeId ? ` → ${params.assigneeId}` : "";
          return ok(
            "task_board.create",
            `Task #${task.id} created: "${task.title}" [${task.priority}]${assigneeSuffix}`,
          );
        }

        // ── Checkout ─────────────────────────────────────────────
        case "checkout": {
          if (!params.taskId) return ok("task_board.checkout", "Error: taskId is required.");
          const before = getTask(db, params.taskId);
          if (!before) return ok("task_board.checkout", `Error: task #${params.taskId} not found.`);
          const claimed = checkoutTask(db, params.taskId, ctx.sessionId, ctx.agentId);
          if (!claimed)
            return ok(
              "task_board.checkout",
              `Error: task #${params.taskId} is not pending (status: ${before.status}).`,
            );
          bus.publish(TaskStatusChanged, {
            instanceSlug,
            taskId: claimed.id,
            oldStatus: "pending",
            newStatus: "in_progress",
            agentId: ctx.agentId,
          });
          bus.publish(TaskAssigned, {
            instanceSlug,
            taskId: claimed.id,
            assigneeId: ctx.agentId,
            sessionId: ctx.sessionId,
            assignedBy: ctx.agentId,
          });
          return ok(
            "task_board.checkout",
            `Task #${claimed.id} checked out: "${claimed.title}" — now assigned to you.`,
          );
        }

        // ── Complete ─────────────────────────────────────────────
        case "complete": {
          if (!params.taskId) return ok("task_board.complete", "Error: taskId is required.");
          const before = getTask(db, params.taskId);
          if (!before) return ok("task_board.complete", `Error: task #${params.taskId} not found.`);
          const updated = changeStatus(db, params.taskId, "completed");
          bus.publish(TaskStatusChanged, {
            instanceSlug,
            taskId: params.taskId,
            oldStatus: before.status,
            newStatus: "completed",
            agentId: ctx.agentId,
          });
          return ok("task_board.complete", `Task #${params.taskId} completed: "${updated!.title}"`);
        }

        // ── Block ────────────────────────────────────────────────
        case "block": {
          if (!params.taskId) return ok("task_board.block", "Error: taskId is required.");
          const before = getTask(db, params.taskId);
          if (!before) return ok("task_board.block", `Error: task #${params.taskId} not found.`);
          changeStatus(db, params.taskId, "blocked");
          bus.publish(TaskStatusChanged, {
            instanceSlug,
            taskId: params.taskId,
            oldStatus: before.status,
            newStatus: "blocked",
            agentId: ctx.agentId,
          });
          if (params.comment) {
            addComment(db, {
              taskId: params.taskId,
              authorId: ctx.agentId,
              content: params.comment,
            });
          }
          return ok(
            "task_board.block",
            `Task #${params.taskId} blocked.${params.comment ? ` Reason: ${params.comment}` : ""}`,
          );
        }

        // ── Cancel ───────────────────────────────────────────────
        case "cancel": {
          if (!params.taskId) return ok("task_board.cancel", "Error: taskId is required.");
          const before = getTask(db, params.taskId);
          if (!before) return ok("task_board.cancel", `Error: task #${params.taskId} not found.`);
          changeStatus(db, params.taskId, "cancelled");
          bus.publish(TaskStatusChanged, {
            instanceSlug,
            taskId: params.taskId,
            oldStatus: before.status,
            newStatus: "cancelled",
            agentId: ctx.agentId,
          });
          return ok("task_board.cancel", `Task #${params.taskId} cancelled.`);
        }

        // ── Comment ──────────────────────────────────────────────
        case "comment": {
          if (!params.taskId) return ok("task_board.comment", "Error: taskId is required.");
          if (!params.comment) return ok("task_board.comment", "Error: comment is required.");
          if (!getTask(db, params.taskId))
            return ok("task_board.comment", `Error: task #${params.taskId} not found.`);
          addComment(db, { taskId: params.taskId, authorId: ctx.agentId, content: params.comment });
          return ok("task_board.comment", `Comment added to task #${params.taskId}.`);
        }

        default:
          return ok("task_board", `Unknown action: ${params.action}`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const parameters = z.object({
  action: z
    .enum(["list", "list_epics", "create", "checkout", "complete", "block", "cancel", "comment"])
    .describe("The action to perform on the task board."),
  title: z.string().optional().describe("Task title (for 'create' action)."),
  description: z.string().optional().describe("Task description (for 'create' action)."),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Task priority (for 'create' action). Defaults to 'medium'."),
  assigneeId: z
    .string()
    .optional()
    .describe("Agent ID to assign the task to (for 'create' action)."),
  type: z
    .enum(["epic", "task"])
    .optional()
    .describe(
      "Type: 'epic' for a high-level objective, 'task' for a work item (for 'create'). Defaults to 'task'.",
    ),
  parentId: z
    .number()
    .optional()
    .describe("Parent epic ID to nest under (for 'create'). Only epics can be parents."),
  taskId: z.number().optional().describe("Task ID (for checkout/complete/block/cancel/comment)."),
  comment: z.string().optional().describe("Comment text (for 'comment' or 'block' action)."),
  status: z
    .enum(["pending", "in_progress", "completed", "blocked", "cancelled"])
    .optional()
    .describe("Filter by status (for 'list' action)."),
});
