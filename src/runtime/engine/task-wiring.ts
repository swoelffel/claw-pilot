/**
 * runtime/engine/task-wiring.ts
 *
 * Wires TaskAssigned bus events to agent notification.
 *
 * When a task is assigned to an agent (via UI, tool checkout, or agent-to-agent
 * create), this module injects a notification message into the target agent's
 * permanent session and, if the session is idle, fires a prompt loop so the
 * agent reacts immediately.
 *
 * Pattern mirrors plugin-wiring.ts: subscribe at engine start, return unsub
 * function for cleanup on stop.
 */

import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";
import type { RuntimeConfig } from "../config/index.js";
import { getBus } from "../bus/index.js";
import { TaskAssigned, SessionStatusChanged } from "../bus/events.js";
import { getOrCreatePermanentSession } from "../session/session.js";
import { createUserMessage } from "../session/message.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import { resolveModelForAgent } from "../channel/router.js";
import { getTask } from "../../core/repositories/task-repository.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function wireTaskNotifications(options: {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  config: RuntimeConfig;
  workDir: string | undefined;
  /** DB-backed skill loader — forwarded to runPromptLoop for system-prompt + tool. */
  skillLoader?: import("../session/skill-loader.js").SkillLoader;
}): () => void {
  const { db, instanceSlug, config, workDir, skillLoader } = options;
  const bus = getBus(instanceSlug);

  // Track session busy/idle state via bus events
  const sessionStatus = new Map<string, "idle" | "busy">();

  const unsubStatus = bus.subscribe(SessionStatusChanged, (payload) => {
    if (payload.status === "busy" || payload.status === "idle") {
      sessionStatus.set(payload.sessionId, payload.status);
    }
  });

  const unsubAssigned = bus.subscribe(TaskAssigned, (payload) => {
    // Skip self-assignment (agent checking out its own task)
    if (payload.assignedBy && payload.assignedBy === payload.assigneeId) return;

    // Look up the target agent config
    const agentConfig = config.agents.find((a) => a.id === payload.assigneeId);
    if (!agentConfig) {
      logger.warn("task_wiring_agent_not_found", {
        event: "task_wiring_agent_not_found",
        slug: instanceSlug,
        assigneeId: payload.assigneeId,
        taskId: payload.taskId,
      });
      return;
    }

    // Look up the task for title/description
    const task = getTask(db, payload.taskId);
    if (!task) return;

    // Build notification message
    const lines = [`[task_assigned:#${task.id}] "${task.title}" has been assigned to you.`];
    if (task.description) {
      lines.push(`Description: ${task.description}`);
    }
    lines.push("Use the task_board tool to checkout and work on this task.");
    const notificationText = lines.join("\n");

    // Get or create the target agent's permanent session
    const session = getOrCreatePermanentSession(db, {
      instanceSlug,
      agentId: payload.assigneeId,
      channel: "internal",
    });

    // Inject notification message into the session
    createUserMessage(db, { sessionId: session.id, text: notificationText });

    // If session is idle, trigger a prompt loop (fire-and-forget)
    const status = sessionStatus.get(session.id);
    if (status !== "busy") {
      const resolvedModel = resolveModelForAgent(db, instanceSlug, agentConfig, config);

      void runPromptLoop({
        db,
        instanceSlug,
        sessionId: session.id,
        userText: notificationText,
        agentConfig,
        resolvedModel,
        workDir,
        runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
        compactionConfig: config.compaction,
        runtimeConfig: config,
        ...(skillLoader !== undefined ? { skillLoader } : {}),
      }).catch((err: unknown) => {
        logger.error("task_notification_prompt_loop_failed", {
          event: "task_notification_prompt_loop_failed",
          slug: instanceSlug,
          agentId: payload.assigneeId,
          taskId: payload.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  return () => {
    unsubStatus();
    unsubAssigned();
    sessionStatus.clear();
  };
}
