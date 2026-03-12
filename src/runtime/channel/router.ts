/**
 * runtime/channel/router.ts
 *
 * ChannelRouter — receives InboundMessages from any channel, resolves or
 * creates a session, runs the prompt loop, and returns the response.
 *
 * Design:
 * - One session per (instanceSlug, channelType, peerId) — reuses existing active session
 * - Agent resolved from config (default agent if none specified)
 * - Model resolved via provider registry
 * - Errors are caught and returned as OutboundMessage with error text
 */

import type Database from "better-sqlite3";
import type { InboundMessage, OutboundMessage, InstanceSlug } from "../types.js";
import type { RuntimeConfig } from "../config/index.js";
import { createSession, listSessions } from "../session/session.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import { getAgent, defaultAgentName } from "../agent/registry.js";
import { resolveModel } from "../provider/provider.js";
import { getBus } from "../bus/index.js";
import { ChannelMessageReceived, ChannelMessageSent } from "../bus/events.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RouterInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  config: RuntimeConfig;
  message: InboundMessage;
  /** Optional agent override (defaults to defaultAgentName()) */
  agentId?: string;
  /** Working directory for tool execution */
  workDir?: string;
  /** AbortSignal to cancel the loop */
  abort?: AbortSignal;
}

export interface RouterResult {
  response: OutboundMessage;
  /** Session ID used for this exchange */
  sessionId: string;
  /** Token usage */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
}

// ---------------------------------------------------------------------------
// ChannelRouter
// ---------------------------------------------------------------------------

export class ChannelRouter {
  /**
   * Route an inbound message through the agent loop and return the response.
   */
  static async route(input: RouterInput): Promise<RouterResult> {
    const { db, instanceSlug, config, message, workDir } = input;
    const bus = getBus(instanceSlug);

    // Emit received event
    bus.publish(ChannelMessageReceived, {
      channelType: message.channelType,
      peerId: message.peerId,
      text: message.text,
    });

    // 1. Resolve agent
    const agentId = input.agentId ?? defaultAgentName();
    const agentInfo = getAgent(agentId);
    if (!agentInfo) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Build RuntimeAgentConfig from Agent.Info + global config
    const agentConfig = buildAgentConfig(agentInfo, config);

    // 2. Resolve model
    const modelStr = agentConfig.model ?? config.defaultModel;
    const resolvedModel = resolveModelFromString(modelStr);

    // 3. Find or create session for this peer
    const sessionId = findOrCreateSession(db, instanceSlug, message);

    // 4. Run prompt loop
    const result = await runPromptLoop({
      db,
      instanceSlug,
      sessionId,
      userText: message.text,
      agentConfig,
      resolvedModel,
      workDir,
      ...(input.abort !== undefined ? { abort: input.abort } : {}),
    });

    // 5. Build outbound message
    const response: OutboundMessage = {
      channelType: message.channelType,
      peerId: message.peerId,
      ...(message.accountId !== undefined ? { accountId: message.accountId } : {}),
      text: result.text,
    };

    // Emit sent event
    bus.publish(ChannelMessageSent, {
      channelType: message.channelType,
      peerId: message.peerId,
      text: result.text,
      sessionId,
    });

    return {
      response,
      sessionId,
      tokens: result.tokens,
      costUsd: result.costUsd,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find an existing active session for this (instanceSlug, channel, peerId),
 * or create a new one.
 */
function findOrCreateSession(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  message: InboundMessage,
): string {
  const sessions = listSessions(db, instanceSlug, { state: "active" });

  const existing = sessions.find(
    (s) => s.channel === message.channelType && s.peerId === message.peerId,
  );

  if (existing) {
    return existing.id;
  }

  const session = createSession(db, {
    instanceSlug,
    agentId: defaultAgentName(),
    channel: message.channelType,
    peerId: message.peerId,
  });

  return session.id;
}

/**
 * Build a RuntimeAgentConfig from an Agent.Info (for use with runPromptLoop).
 * Fills in required fields from global config defaults.
 */
function buildAgentConfig(
  agent: ReturnType<typeof getAgent> & object,
  config: RuntimeConfig,
): import("../config/index.js").RuntimeAgentConfig {
  return {
    id: agent.name,
    name: agent.name,
    model: agent.model ?? config.defaultModel,
    systemPrompt: agent.prompt,
    temperature: agent.temperature,
    maxSteps: agent.steps ?? 20,
    allowSubAgents: true,
    toolProfile: "coding",
    isDefault: false,
    permissions: agent.permission ?? [],
  };
}

/**
 * Parse a "provider/model" string and call resolveModel.
 */
function resolveModelFromString(modelStr: string) {
  const slashIdx = modelStr.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Invalid model string (expected "provider/model"): ${modelStr}`);
  }
  const providerId = modelStr.slice(0, slashIdx);
  const modelId = modelStr.slice(slashIdx + 1);
  return resolveModel(providerId, modelId);
}
