/**
 * runtime/tool/send-message.ts
 *
 * Send-message tool — persistent inter-agent messaging.
 *
 * Unlike the `task` tool (transactional, result consumed and forgotten),
 * `send_message` writes into both agents' permanent sessions so that the
 * exchange survives compaction and both agents remember it.
 *
 * Two modes:
 * - expect_reply=true  (default): runs a prompt loop on the target's permanent
 *   session and returns the reply. Both sides get the full exchange in history.
 * - expect_reply=false: fire-and-forget — triggers an async prompt loop on the
 *   target's permanent session without waiting for the result.
 */

import { z } from "zod";
import type Database from "better-sqlite3";
import { Tool } from "./tool.js";
import { getOrCreatePermanentSession } from "../session/session.js";
import { createUserMessage } from "../session/message.js";
import { checkA2APolicy, resolveAgentModel } from "./task.js";
import { getBus } from "../bus/index.js";
import { AgentMessageSent } from "../bus/events.js";
import type { InstanceSlug, SessionId } from "../types.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { RuntimeConfig, RuntimeAgentConfig, ModelAlias } from "../config/index.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Prompt loop injection types (same as task.ts — avoids circular dependency)
// ---------------------------------------------------------------------------

interface SendMessagePromptLoopInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  userText: string;
  agentConfig: RuntimeAgentConfig;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  abort?: AbortSignal;
  extraSystemPrompt?: string;
  compactionConfig?: RuntimeConfig["compaction"];
  runtimeAgentConfigs?: RuntimeAgentConfig[];
}

