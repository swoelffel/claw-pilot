/**
 * runtime/tool/built-in/todo.ts
 *
 * Todo tools — read and write a session-scoped todo list.
 * Stored in-memory per session (not persisted to DB in V1).
 */

import { z } from "zod";
import { Tool } from "../tool.js";

// ---------------------------------------------------------------------------
// In-memory todo store (per session)
// ---------------------------------------------------------------------------

const TodoStatus = z.enum(["pending", "in_progress", "completed", "cancelled"]);
const TodoPriority = z.enum(["high", "medium", "low"]);

const TodoItem = z.object({
  content: z.string().describe("Brief description of the task"),
  status: TodoStatus.describe("Current status of the task"),
  priority: TodoPriority.describe("Priority level of the task"),
});

type TodoItemType = z.infer<typeof TodoItem>;

const _todos = new Map<string, TodoItemType[]>();

function getTodos(sessionId: string): TodoItemType[] {
  return _todos.get(sessionId) ?? [];
}

function setTodos(sessionId: string, todos: TodoItemType[]): void {
  _todos.set(sessionId, todos);
}

/** Clear todos for a session (call on session end) */
export function clearTodos(sessionId: string): void {
  _todos.delete(sessionId);
}

// ---------------------------------------------------------------------------
// TodoWrite tool
// ---------------------------------------------------------------------------

export const TodoWriteTool = Tool.define("todowrite", {
  description:
    "Use this tool to create and manage a structured task list for your current coding session. " +
    "This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.",
  parameters: z.object({
    todos: z.array(TodoItem).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    setTodos(ctx.sessionId, params.todos);

    const pending = params.todos.filter((t) => t.status !== "completed").length;

    return {
      title: `${pending} todos`,
      output: JSON.stringify(params.todos, null, 2),
      truncated: false,
    };
  },
});

// ---------------------------------------------------------------------------
// TodoRead tool
// ---------------------------------------------------------------------------

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your current todo list.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const todos = getTodos(ctx.sessionId);
    const pending = todos.filter((t) => t.status !== "completed").length;

    return {
      title: `${pending} todos`,
      output: todos.length === 0 ? "No todos" : JSON.stringify(todos, null, 2),
      truncated: false,
    };
  },
});
