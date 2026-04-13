/**
 * runtime/session/prompt-loop.ts
 *
 * The main agent loop — orchestrates LLM calls via Vercel AI SDK (streamText),
 * handles tool calls, persists messages/parts to DB, and emits bus events.
 *
 * Internal helpers are extracted to dedicated modules:
 * - message-builder.ts  — buildCoreMessages, applyCaching, applyToolOutputPruning (+ N+1 fix)
 * - usage-tracker.ts    — normalizeTokenUsage
 * - tool-set-builder.ts — buildToolSet (doom-loop, plugin hooks, task/memory injection)
 * - workspace-cache.ts  — readWorkspaceFileCached (invalidated after write/edit)
 */

import { streamText, stepCountIs } from "ai";
import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { Tool } from "../tool/tool.js";
import { getToolsForAgent } from "../tool/registry.js";
import { buildSystemPrompt, buildSkillsBlock } from "./system-prompt.js";
import { getSession } from "./session.js";
import {
  createUserMessage,
  createAssistantMessage,
  updateMessageMetadata,
  listMessagesFromCompaction,
  countMessagesSinceLastCompaction,
} from "./message.js";
import { createPart, updatePartState, listParts } from "./part.js";
import { getBus } from "../bus/index.js";
import {
  SessionStatusChanged,
  SessionSystemPromptBuilt,
  MessageCreated,
  MessageUpdated,
  MessagePartDelta,
  AgentTimeout,
  LLMChunkTimeout,
  PermissionReplied,
  ToolCallStarted,
  ToolCallEnded,
} from "../bus/events.js";
import { cacheSystemPrompt, persistSystemPromptSnapshot } from "./system-prompt-cache.js";
import {
  getCachedBasePrompt,
  cacheBasePrompt,
  isDirty,
  clearDirty,
} from "./system-prompt-dirty.js";
import { buildCoreMessages, applyCaching } from "./message-builder.js";
import { preBudgetCheck, postBudgetCheck } from "./budget-check.js";
import { normalizeTokenUsage } from "./usage-tracker.js";
import { buildToolSet } from "./tool-set-builder.js";
import { shouldCompact, compact } from "./compaction.js";
import { findModel } from "../provider/models.js";
import type { RuntimeConfig, SubagentsConfig } from "../config/index.js";
import type { McpRegistry } from "../mcp/registry.js";
import { getAgent } from "../agent/registry.js";
// message.sending hook is now wired via bus in plugin-wiring.ts (fires on MessageCreated with role=assistant)
import type { PluginInput } from "../plugin/types.js";
import { logger } from "../../lib/logger.js";
import { getRuntimeVersion } from "../_runtime-version.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface PromptLoopInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  userText: string;
  agentConfig: RuntimeAgentConfig;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  /** Resolved workspace path shown to the agent (env block). Defaults to workDir. */
  agentWorkDir?: string;
  runtimeAgents?: Array<{ id: string; name: string }>;
  abort?: AbortSignal;
  extraSystemPrompt?: string;
  compactionConfig?: RuntimeConfig["compaction"];
  memoryDb?: Database.Database;
  subagentsConfig?: SubagentsConfig;
  mcpRegistry?: McpRegistry;
  internalResolvedModel?: ResolvedModel;
  runtimeConfig?: RuntimeConfig;
  /** Injected model resolver for inter-agent calls (named key support). */
  resolveTargetModel?: (agentConfig: RuntimeAgentConfig) => ResolvedModel;
  /** User profile for dynamic injection into system prompt */
  userProfile?: import("../profile/types.js").UserProfile;
  /** Image attachments (validated by multimodal middleware) to include in user message */
  imageAttachments?: import("../types.js").InboundAttachment[];
  /**
   * Optional JSON-stringified metadata attached to the user message's text part.
   * Used e.g. for async subagent result injection so the UI can drill into
   * the sub-session via `subSessionId`.
   */
  userMetadata?: string;
}

