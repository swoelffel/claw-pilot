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
    compactionConfig,
    runPromptLoop,
  } = options;

  // Build the list of reachable primary peers for the description
  const primaryPeers: RuntimeAgentConfig[] = (runtimeAgentConfigs ?? []).filter((cfg) => {
    if (cfg.id === callerAgentConfig.id) return false;
    if (cfg.agentToAgent && cfg.agentToAgent.enabled === false) return false;
    return true;
  });

  const peerList = primaryPeers.map((cfg) => {
    const skills =
      cfg.expertIn && cfg.expertIn.length > 0 ? ` [skills: ${cfg.expertIn.join(", ")}]` : "";
    return `- ${cfg.id} (${cfg.name})${skills}`;
  });

  const description = [
    "Send a persistent message to another agent. Unlike `task` (transactional),",
    "this message stays in both agents' session history until compaction.",
    "Use this for context sharing, coordination, and ongoing collaboration.",
    "",
    "Available agents:",
    ...peerList,
    "",
    "You can also route by skill name if agents declare `expertIn`.",
  ].join("\n");

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
      // 1. Resolve target agent config
      const targetConfig =
        (runtimeAgentConfigs ?? []).find((cfg) => cfg.id === params.to) ??
        (runtimeAgentConfigs ?? []).find(
          (cfg) => cfg.id !== callerAgentConfig.id && cfg.expertIn?.includes(params.to),
        );

      if (!targetConfig) {
        const available = (runtimeAgentConfigs ?? [])
          .filter((cfg) => cfg.id !== callerAgentConfig.id)
          .map((cfg) => cfg.id)
          .join(", ");
        const skills = [
          ...new Set(
            (runtimeAgentConfigs ?? [])
              .filter((cfg) => cfg.id !== callerAgentConfig.id && cfg.expertIn?.length)
              .flatMap((cfg) => cfg.expertIn ?? []),
          ),
        ].join(", ");
        throw new Error(
          `No agent found for "${params.to}". ` +
            (available ? `Available agents: ${available}. ` : "") +
            (skills ? `Available skills: ${skills}` : ""),
        );
      }

      // 2. A2A policy check
      const policy = checkA2APolicy(callerAgentConfig, targetConfig.id);
      if (!policy.allowed) {
        throw new Error(policy.reason);
      }

      ctx.metadata({ title: `→ ${targetConfig.id}: ${params.message.slice(0, 50)}` });

      // 3. Get target's permanent session
      const targetSession = getOrCreatePermanentSession(db, {
        instanceSlug,
        agentId: targetConfig.id,
        channel: "internal",
      });

      // 4. Record outgoing message in caller's session (for memory persistence)
      createUserMessage(db, {
        sessionId: ctx.sessionId,
        text: `[message_sent] To ${targetConfig.id}: ${params.message}`,
      });

      // 5. Publish bus event
      const bus = getBus(instanceSlug);
      bus.publish(AgentMessageSent, {
        fromAgentId: callerAgentConfig.id,
        toAgentId: targetConfig.id,
        expectReply: params.expect_reply,
        instanceSlug,
      });

      // 6. Resolve target model (needed for both fire-and-forget and expect-reply)
      const targetModel: ResolvedModel = targetConfig.model
        ? resolveAgentModel(targetConfig.model, modelAliases ?? [], resolvedModel)
        : resolvedModel;

      // 7. Fire-and-forget mode — trigger async prompt loop without waiting
      if (!params.expect_reply) {
        const fireAndForgetSystemPrompt = [
          "## Incoming message",
          `Agent '${callerAgentConfig.id}' (${callerAgentConfig.name}) sends you this message.`,
          "Process this message autonomously.",
        ].join("\n");

        void runPromptLoop({
          db,
          instanceSlug,
          sessionId: targetSession.id,
          userText: `[message_from:${callerAgentConfig.id}] ${params.message}`,
          agentConfig: targetConfig,
          resolvedModel: targetModel,
          workDir,
          abort: new AbortController().signal,
          extraSystemPrompt: fireAndForgetSystemPrompt,
          ...(compactionConfig !== undefined ? { compactionConfig } : {}),
          ...(runtimeAgentConfigs !== undefined ? { runtimeAgentConfigs } : {}),
        }).catch((err) => {
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

      // 8. Expect reply: run prompt loop on target's permanent session
      const extraSystemPrompt = [
        "## Incoming message",
        `Agent '${callerAgentConfig.id}' (${callerAgentConfig.name}) sends you this message.`,
        "Respond naturally — your reply will be forwarded back.",
      ].join("\n");

      const result = await runPromptLoop({
        db,
        instanceSlug,
        sessionId: targetSession.id,
        userText: `[message_from:${callerAgentConfig.id}] ${params.message}`,
        agentConfig: targetConfig,
        resolvedModel: targetModel,
        workDir,
        abort: ctx.abort,
        extraSystemPrompt,
        ...(compactionConfig !== undefined ? { compactionConfig } : {}),
        ...(runtimeAgentConfigs !== undefined ? { runtimeAgentConfigs } : {}),
      });

      // 9. Record incoming reply in caller's session
      createUserMessage(db, {
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
    },
  });
}