interface SendMessagePromptLoopResult {
  text: string;
  steps: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

// ---------------------------------------------------------------------------
// Send-message tool factory
// ---------------------------------------------------------------------------

export function createSendMessageTool(options: {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  callerAgentConfig: RuntimeAgentConfig;
  runtimeAgentConfigs?: RuntimeAgentConfig[];
  modelAliases?: ModelAlias[];
  resolveTargetModel?: (agentConfig: RuntimeAgentConfig) => ResolvedModel;
  compactionConfig?: RuntimeConfig["compaction"];
  runPromptLoop: (input: SendMessagePromptLoopInput) => Promise<SendMessagePromptLoopResult>;
}): Tool.Info {
  const {
    db,
    instanceSlug,
    resolvedModel,
    workDir,
    callerAgentConfig,
    runtimeAgentConfigs,
    modelAliases,
    resolveTargetModel,
    compactionConfig,
    runPromptLoop,
  } = options;

  const description = buildDescription(callerAgentConfig, runtimeAgentConfigs);

  return Tool.define("send_message", {
    description,
    parameters: z.object({
      to: z.string().min(1).describe("Target agent ID or skill name"),
      message: z.string().min(1).describe("Message text to send"),
      expect_reply: z
        .boolean()
        .default(true)
        .describe("Wait for a reply (true) or fire-and-forget (false)"),
    }),
    async execute(params, ctx) {
      // 1. Reject self-messaging
      if (params.to === callerAgentConfig.id) {
        throw new Error(
          `Cannot send a message to yourself ('${callerAgentConfig.id}'). ` +
            `Use send_message to communicate with other agents.`,
        );
      }

      // 2. Resolve target agent config
      const targetConfig = resolveTarget(params.to, callerAgentConfig, runtimeAgentConfigs);

      // 3. A2A policy check
      const policy = checkA2APolicy(callerAgentConfig, targetConfig.id, targetConfig.archetype);
      if (!policy.allowed) throw new Error(policy.reason);

      ctx.metadata({ title: `→ ${targetConfig.id}: ${params.message.slice(0, 50)}` });

      // 4. Get target's permanent session
      const targetSession = getOrCreatePermanentSession(db, {
        instanceSlug,
        agentId: targetConfig.id,
        channel: "internal",
      });

      // 5. Record outgoing message in caller's session
      createUserMessage(db, {
        sessionId: ctx.sessionId,
        text: `[message_sent] To ${targetConfig.id}: ${params.message}`,
      });

      // 6. Publish bus event
      const bus = getBus(instanceSlug);
      bus.publish(AgentMessageSent, {
        fromAgentId: callerAgentConfig.id,
        toAgentId: targetConfig.id,
        expectReply: params.expect_reply,
        instanceSlug,
      });

      // 7. Resolve target model
      const targetModel = resolveTargetModelForMessage(
        targetConfig,
        resolvedModel,
        modelAliases,
        resolveTargetModel,
      );

      // 8. Fire-and-forget or expect-reply
      if (!params.expect_reply) {
        return fireAndForget(params, ctx, targetConfig, targetSession, targetModel, {
          db,
          instanceSlug,
          workDir,
          callerAgentConfig,
          compactionConfig,
          runtimeAgentConfigs,
          runPromptLoop,
        });
      }

      return expectReply(params, ctx, targetConfig, targetSession, targetModel, {
        db,
        instanceSlug,
        workDir,
        callerAgentConfig,
        compactionConfig,
        runtimeAgentConfigs,
        runPromptLoop,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the tool description with available peers. */
function buildDescription(
  callerAgentConfig: RuntimeAgentConfig,
  runtimeAgentConfigs?: RuntimeAgentConfig[],
): string {
  const primaryPeers = (runtimeAgentConfigs ?? []).filter((cfg) => {
    if (cfg.id === callerAgentConfig.id) return false;
    if (cfg.agentToAgent && cfg.agentToAgent.enabled === false) return false;
    return true;
  });

  const peerList = primaryPeers.map((cfg) => {
    const arch = cfg.archetype ? ` [archetype: ${cfg.archetype}]` : "";
    return `- ${cfg.id} (${cfg.name})${arch}`;
  });

  return [
    "Send a persistent message to another agent. Unlike `task` (transactional),",
    "this message stays in both agents' session history until compaction.",
    "Use this for context sharing, coordination, and ongoing collaboration.",
    "",
    "Available agents:",
    ...peerList,
    "",
    'You can also route by archetype name (e.g. to: "evaluator").',
  ].join("\n");
}

/** Resolve the target agent config by ID or archetype. */
function resolveTarget(
  to: string,
  callerAgentConfig: RuntimeAgentConfig,
  runtimeAgentConfigs?: RuntimeAgentConfig[],
): RuntimeAgentConfig {
  const targetConfig =
    (runtimeAgentConfigs ?? []).find((cfg) => cfg.id === to) ??
    (runtimeAgentConfigs ?? []).find(
      (cfg) => cfg.id !== callerAgentConfig.id && cfg.archetype != null && cfg.archetype === to,
    );

  if (!targetConfig) {
    const available = (runtimeAgentConfigs ?? [])
      .filter((cfg) => cfg.id !== callerAgentConfig.id)
      .map((cfg) => cfg.id)
      .join(", ");
    const archetypes = [
      ...new Set(
        (runtimeAgentConfigs ?? [])
          .filter((cfg) => cfg.id !== callerAgentConfig.id && cfg.archetype != null)
          .map((cfg) => cfg.archetype!),
      ),
    ].join(", ");
    throw new Error(
      `No agent found for "${to}". ` +
        (available ? `Available agents: ${available}. ` : "") +
        (archetypes ? `Available archetypes: ${archetypes}` : ""),
    );
  }

  return targetConfig;
}

/** Resolve the model for the target agent. */
function resolveTargetModelForMessage(
  targetConfig: RuntimeAgentConfig,
  fallbackModel: ResolvedModel,
  modelAliases?: ModelAlias[],
  resolveTargetModelFn?: (agentConfig: RuntimeAgentConfig) => ResolvedModel,
): ResolvedModel {
  if (resolveTargetModelFn) {
    try {
      return resolveTargetModelFn(targetConfig);
    } catch (err) {
      logger.warn("[tool:send-message] target model resolution failed", { error: String(err) });
      return fallbackModel;
    }
  }
  return targetConfig.model
    ? resolveAgentModel(targetConfig.model, modelAliases ?? [], fallbackModel)
    : fallbackModel;
}

/** Shared context for prompt loop execution. */
interface LoopContext {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  workDir: string | undefined;
  callerAgentConfig: RuntimeAgentConfig;
  compactionConfig: RuntimeConfig["compaction"] | undefined;
  runtimeAgentConfigs: RuntimeAgentConfig[] | undefined;
  runPromptLoop: (input: SendMessagePromptLoopInput) => Promise<SendMessagePromptLoopResult>;
}

/** Handle fire-and-forget mode. */
function fireAndForget(
  params: { message: string },
  _ctx: Tool.Context,
  targetConfig: RuntimeAgentConfig,
  targetSession: { id: string },
  targetModel: ResolvedModel,
  loopCtx: LoopContext,
): Tool.Result {
  const systemPrompt = [
    "## Incoming message",
    `Agent '${loopCtx.callerAgentConfig.id}' (${loopCtx.callerAgentConfig.name}) sends you this message.`,
    "Process this message autonomously.",
  ].join("\n");

  void loopCtx
    .runPromptLoop({
      db: loopCtx.db,
      instanceSlug: loopCtx.instanceSlug,
      sessionId: targetSession.id,
      userText: `[message_from:${loopCtx.callerAgentConfig.id}] ${params.message}`,
      agentConfig: targetConfig,
      resolvedModel: targetModel,
      workDir: loopCtx.workDir,
      abort: new AbortController().signal,
      extraSystemPrompt: systemPrompt,
      ...(loopCtx.compactionConfig !== undefined
        ? { compactionConfig: loopCtx.compactionConfig }
        : {}),
      ...(loopCtx.runtimeAgentConfigs !== undefined
        ? { runtimeAgentConfigs: loopCtx.runtimeAgentConfigs }
        : {}),
    })
    .catch((err) => {
      logger.error(
        `[send_message] fire-and-forget prompt loop failed for ${targetConfig.id}: ${err}`,
      );
    });

  return {
    title: `Message sent to ${targetConfig.id}`,
    output: `Message delivered to ${targetConfig.id} (fire-and-forget, processing triggered).`,
    truncated: false,
  };
}

/** Handle expect-reply mode. */
async function expectReply(
  params: { message: string },
  ctx: Tool.Context,
  targetConfig: RuntimeAgentConfig,
  targetSession: { id: string },
  targetModel: ResolvedModel,
  loopCtx: LoopContext,
): Promise<Tool.Result> {
  const systemPrompt = [
    "## Incoming message",
    `Agent '${loopCtx.callerAgentConfig.id}' (${loopCtx.callerAgentConfig.name}) sends you this message.`,
    "Respond naturally — your reply will be forwarded back.",
  ].join("\n");

  const result = await loopCtx.runPromptLoop({
    db: loopCtx.db,
    instanceSlug: loopCtx.instanceSlug,
    sessionId: targetSession.id,
    userText: `[message_from:${loopCtx.callerAgentConfig.id}] ${params.message}`,
    agentConfig: targetConfig,
    resolvedModel: targetModel,
    workDir: loopCtx.workDir,
    abort: ctx.abort,
    extraSystemPrompt: systemPrompt,
    ...(loopCtx.compactionConfig !== undefined
      ? { compactionConfig: loopCtx.compactionConfig }
      : {}),
    ...(loopCtx.runtimeAgentConfigs !== undefined
      ? { runtimeAgentConfigs: loopCtx.runtimeAgentConfigs }
      : {}),
  });

  // Record incoming reply in caller's session
  createUserMessage(loopCtx.db, {
    sessionId: ctx.sessionId,
    text: `[message_received] From ${targetConfig.id}: ${result.text}`,
  });

  const tokensTotal = result.tokens.input + result.tokens.output;
  const output = [
    `from: ${targetConfig.id} (${targetConfig.name})`,
    `steps: ${result.steps}`,
    `tokens: ${tokensTotal}`,
    "",
    "<reply>",
    result.text,
    "</reply>",
  ].join("\n");

  return {
    title: `Reply from ${targetConfig.id}`,
    output,
    truncated: false,
  };
}
