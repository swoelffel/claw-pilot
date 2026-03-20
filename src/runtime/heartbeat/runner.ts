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
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { InstanceSlug } from "../types.js";
import { getBus } from "../bus/index.js";
import { HeartbeatTick, HeartbeatAlert } from "../bus/events.js";
import { createSession, listSessions } from "../session/session.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import { parseInterval, isWithinActiveHours } from "./interval.js";
import { logger } from "../../lib/logger.js";

const HEARTBEAT_CHANNEL = "internal";
const HEARTBEAT_PEER_PREFIX = "heartbeat:";

export interface HeartbeatRunnerContext {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  resolveModel: (agentConfig: RuntimeAgentConfig) => ResolvedModel;
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
    } catch {
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
  const { db, instanceSlug, resolveModel, workDir } = ctx;
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

  // Publish tick event
  bus.publish(HeartbeatTick, { agentId: agent.id, instanceSlug });
  logger.debug("heartbeat_tick", {
    event: "heartbeat_tick",
    slug: instanceSlug,
    agentId: agent.id,
  });

  // Find or create the dedicated heartbeat session for this agent
  const peerId = `${HEARTBEAT_PEER_PREFIX}${agent.id}`;
  const existingSessions = listSessions(db, instanceSlug, { state: "active" });
  const existingSession = existingSessions.find(
    (s) => s.channel === HEARTBEAT_CHANNEL && s.peerId === peerId,
  );

  const session =
    existingSession ??
    createSession(db, {
      instanceSlug,
      agentId: agent.id,
      channel: HEARTBEAT_CHANNEL,
      peerId,
    });

  // Build the heartbeat prompt
  const prompt =
    agent.heartbeat!.prompt ??
    "Read HEARTBEAT.md if it exists and execute the tasks defined for this interval. " +
      "If nothing to do, reply exactly: HEARTBEAT_OK";

  const heartbeatStart = Date.now();
  try {
    // Resolve model (use heartbeat.model override if specified)
    let resolvedModel: ResolvedModel;
    if (agent.heartbeat!.model) {
      const slashIdx = agent.heartbeat!.model.indexOf("/");
      const providerId = agent.heartbeat!.model.slice(0, slashIdx);
      const modelId = agent.heartbeat!.model.slice(slashIdx + 1);
      // Use the same resolveModel but with a temporary agent config override
      resolvedModel = resolveModel({ ...agent, model: `${providerId}/${modelId}` });
    } else {
      resolvedModel = resolveModel(agent);
    }
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

    // Silent if HEARTBEAT_OK
    if (text === "HEARTBEAT_OK" || text.startsWith("HEARTBEAT_OK")) {
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
