// src/dashboard/routes/instances/_tasks-shared.ts
// Shared helpers and constants for task route modules.
import type { RouteDeps } from "../../route-deps.js";
import {
  type TaskStatus,
  type TaskType,
  type TaskRow,
} from "../../../core/repositories/task-repository.js";
import { getOrCreatePermanentSession } from "../../../runtime/session/session.js";
import { createUserMessage } from "../../../runtime/session/message.js";
import type { InstanceSlug } from "../../../runtime/types.js";
import { wakeupAgent } from "../_wakeup-agent.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Validation sets
// ---------------------------------------------------------------------------

const STATUSES = ["pending", "in_progress", "completed", "blocked", "cancelled"] as const;
const TASK_TYPES = ["epic", "task"] as const;

export const VALID_STATUSES = new Set<TaskStatus>(STATUSES);
export const VALID_TYPES = new Set<TaskType>(TASK_TYPES);

// ---------------------------------------------------------------------------
// JSON serializer
// ---------------------------------------------------------------------------

export function toJson(r: TaskRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assigneeId: r.assignee_id,
    labels: r.labels ? (JSON.parse(r.labels) as string[]) : null,
    createdBy: r.created_by,
    sessionId: r.session_id,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    type: r.type,
    parentId: r.parent_id,
  };
}

// ---------------------------------------------------------------------------
// Helper: inject notification message + trigger prompt loop
// ---------------------------------------------------------------------------

export function notifyAndWakeAgent(
  db: Parameters<typeof createUserMessage>[0],
  registry: RouteDeps["registry"],
  slug: string,
  agentId: string,
  taskId: number,
  title: string,
  description: string | null | undefined,
): void {
  const lines = [`[task_assigned:#${taskId}] "${title}" has been assigned to you.`];
  if (description) lines.push(`Description: ${description}`);
  lines.push("Use the task_board tool to checkout and work on this task.");
  const text = lines.join("\n");

  try {
    const session = getOrCreatePermanentSession(db, {
      instanceSlug: slug as InstanceSlug,
      agentId,
      channel: "internal",
    });
    createUserMessage(db, { sessionId: session.id, text });
  } catch (err) {
    logger.debug("[route:tasks] task notification session creation failed", { error: String(err) });
    // Non-critical — agent may not have a permanent session yet
    return;
  }

  // Fire-and-forget: trigger the agent's prompt loop
  wakeupAgent({ db, registry, slug, agentId, messageText: text });
}