export interface PromptLoopResult {
  messageId: string;
  text: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  steps: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runPromptLoop(input: PromptLoopInput): Promise<PromptLoopResult> {
  const {
    db,
    instanceSlug,
    sessionId,
    userText,
    agentConfig,
    resolvedModel,
    workDir,
    agentWorkDir,
    runtimeAgents,
    extraSystemPrompt,
    compactionConfig,
    memoryDb,
    subagentsConfig,
    mcpRegistry,
    internalResolvedModel,
    runtimeConfig,
    resolveTargetModel,
    userProfile,
    userMetadata,
  } = input;

  if (input.abort?.aborted) throw new Error("Aborted");

  const session = getSession(db, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const bus = getBus(instanceSlug);

  // Global watchdog — protects against runaway loops
  const TIMEOUT_MS = agentConfig.timeoutMs ?? 5 * 60 * 1000;
  const watchdogController = new AbortController();
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    bus.publish(AgentTimeout, { sessionId, agentId: agentConfig.id, timeoutMs: TIMEOUT_MS });
    watchdogController.abort();
  }, TIMEOUT_MS);

  const combinedAbort = input.abort
    ? AbortSignal.any([input.abort, watchdogController.signal])
    : watchdogController.signal;

  // Chunk timeout watchdog — protects against provider stalls
  const CHUNK_TIMEOUT_MS = agentConfig.chunkTimeoutMs ?? 120_000;
  let lastChunkTime = Date.now();
  let watchdogsPaused = 0;
  const chunkWatchdogController = new AbortController();
  const chunkWatchdogTimer = setInterval(() => {
    if (watchdogsPaused > 0) {
      // Keep lastChunkTime fresh while paused so we don't fire on resume
      lastChunkTime = Date.now();
      return;
    }
    const elapsed = Date.now() - lastChunkTime;
    if (elapsed > CHUNK_TIMEOUT_MS) {
      clearInterval(chunkWatchdogTimer);
      bus.publish(LLMChunkTimeout, { sessionId, agentId: agentConfig.id, elapsedMs: elapsed });
      chunkWatchdogController.abort();
    }
  }, 5_000);

