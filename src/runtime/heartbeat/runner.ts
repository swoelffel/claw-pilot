/**
 * runtime/heartbeat/runner.ts
 *
 * HeartbeatRunner — starts periodic prompt loops for agents with heartbeat config.
 *
 * One setInterval per agent. Each tick:
 *   1. Checks activeHours restriction
 *   2. Publishes HeartbeatTick
 *   3. Finds or creates a dedicated heartbeat session
 *   4. Runs runPromptLoop with the heartbeat prompt
 *   5. If result === "HEARTBEAT_OK" → silent
 *      Otherwise → publishes HeartbeatAlert
 *
 * Returns a cleanup function that clears all intervals.
 */

import type Database from "better-sqlite3";
import type { RuntimeAgentConfig, RuntimeConfig } from "../config/index.js";
import type { InstanceSlug } from "../types.js";
import { getBus } from "../bus/index.js";
import { HeartbeatTick, HeartbeatAlert } from "../bus/events.js";
import { createSession, listSessions, getOrCreatePermanentSession } from "../session/session.js";
import { getAgent, resolveEffectivePersistence } from "../agent/registry.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import { resolveModelForAgent } from "../channel/router.js";
import { parseInterval, isWithinActiveHours } from "./interval.js";
import { preBudgetCheck, BudgetExceededError } from "../session/budget-check.js";
import { logger } from "../../lib/logger.js";

const HEARTBEAT_CHANNEL = "internal";
const HEARTBEAT_PEER_PREFIX = "heartbeat:";

export interface HeartbeatRunnerContext {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  runtimeConfig: RuntimeConfig;
  workDir: string | undefined;
}

/**
 * Start heartbeat runners for all agents with a heartbeat config.
 * Returns a cleanup function to stop all intervals.
 */
export function startHeartbeatRunner(
  agents: RuntimeAgentConfig[],
  ctx: HeartbeatRunnerContext,
): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];

  for (const agent of agents) {
    if (!agent.heartbeat?.every) continue;

    let intervalMs: number;
    try {
      intervalMs = parseInterval(agent.heartbeat.every);
    } catch (err) {
      logger.warn("[heartbeat] invalid interval for agent", { error: String(err) });
      // Skip agents with invalid interval (should not happen if schema is validated)
      continue;
    }

    const timer = setInterval(() => {
      void runHeartbeatTick(agent, ctx);
    }, intervalMs);

    timers.push(timer);
  }

  return () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
  };
}

async function runHeartbeatTick(
  agent: RuntimeAgentConfig,
  ctx: HeartbeatRunnerContext,
): Promise<void> {
  const { db, instanceSlug, runtimeConfig, workDir } = ctx;
  const bus = getBus(instanceSlug);

  // Check active hours restriction
  const activeHours = agent.heartbeat!.activeHours;
  if (
    !isWithinActiveHours(
      activeHours !== undefined
        ? {
            start: activeHours.start,
            end: activeHours.end,
            ...(activeHours.tz !== undefined ? { tz: activeHours.tz } : {}),
          }
        : undefined,
    )
  )
    return;

  // Check budget before starting tick
  try {
    preBudgetCheck(db, instanceSlug, agent.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      logger.info("heartbeat_budget_blocked", {
        event: "heartbeat_budget_blocked",
        slug: instanceSlug,
        agentId: agent.id,
      });
      return;
    }
    throw err;
  }

  // Publish tick event
  bus.publish(HeartbeatTick, { agentId: agent.id, instanceSlug });
  logger.debug("heartbeat_tick", {
    event: "heartbeat_tick",
    slug: instanceSlug,
    agentId: agent.id,
  });

  // Find or create the heartbeat session for this agent.
  // For permanent agents, reuse the permanent session so the heartbeat shares
  // conversational context with the agent's main session.
  const agentInfo = getAgent(agent.id);
  const isPermanent =
    agentInfo !== undefined && resolveEffectivePersistence(agentInfo, agent) === "permanent";

  let session;
  if (isPermanent) {
    session = getOrCreatePermanentSession(db, {
      instanceSlug,
      agentId: agent.id,
      channel: HEARTBEAT_CHANNEL,
    });
  } else {
    const peerId = `${HEARTBEAT_PEER_PREFIX}${agent.id}`;
    const existingSessions = listSessions(db, instanceSlug, { state: "active" });
    const existingSession = existingSessions.find(
      (s) => s.channel === HEARTBEAT_CHANNEL && s.peerId === peerId,
    );
    session =
      existingSession ??
      createSession(db, {
        instanceSlug,
        agentId: agent.id,
        channel: HEARTBEAT_CHANNEL,
        peerId,
      });
  }

  // Build the heartbeat prompt
  const prompt =
    agent.heartbeat!.prompt ??
    "Read HEARTBEAT.md if it exists and execute the tasks defined for this interval. " +
      "If nothing to do, reply exactly: HEARTBEAT_OK";

  const heartbeatStart = Date.now();
  try {
    // Resolution chain: heartbeat.model → config.defaultHeartbeatModel → agent.model
    const effectiveModel =
      agent.heartbeat!.model ?? runtimeConfig.defaultHeartbeatModel ?? undefined;
    const tempAgentConfig =
      effectiveModel !== undefined ? { ...agent, model: effectiveModel } : agent;
    const resolvedModel = resolveModelForAgent(db, instanceSlug, tempAgentConfig, runtimeConfig);
    const result = await runPromptLoop({
      db,
      instanceSlug,
      sessionId: session.id,
      userText: prompt,
      agentConfig: agent,
      resolvedModel,
      workDir,
    });

    const ackMaxChars = agent.heartbeat!.ackMaxChars ?? 500;
    const text = result.text.trim();
    const durationMs = Date.now() - heartbeatStart;

    // Determine structured status
    const isOk = text === "HEARTBEAT_OK" || text.startsWith("HEARTBEAT_OK");
    const heartbeatStatus: "ok" | "alert" = isOk ? "ok" : "alert";

    // Tag the text part with structured heartbeat status
    tagHeartbeatStatus(db, result.messageId, heartbeatStatus);

    if (isOk) {
      logger.info("heartbeat_ok", {
        event: "heartbeat_ok",
        slug: instanceSlug,
        agentId: agent.id,
        durationMs,
      });
      return;
    }

    // Alert: agent has something to report
    logger.info("heartbeat_alert", {
      event: "heartbeat_alert",
      slug: instanceSlug,
      agentId: agent.id,
      durationMs,
    });
    bus.publish(HeartbeatAlert, {
      agentId: agent.id,
      instanceSlug,
      text: text.slice(0, ackMaxChars),
    });
  } catch (err) {
    // Don't crash the runner — publish an alert instead
    logger.error("heartbeat_error", {
      event: "heartbeat_error",
      slug: instanceSlug,
      agentId: agent.id,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - heartbeatStart,
    });
    bus.publish(HeartbeatAlert, {
      agentId: agent.id,
      instanceSlug,
      text: `Heartbeat error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Tag the text part of a heartbeat message with a structured status.
 * Stores `{"heartbeat_status": "ok"|"alert"|"error"}` in `rt_parts.metadata`.
 */
function tagHeartbeatStatus(
  db: Database.Database,
  messageId: string,
  status: "ok" | "alert" | "error",
): void {
  try {
    db.prepare(
      `UPDATE rt_parts
       SET metadata = ?, updated_at = datetime('now')
       WHERE message_id = ? AND type = 'text'`,
    ).run(JSON.stringify({ heartbeat_status: status }), messageId);
  } catch (err) {
    logger.debug("heartbeat_tag_status_failed", { error: String(err) });
  }
}