  /**
   * Suspend both watchdogs while `fn` runs (reentrant via counter).
   * On resume, the agent watchdog is restarted with a full TIMEOUT_MS budget
   * and the chunk watchdog resumes normal stall detection.
   */
  const onLongWait = async <T>(fn: () => Promise<T>): Promise<T> => {
    watchdogsPaused++;
    // Pause the agent watchdog by clearing its timer
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = undefined;
    }
    try {
      return await fn();
    } finally {
      watchdogsPaused--;
      if (watchdogsPaused === 0) {
        // Restart agent watchdog with a fresh budget — user interaction happened
        watchdogTimer = setTimeout(() => {
          bus.publish(AgentTimeout, { sessionId, agentId: agentConfig.id, timeoutMs: TIMEOUT_MS });
          watchdogController.abort();
        }, TIMEOUT_MS);
        lastChunkTime = Date.now();
      }
    }
  };

  const fullAbort = AbortSignal.any([combinedAbort, chunkWatchdogController.signal]);

  bus.publish(SessionStatusChanged, { sessionId, status: "busy" });

  let assistantMsgId: string | undefined;
  let loopTokensIn = 0;
  let loopTokensOut = 0;
  let loopCostUsd = 0;

  const permissionFeedbackMessages: string[] = [];
  const unsubPermission = bus.subscribe(PermissionReplied, (payload) => {
    if (payload.sessionId === sessionId && payload.action === "deny" && payload.feedback) {
      permissionFeedbackMessages.push(payload.feedback);
    }
  });

  // Captures the underlying API error from streamText's onError callback
  // so we can surface it instead of the generic "No output generated" message.
  let lastStreamError: Error | undefined;

  try {
    // 1. Create user message (+ image parts if attachments present)
    const userMsg = createUserMessage(db, {
      sessionId,
      text: userText,
      ...(userMetadata !== undefined ? { metadata: userMetadata } : {}),
    });

    // Store image attachments as parts on the user message (for message-builder to pick up)
    if (input.imageAttachments && input.imageAttachments.length > 0) {
      for (const att of input.imageAttachments) {
        createPart(db, {
          messageId: userMsg.id,
          type: "image",
          content: att.data,
          metadata: JSON.stringify({
            mimeType: att.mimeType,
            ...(att.filename !== undefined ? { filename: att.filename } : {}),
            ...(att.sizeBytes !== undefined ? { sizeBytes: att.sizeBytes } : {}),
          }),
        });
      }
    }

    bus.publish(MessageCreated, { sessionId, messageId: userMsg.id, role: "user" });

    for (const feedback of permissionFeedbackMessages) {
      const feedbackMsg = createUserMessage(db, {
        sessionId,
        text: `[Permission denied] ${feedback}`,
      });
      bus.publish(MessageCreated, { sessionId, messageId: feedbackMsg.id, role: "user" });
    }
    permissionFeedbackMessages.length = 0;

    // 2. Build system prompt (with dirty-flag cache)
    let systemPrompt: string;
    const cachedBase = getCachedBasePrompt(sessionId);

    if (cachedBase && !isDirty(sessionId)) {
      // Cache hit — reuse base prompt, recalculate skills only
      const skillsBlock = workDir
        ? await buildSkillsBlock(workDir, agentConfig, userText)
        : undefined;
      systemPrompt = [cachedBase, skillsBlock, extraSystemPrompt?.trim()]
        .filter(Boolean)
        .join("\n\n");
      logger.debug(`[prompt-loop] system_prompt_cache_hit sid=${sessionId}`);
    } else {
      // Cache miss — full rebuild without skills (cached separately)
      const basePrompt = await buildSystemPrompt({
        instanceSlug,
        agentConfig,
        channel: session.channel,
        workDir,
        ...(agentWorkDir !== undefined ? { agentWorkDir } : {}),
        ...(runtimeAgents !== undefined ? { runtimeAgents } : {}),
        ...(runtimeConfig?.agents !== undefined
          ? { runtimeAgentConfigs: runtimeConfig.agents }
          : {}),
        db,
        sessionId,
        ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
        ...(userProfile !== undefined ? { userProfile } : {}),
        skipSkills: true,
      });
      cacheBasePrompt(sessionId, basePrompt);
      clearDirty(sessionId);

      const skillsBlock = workDir
        ? await buildSkillsBlock(workDir, agentConfig, userText)
        : undefined;
      systemPrompt = [basePrompt, skillsBlock, extraSystemPrompt?.trim()]
        .filter(Boolean)
        .join("\n\n");
      logger.debug(`[prompt-loop] system_prompt_cache_miss sid=${sessionId}`);
    }

    // 2b. Cache system prompt, persist snapshot, and notify observers
    cacheSystemPrompt(sessionId, systemPrompt);
    persistSystemPromptSnapshot(db, sessionId, systemPrompt);
    bus.publish(SessionSystemPromptBuilt, {
      sessionId,
      agentId: agentConfig.id,
      systemPrompt,
      builtAt: new Date().toISOString(),
    });

    // 3. Load message history (batch SQL — no N+1)
    const allMessages = listMessagesFromCompaction(db, sessionId);
    const coreMessages = buildCoreMessages(db, allMessages);

    // 4. Create empty assistant message
    const assistantMsg = createAssistantMessage(db, {
      sessionId,
      agentId: agentConfig.id,
      model: `${resolvedModel.providerId}/${resolvedModel.modelId}`,
    });
    assistantMsgId = assistantMsg.id;
    bus.publish(MessageCreated, { sessionId, messageId: assistantMsg.id, role: "assistant" });

    // 5. Build tool set
    const pluginInput: PluginInput = {
      instanceSlug,
      workDir,
      version: getRuntimeVersion(),
    };

    const agentInfoForTools = getAgent(agentConfig.id);
    const agentKindForTools = agentInfoForTools?.kind ?? "primary";

    const toolInfos = await getToolsForAgent({
      toolProfile: agentConfig.toolProfile,
      ...(mcpRegistry !== undefined ? { mcpRegistry } : {}),
      pluginInput,
      agentKind: agentKindForTools,
    });

    const senderIsOwner = session.channel !== "internal";

    const toolCtx: Tool.Context = {
      sessionId,
      messageId: assistantMsg.id,
      agentId: agentConfig.id,
      instanceSlug,
      channel: session.channel,
      abort: input.abort ?? new AbortController().signal,
      senderIsOwner,
      onLongWait,
      ...(workDir !== undefined ? { workDir } : {}),
      agentConfig,
      metadata: (_meta) => {},
    };

    const toolSet = await buildToolSet(
      toolInfos,
      toolCtx,
      db,
      assistantMsg.id,
      instanceSlug,
      sessionId,
      resolvedModel,
      memoryDb,
      workDir,
      agentConfig,
      subagentsConfig,
      compactionConfig,
      pluginInput,
      agentKindForTools,
      runPromptLoop,
      runtimeConfig?.agents,
      runtimeConfig,
      resolveTargetModel,
    );

    // 6. Stream the response
    let textPartId: string | undefined;
    let accumulatedText = "";
    // Reasoning streaming state — a new part is created per reasoning block
    // (detected via provider-assigned `id` change) and finalized when
    // a subsequent chunk of a different kind arrives (text-delta / tool-call / ...).
    let reasoningPartId: string | undefined;
    let reasoningProviderId: string | undefined;
    let accumulatedReasoning = "";
    const finalizeReasoning = (): void => {
      if (reasoningPartId) {
        updatePartState(db, reasoningPartId, "completed", accumulatedReasoning);
      }
      reasoningPartId = undefined;
      reasoningProviderId = undefined;
      accumulatedReasoning = "";
    };
    let stepCount = 0;

    const MAX_STEPS_REMINDER =
      `\n\n<system-reminder>This is your last allowed step. ` +
      `Conclude your work, summarize what was done, and stop.</system-reminder>`;
    let completedSteps = 0;

    const getEffectiveSystem = () =>
      completedSteps >= agentConfig.maxSteps - 1 ? systemPrompt + MAX_STEPS_REMINDER : systemPrompt;

    const {
      system: cachedSystem,
      messages: cachedMessages,
      systemProviderOptions,
    } = applyCaching(getEffectiveSystem(), coreMessages, resolvedModel.providerId);

    const anthropicProviderOpts: Record<string, import("ai").JSONValue> = {
      ...(systemProviderOptions?.["anthropic"] as
        | Record<string, import("ai").JSONValue>
        | undefined),
    };
    if (agentConfig.thinking?.enabled && resolvedModel.providerId === "anthropic") {
      anthropicProviderOpts["thinking"] = {
        type: "enabled",
        budgetTokens: agentConfig.thinking.budgetTokens ?? 10_000,
      } as unknown as import("ai").JSONValue;
    }
    const providerOptions: Record<string, Record<string, import("ai").JSONValue>> | undefined =
      Object.keys(anthropicProviderOpts).length > 0
        ? { anthropic: anthropicProviderOpts }
        : undefined;

    // message.sending hook now fires via bus on assistant MessageCreated (see plugin-wiring.ts)

    // Budget pre-check (belt) — block if any budget is exceeded
    preBudgetCheck(db, instanceSlug, agentConfig.id);

    const llmCallStart = Date.now();
    const streamResult = streamText({
      model: resolvedModel.languageModel,
      system: cachedSystem,
      messages: cachedMessages,
      tools: toolSet,
      stopWhen: stepCountIs(agentConfig.maxSteps),
      abortSignal: fullAbort,
      ...(providerOptions !== undefined ? { providerOptions } : {}),
      onError: ({ error }) => {
        // Capture the underlying API error (e.g. APICallError with statusCode/responseBody)
        // so we can surface it in the error response instead of the generic
        // "No output generated. Check the stream for errors." message.
        if (error instanceof Error) lastStreamError = error;
      },
      onStepFinish: (step) => {
        completedSteps++;

        // Close Path-A parts for any tool-errors in this step.
        // onChunk does not receive tool-error chunks (excluded from StreamTextOnChunkCallback
        // by the SDK), but StepResult.content includes them. Without this, Path-A parts
        // stay state=null forever and cause MissingToolResultsError on the next turn of
        // a permanent session.
        for (const part of step.content) {
          if (part.type !== "tool-error") continue;
          const parts = listParts(db, assistantMsg.id);
          const toolPart = parts.find((p) => {
            if (p.type !== "tool_call" || !p.metadata) return false;
            try {
              const meta = JSON.parse(p.metadata) as { toolCallId?: string };
              return meta.toolCallId === part.toolCallId;
            } catch (err) {
              logger.warn("[prompt-loop] JSON.parse of tool_call metadata failed", {
                error: String(err),
              });
              return false;
            }
          });
          if (toolPart && toolPart.state == null) {
            const errMsg =
              part.error instanceof Error
                ? part.error.message
                : String(part.error ?? "unknown error");
            updatePartState(db, toolPart.id, "error", `[Tool error: ${errMsg}]`);
          }
        }
      },
      onChunk: async ({ chunk }) => {
        lastChunkTime = Date.now();

        if (chunk.type === "text-delta") {
          // Transitioning to text output — finalize any in-flight reasoning part
          finalizeReasoning();
          accumulatedText += chunk.text;
          if (!textPartId) {
            const part = createPart(db, {
              messageId: assistantMsg.id,
              type: "text",
              content: chunk.text,
            });
            textPartId = part.id;
          } else {
            updatePartState(db, textPartId, "completed", accumulatedText);
          }
          if (textPartId) {
            bus.publish(MessagePartDelta, {
              sessionId,
              messageId: assistantMsg.id,
              partId: textPartId,
              delta: chunk.text,
              partType: "text",
            });
          }
        }

        if (chunk.type === "reasoning-delta") {
          // New reasoning block (different provider-assigned id) — finalize the
          // previous one if any, then create a fresh "running" part.
          if (reasoningProviderId !== chunk.id) {
            finalizeReasoning();
            reasoningProviderId = chunk.id;
            const part = createPart(db, {
              messageId: assistantMsg.id,
              type: "reasoning",
              content: chunk.text,
            });
            reasoningPartId = part.id;
            updatePartState(db, reasoningPartId, "running", chunk.text);
            accumulatedReasoning = chunk.text;
          } else {
            accumulatedReasoning += chunk.text;
            if (reasoningPartId) {
              updatePartState(db, reasoningPartId, "running", accumulatedReasoning);
            }
          }
          if (reasoningPartId) {
            bus.publish(MessagePartDelta, {
              sessionId,
              messageId: assistantMsg.id,
              partId: reasoningPartId,
              delta: chunk.text,
              partType: "reasoning",
            });
          }
        }

        if (chunk.type === "tool-call") {
          // Transitioning to tool call — finalize any in-flight reasoning part
          finalizeReasoning();
          stepCount++;
          createPart(db, {
            messageId: assistantMsg.id,
            type: "tool_call",
            metadata: JSON.stringify({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: "input" in chunk ? chunk.input : undefined,
            }),
          });
          bus.publish(ToolCallStarted, {
            sessionId,
            messageId: assistantMsg.id,
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
          });
        }

        if (chunk.type === "tool-result") {
          const parts = listParts(db, assistantMsg.id);
          const toolPart = parts.find((p) => {
            if (p.type !== "tool_call" || !p.metadata) return false;
            try {
              const meta = JSON.parse(p.metadata) as { toolCallId?: string };
              return meta.toolCallId === chunk.toolCallId;
            } catch (err) {
              logger.warn("[prompt-loop] JSON.parse of tool_result metadata failed", {
                error: String(err),
              });
              return false;
            }
          });
          if (toolPart) {
            const output =
              "output" in chunk
                ? typeof chunk.output === "string"
                  ? chunk.output
                  : JSON.stringify(chunk.output)
                : "";
            updatePartState(db, toolPart.id, "completed", output);
            try {
              const meta = JSON.parse(toolPart.metadata ?? "{}") as { toolName?: string };
              bus.publish(ToolCallEnded, {
                sessionId,
                messageId: assistantMsg.id,
                toolName: meta.toolName ?? "unknown",
                toolCallId: chunk.toolCallId,
              });
            } catch (err) {
              logger.debug("[prompt-loop] failed to publish ToolCallEnded", {
                error: String(err),
              });
            }
          }
        }
      },
    });

    const finalResult = await streamResult;

    // Finalize any trailing parts that did not have a transition chunk after them
    finalizeReasoning();
    if (textPartId) updatePartState(db, textPartId, "completed", accumulatedText);

    // 7. Token usage and cost
    const usage = await finalResult.usage;
    const providerMetadata = await finalResult.providerMetadata;
    const normalized = normalizeTokenUsage(usage, providerMetadata, resolvedModel.providerId);
    const { input: tokensIn, output: tokensOut, cacheRead, cacheWrite } = normalized;

    const costUsd = resolvedModel.costPerMillion
      ? (tokensIn * resolvedModel.costPerMillion.input +
          tokensOut * resolvedModel.costPerMillion.output) /
        1_000_000
      : 0;

    loopTokensIn = tokensIn;
    loopTokensOut = tokensOut;
    loopCostUsd = costUsd;

    // Log structured LLM call summary
    logger.info("llm_call", {
      event: "llm_call",
      slug: instanceSlug,
      agentId: agentConfig.id,
      sessionId,
      model: `${resolvedModel.providerId}/${resolvedModel.modelId}`,
      tokensIn,
      tokensOut,
      ...(cacheRead > 0 ? { cacheRead } : {}),
      ...(cacheWrite > 0 ? { cacheWrite } : {}),
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      durationMs: Date.now() - llmCallStart,
      steps: stepCount,
    });

    // 8. Update assistant message
    updateMessageMetadata(db, assistantMsg.id, {
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: await finalResult.finishReason,
    });
    bus.publish(MessageUpdated, { sessionId, messageId: assistantMsg.id });

    // 8b. Budget post-check (suspenders) — increment counter + check thresholds
    postBudgetCheck(db, instanceSlug, agentConfig.id, costUsd);

    // 9. Auto-compaction
    const effectiveCompaction = compactionConfig ?? {
      auto: true,
      threshold: 0.85,
      reservedTokens: 8_000,
      periodicMessageCount: 0,
    };
    let compactedThisTurn = false;
    if (effectiveCompaction.auto && tokensIn + tokensOut > 0) {
      const modelInfo = findModel(resolvedModel.providerId, resolvedModel.modelId);
      const contextWindow = modelInfo?.capabilities.contextWindow ?? 200_000;
      const currentTokens = tokensIn + tokensOut;
      if (
        shouldCompact({
          currentTokens,
          contextWindow,
          threshold: effectiveCompaction.threshold,
          reservedTokens: effectiveCompaction.reservedTokens,
        })
      ) {
        await compact({
          db,
          instanceSlug,
          sessionId,
          agentConfig,
          resolvedModel: internalResolvedModel ?? resolvedModel,
          currentTokens,
          contextWindow,
          ...(workDir !== undefined ? { workDir } : {}),
        });
        compactedThisTurn = true;
      }
    }

    const periodicCount = effectiveCompaction.periodicMessageCount ?? 0;
    if (!compactedThisTurn && periodicCount > 0 && agentConfig.persistence === "permanent") {
      const messagesSince = countMessagesSinceLastCompaction(db, sessionId);
      if (messagesSince >= periodicCount) {
        const modelInfo = findModel(resolvedModel.providerId, resolvedModel.modelId);
        const contextWindow = modelInfo?.capabilities.contextWindow ?? 200_000;
        await compact({
          db,
          instanceSlug,
          sessionId,
          agentConfig,
          resolvedModel: internalResolvedModel ?? resolvedModel,
          currentTokens: tokensIn + tokensOut,
          contextWindow,
          ...(workDir !== undefined ? { workDir } : {}),
        });
      }
    }

    return {
      messageId: assistantMsg.id,
      text: accumulatedText,
      tokens: { input: tokensIn, output: tokensOut, cacheRead, cacheWrite },
      costUsd,
      steps: stepCount,
    };
  } catch (err) {
    if (assistantMsgId) {
      updateMessageMetadata(db, assistantMsgId, { finishReason: "error" });
      bus.publish(MessageUpdated, { sessionId, messageId: assistantMsgId });
    }
    // If the stream captured an underlying API error (e.g. APICallError with statusCode),
    // prefer it over the generic "No output generated" wrapper.
    throw lastStreamError ?? err;
  } finally {
    clearTimeout(watchdogTimer);
    clearInterval(chunkWatchdogTimer);
    unsubPermission();
    bus.publish(SessionStatusChanged, {
      sessionId,
      status: "idle",
      agentId: agentConfig.id,
      ...(loopTokensIn !== 0 ? { tokensIn: loopTokensIn } : {}),
      ...(loopTokensOut !== 0 ? { tokensOut: loopTokensOut } : {}),
      ...(loopCostUsd !== 0 ? { costUsd: loopCostUsd } : {}),
    });
  }
}
