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
 * - _prompt-loop-handlers.ts — chunk handlers, watchdog, system prompt cache, auto-compaction
 */

import { streamText, stepCountIs, hasToolCall, InvalidToolInputError } from "ai";
import type { ToolCallRepairFunction, ToolSet } from "ai";
import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { Tool } from "../tool/tool.js";
import { getToolsForAgent } from "../tool/registry.js";
import { getSession } from "./session.js";
import {
  createUserMessage,
  createAssistantMessage,
  updateMessageMetadata,
  listMessagesFromCompaction,
} from "./message.js";
import { createPart, updatePartState } from "./part.js";
import { getBus } from "../bus/index.js";
import {
  SessionStatusChanged,
  SessionSystemPromptBuilt,
  MessageCreated,
  MessageUpdated,
  PermissionReplied,
} from "../bus/events.js";
import { cacheSystemPrompt, persistSystemPromptSnapshot } from "./system-prompt-cache.js";
import { buildCoreMessages, applyCaching } from "./message-builder.js";
import { preBudgetCheck, postBudgetCheck } from "./budget-check.js";
import { normalizeTokenUsage } from "./usage-tracker.js";
import { buildToolSet } from "./tool-set-builder.js";
import type { RuntimeConfig, SubagentsConfig } from "../config/index.js";
import type { McpRegistry } from "../mcp/registry.js";
import { getAgent } from "../agent/registry.js";
// message.sending hook is now wired via bus in plugin-wiring.ts (fires on MessageCreated with role=assistant)
import type { PluginInput } from "../plugin/types.js";
import { logger } from "../../lib/logger.js";
import { getRuntimeVersion } from "../_runtime-version.js";
import {
  createStreamingState,
  finalizeReasoning,
  handleTextDelta,
  handleReasoningDelta,
  handleToolCallChunk,
  handleToolResultChunk,
  findToolPartByCallId,
  createWatchdogManager,
  buildSystemPromptWithCache,
  handleAutoCompaction,
} from "./_prompt-loop-handlers.js";

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
  /**
   * Extra tools injected into the tool set at call time, beyond what the
   * agent's `toolProfile` normally permits.
   *
   * This is the only way for callers to add tools that are NOT in `BUILTIN_TOOLS`
   * (e.g. the `complete_step` tool created by the flow engine per step run).
   * These tools are appended to the `Tool.Info[]` returned by `getToolsForAgent`
   * and wired into the tool set with the same machinery as built-ins. They are
   * invisible outside the caller that injects them — no global registration.
   */
  extraTools?: Tool.Info[];
  /**
   * Override the agent's maxSteps for this call. Takes precedence over
   * `agentConfig.maxSteps` when set (e.g. flow step sessions default to 50).
   */
  maxSteps?: number;
  /**
   * Mutable state shared with the flow engine's `request_step_extension` tool.
   * When present, the prompt loop:
   * - reads `state.effectiveMaxSteps` dynamically for the stopWhen condition
   * - injects a flow-specific reminder 2 steps before the limit (offering
   *   `complete_step` or `request_step_extension`)
   * Non-flow callers leave this `undefined`.
   */
  flowStepState?: import("../flow/step-extension-tool.js").FlowStepState;
}

export interface PromptLoopResult {
  messageId: string;
  text: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  steps: number;
}

// ---------------------------------------------------------------------------
// Tool call repair
// ---------------------------------------------------------------------------

/**
 * Auto-repair malformed tool call arguments by asking the LLM to fix them.
 *
 * When a model emits a tool call whose JSON arguments fail to parse (e.g.
 * markdown bullets instead of a JSON array, missing quotes, trailing commas),
 * the Vercel AI SDK calls this function before the step fails. We feed the
 * malformed input + the error message back to the model as a user message so
 * it can produce valid JSON on a retry step.
 *
 * This is global — it benefits every tool in every session type, not just
 * flow steps. Typical saves: `complete_step` keyFindings as markdown bullets,
 * `edit` with unescaped newlines in `new_string`, `bash` with multiline JSON.
 */
const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({ toolCall, error }) => {
  // Only attempt repair for invalid-input errors (not unknown tool names).
  if (!InvalidToolInputError.isInstance(error)) return null;

  // `toolCall.input` is the raw JSON string the model produced.
  // Common failure mode (observed on MAC run #5): the model emits markdown
  // bullets instead of a JSON array for list-valued fields like keyFindings.
  // We attempt a lightweight local fix on the raw string. If the fixed
  // string parses as valid JSON, we return it as the repaired tool call.
  // If not, we return null so the SDK surfaces the error to the model on
  // the next step, giving it a chance to self-correct.
  try {
    const raw = toolCall.input;
    // Heuristic: find any field whose value is markdown bullets instead of
    // a JSON array, and rewrap as ["item1", "item2", ...].
    const patched = raw.replace(
      /("[\w]+"\s*:\s*)\n((?:\s*[-*•]\s+.+\n?)+)/g,
      (_match, prefix: string, bullets: string) => {
        const items = bullets
          .split("\n")
          .filter((l) => /^\s*[-*•]\s+/.test(l))
          .map((l) =>
            l
              .replace(/^\s*[-*•]\s+/, "")
              .trim()
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"'),
          )
          .filter(Boolean);
        return `${prefix}[${items.map((i) => `"${i}"`).join(", ")}]`;
      },
    );
    if (patched !== raw) {
      // Validate that the patched string is valid JSON before returning.
      JSON.parse(patched);
      logger.debug("tool_call_repair_local", {
        toolName: toolCall.toolName,
        repair: "markdown-bullets-to-array",
      });
      return { ...toolCall, input: patched };
    }
  } catch (err) {
    logger.debug("tool_call_repair_local_failed", {
      toolName: toolCall.toolName,
      error: String(err),
    });
  }

  // Local fix didn't work — return null so the SDK propagates the error
  // to the model as a tool-result with the error message. The model gets
  // a new step to self-correct its JSON.
  logger.debug("tool_call_repair_deferred", {
    toolName: toolCall.toolName,
    error: String(error),
  });
  return null;
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runPromptLoop(input: PromptLoopInput): Promise<PromptLoopResult> {
  const { db, instanceSlug, sessionId, agentConfig, resolvedModel } = input;

  if (input.abort?.aborted) throw new Error("Aborted");

  const session = getSession(db, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const bus = getBus(instanceSlug);

  // Watchdog setup (agent timeout + chunk stall detection)
  const watchdog = createWatchdogManager(
    bus,
    sessionId,
    agentConfig.id,
    agentConfig.timeoutMs ?? 5 * 60 * 1000,
    agentConfig.chunkTimeoutMs ?? 120_000,
    input.abort,
  );

  bus.publish(SessionStatusChanged, { sessionId, status: "busy" });

  let assistantMsgId: string | undefined;
  const loopCost = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

  const permissionFeedbackMessages: string[] = [];
  const unsubPermission = bus.subscribe(PermissionReplied, (payload) => {
    if (payload.sessionId === sessionId && payload.action === "deny" && payload.feedback) {
      permissionFeedbackMessages.push(payload.feedback);
    }
  });

  let lastStreamError: Error | undefined;

  try {
    // 1. Create user message + permission feedback messages
    createUserMessages(input, bus, permissionFeedbackMessages);

    // 2. Build system prompt (with dirty-flag cache)
    const systemPrompt = await buildAndCacheSystemPrompt(input, session, bus);

    // 3. Load message history (batch SQL — no N+1)
    const coreMessages = buildCoreMessages(db, listMessagesFromCompaction(db, sessionId));

    // 4. Create empty assistant message
    const assistantMsg = createAssistantMessage(db, {
      sessionId,
      agentId: agentConfig.id,
      model: `${resolvedModel.providerId}/${resolvedModel.modelId}`,
    });
    assistantMsgId = assistantMsg.id;
    bus.publish(MessageCreated, {
      sessionId,
      messageId: assistantMsg.id,
      role: "assistant",
      agentId: agentConfig.id,
    });

    // 5. Build tool set
    const toolSet = await buildToolSetForLoop(input, session, assistantMsg.id, watchdog.onLongWait);

    // 6. Stream the response
    const streamResult = await executeStream({
      input,
      bus,
      systemPrompt,
      coreMessages,
      assistantMsgId: assistantMsg.id,
      toolSet,
      watchdog,
      onStreamError: (error) => {
        lastStreamError = error;
      },
    });

    // 7–9. Finalize: usage, budget, compaction
    const result = await finalizeAndReturn({
      input,
      bus,
      assistantMsgId: assistantMsg.id,
      streamState: streamResult.streamState,
      finalResult: streamResult.finalResult,
      llmCallStart: streamResult.llmCallStart,
      loopCost,
    });

    return result;
  } catch (err) {
    if (assistantMsgId) {
      updateMessageMetadata(db, assistantMsgId, { finishReason: "error" });
      bus.publish(MessageUpdated, { sessionId, messageId: assistantMsgId });
    }
    throw lastStreamError ?? err;
  } finally {
    watchdog.cleanup();
    unsubPermission();
    bus.publish(SessionStatusChanged, {
      sessionId,
      status: "idle",
      agentId: agentConfig.id,
      ...(loopCost.tokensIn !== 0 ? { tokensIn: loopCost.tokensIn } : {}),
      ...(loopCost.tokensOut !== 0 ? { tokensOut: loopCost.tokensOut } : {}),
      ...(loopCost.costUsd !== 0 ? { costUsd: loopCost.costUsd } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Private helpers (file-local, keep runPromptLoop focused)
// ---------------------------------------------------------------------------

/** Create user message + image attachments + permission feedback messages. */
function createUserMessages(
  input: PromptLoopInput,
  bus: ReturnType<typeof getBus>,
  permissionFeedbackMessages: string[],
): void {
  const { db, sessionId, userText, userMetadata } = input;
  const userMsg = createUserMessage(db, {
    sessionId,
    text: userText,
    ...(userMetadata !== undefined ? { metadata: userMetadata } : {}),
  });

  // Store image attachments as parts on the user message
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
}

/** Build system prompt, cache it, persist snapshot, and notify observers. */
async function buildAndCacheSystemPrompt(
  input: PromptLoopInput,
  session: { channel: string },
  bus: ReturnType<typeof getBus>,
): Promise<string> {
  const {
    db,
    instanceSlug,
    sessionId,
    agentConfig,
    workDir,
    agentWorkDir,
    runtimeAgents,
    userText,
    extraSystemPrompt,
    runtimeConfig,
    userProfile,
  } = input;

  const systemPrompt = await buildSystemPromptWithCache({
    instanceSlug,
    sessionId,
    agentConfig,
    channel: session.channel,
    workDir,
    ...(agentWorkDir !== undefined ? { agentWorkDir } : {}),
    ...(runtimeAgents !== undefined ? { runtimeAgents } : {}),
    userText,
    ...(extraSystemPrompt !== undefined ? { extraSystemPrompt } : {}),
    db,
    ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
    ...(userProfile !== undefined ? { userProfile } : {}),
  });

  cacheSystemPrompt(sessionId, systemPrompt);
  persistSystemPromptSnapshot(db, sessionId, systemPrompt);
  bus.publish(SessionSystemPromptBuilt, {
    sessionId,
    agentId: agentConfig.id,
    systemPrompt,
    builtAt: new Date().toISOString(),
  });

  return systemPrompt;
}

/** Build the tool set for the prompt loop. */
async function buildToolSetForLoop(
  input: PromptLoopInput,
  session: { channel: string },
  assistantMsgId: string,
  onLongWait: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<ReturnType<typeof buildToolSet>> {
  const {
    db,
    instanceSlug,
    agentConfig,
    resolvedModel,
    workDir,
    memoryDb,
    subagentsConfig,
    compactionConfig,
    mcpRegistry,
    runtimeConfig,
    resolveTargetModel,
  } = input;

  const pluginInput: PluginInput = {
    instanceSlug,
    workDir,
    version: getRuntimeVersion(),
    db,
  };

  const agentInfoForTools = getAgent(agentConfig.id);
  const agentKindForTools = agentInfoForTools?.kind ?? "primary";

  const toolInfos = await getToolsForAgent({
    toolProfile: agentConfig.toolProfile,
    ...(mcpRegistry !== undefined ? { mcpRegistry } : {}),
    pluginInput,
    agentKind: agentKindForTools,
  });

  // Append caller-provided tools (e.g. the flow engine's `complete_step`).
  // These are not part of `BUILTIN_TOOLS`, so they can only enter the tool
  // set through this explicit injection — guaranteeing they stay scoped to
  // the sessions their creator intends.
  if (input.extraTools && input.extraTools.length > 0) {
    toolInfos.push(...input.extraTools);
  }

  const toolCtx: Tool.Context = {
    sessionId: input.sessionId,
    messageId: assistantMsgId,
    agentId: agentConfig.id,
    instanceSlug,
    channel: session.channel,
    abort: input.abort ?? new AbortController().signal,
    senderIsOwner: session.channel !== "internal",
    onLongWait,
    ...(workDir !== undefined ? { workDir } : {}),
    agentConfig,
    metadata: (_meta) => {},
  };

  return buildToolSet(
    toolInfos,
    toolCtx,
    db,
    assistantMsgId,
    instanceSlug,
    input.sessionId,
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
}

/** Build Anthropic provider options (thinking config + system caching). */
function buildProviderOptions(
  systemProviderOptions: Record<string, unknown> | undefined,
  agentConfig: RuntimeAgentConfig,
  resolvedModel: ResolvedModel,
): Record<string, Record<string, import("ai").JSONValue>> | undefined {
  const anthropicProviderOpts: Record<string, import("ai").JSONValue> = {
    ...(systemProviderOptions?.["anthropic"] as Record<string, import("ai").JSONValue> | undefined),
  };
  if (agentConfig.thinking?.enabled && resolvedModel.providerId === "anthropic") {
    anthropicProviderOpts["thinking"] = {
      type: "enabled",
      budgetTokens: agentConfig.thinking.budgetTokens ?? 10_000,
    } as unknown as import("ai").JSONValue;
  }
  return Object.keys(anthropicProviderOpts).length > 0
    ? { anthropic: anthropicProviderOpts }
    : undefined;
}

// ---------------------------------------------------------------------------
// Stream execution
// ---------------------------------------------------------------------------

interface ExecuteStreamInput {
  input: PromptLoopInput;
  bus: ReturnType<typeof getBus>;
  systemPrompt: string;
  coreMessages: ReturnType<typeof buildCoreMessages>;
  assistantMsgId: string;
  toolSet: Awaited<ReturnType<typeof buildToolSet>>;
  watchdog: import("./_prompt-loop-handlers.js").WatchdogManager;
  onStreamError: (error: Error) => void;
}

interface ExecuteStreamResult {
  streamState: import("./_prompt-loop-handlers.js").StreamingState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finalResult: any;
  llmCallStart: number;
}

/** Execute the streamText call and return the final result + accumulated state. */
async function executeStream(opts: ExecuteStreamInput): Promise<ExecuteStreamResult> {
  const { input, bus, systemPrompt, coreMessages, assistantMsgId, toolSet, watchdog } = opts;
  const { db, agentConfig, resolvedModel, instanceSlug } = input;

  const streamState = createStreamingState();

  const INTERACTIVE_STEPS_REMINDER =
    `\n\n<system-reminder>This is your last allowed step. ` +
    `Conclude your work, summarize what was done, and stop.</system-reminder>`;
  let completedSteps = 0;

  // --- Effective maxSteps ---
  // For flow steps: reads from the mutable `flowStepState.effectiveMaxSteps`
  // which can grow when the agent calls `request_step_extension`.
  // For interactive sessions: uses the static override or agent config.
  const getEffectiveMaxSteps = (): number =>
    input.flowStepState?.effectiveMaxSteps ?? input.maxSteps ?? agentConfig.maxSteps;

  // Flow steps get the reminder 2 steps early (time to call complete_step or
  // request_step_extension). Interactive sessions: 1 step (original behavior).
  const isFlowStep = input.flowStepState !== undefined;
  const stepsMargin = isFlowStep ? 2 : 1;

  const getEffectiveSystem = (): string => {
    const maxSt = getEffectiveMaxSteps();
    if (completedSteps < maxSt - stepsMargin) return systemPrompt;
    if (isFlowStep) {
      return (
        systemPrompt +
        `\n\n<system-reminder>You are approaching your step limit ` +
        `(${completedSteps + 1}/${maxSt}). Either call complete_step NOW to ` +
        `report your results, or call request_step_extension if you need more ` +
        `steps to finish your mission.</system-reminder>`
      );
    }
    return systemPrompt + INTERACTIVE_STEPS_REMINDER;
  };

  const {
    system: cachedSystem,
    messages: cachedMessages,
    systemProviderOptions,
  } = applyCaching(getEffectiveSystem(), coreMessages, resolvedModel.providerId);

  const providerOptions = buildProviderOptions(systemProviderOptions, agentConfig, resolvedModel);

  preBudgetCheck(db, instanceSlug, agentConfig.id);

  const chunkCtx = {
    db,
    bus,
    sessionId: input.sessionId,
    messageId: assistantMsgId,
    state: streamState,
  };

  // --- Stop conditions ---
  // Flow steps: dynamic cap (reads getEffectiveMaxSteps each time) + early
  // exit on complete_step. Interactive: static stepCountIs.
  const hasCompleteStepTool = input.extraTools?.some((t) => t.id === "complete_step") ?? false;
  const stopConditions = hasCompleteStepTool
    ? [
        ({ steps }: { steps: unknown[] }) => steps.length >= getEffectiveMaxSteps(),
        hasToolCall("complete_step"),
      ]
    : stepCountIs(getEffectiveMaxSteps());

  const llmCallStart = Date.now();
  const streamResult = streamText({
    model: resolvedModel.languageModel,
    system: cachedSystem,
    messages: cachedMessages,
    tools: toolSet,
    stopWhen: stopConditions,
    abortSignal: watchdog.fullAbort,
    experimental_repairToolCall: repairToolCall,
    ...(providerOptions !== undefined ? { providerOptions } : {}),
    onError: ({ error }) => {
      if (error instanceof Error) opts.onStreamError(error);
    },
    onStepFinish: (step) => {
      completedSteps++;
      closeToolErrorParts(db, assistantMsgId, step.content);
    },
    onChunk: async ({ chunk }) => {
      watchdog.touchChunk();
      streamState.lastChunkTime = Date.now();
      if (chunk.type === "text-delta") handleTextDelta(chunkCtx, chunk.text);
      if (chunk.type === "reasoning-delta") handleReasoningDelta(chunkCtx, chunk.text, chunk.id);
      if (chunk.type === "tool-call") {
        handleToolCallChunk(chunkCtx, {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: "input" in chunk ? chunk.input : undefined,
        });
      }
      if (chunk.type === "tool-result") {
        handleToolResultChunk(chunkCtx, {
          toolCallId: chunk.toolCallId,
          output: "output" in chunk ? chunk.output : undefined,
        });
      }
    },
  });

  const finalResult = await streamResult;

  // Finalize any trailing parts
  finalizeReasoning(db, streamState);
  if (streamState.textPartId) {
    updatePartState(db, streamState.textPartId, "completed", streamState.accumulatedText);
  }

  return { streamState, finalResult, llmCallStart };
}

// ---------------------------------------------------------------------------
// Post-stream finalization
// ---------------------------------------------------------------------------

interface FinalizeInput {
  input: PromptLoopInput;
  bus: ReturnType<typeof getBus>;
  assistantMsgId: string;
  streamState: import("./_prompt-loop-handlers.js").StreamingState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finalResult: any;
  llmCallStart: number;
  loopCost: { tokensIn: number; tokensOut: number; costUsd: number };
}

/** Process token usage, update message, run budget check, and auto-compaction. */
async function finalizeAndReturn(opts: FinalizeInput): Promise<PromptLoopResult> {
  const { input, bus, assistantMsgId, streamState, finalResult, loopCost } = opts;
  const { db, instanceSlug, sessionId, agentConfig, resolvedModel } = input;

  const usage = await finalResult.usage;
  const providerMetadata = await finalResult.providerMetadata;
  const normalized = normalizeTokenUsage(usage, providerMetadata, resolvedModel.providerId);
  const { input: tokensIn, output: tokensOut, cacheRead, cacheWrite } = normalized;

  const costUsd = resolvedModel.costPerMillion
    ? (tokensIn * resolvedModel.costPerMillion.input +
        tokensOut * resolvedModel.costPerMillion.output) /
      1_000_000
    : 0;

  loopCost.tokensIn = tokensIn;
  loopCost.tokensOut = tokensOut;
  loopCost.costUsd = costUsd;

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
    durationMs: Date.now() - opts.llmCallStart,
    steps: streamState.stepCount,
  });

  updateMessageMetadata(db, assistantMsgId, {
    tokensIn,
    tokensOut,
    costUsd,
    finishReason: await finalResult.finishReason,
  });
  bus.publish(MessageUpdated, { sessionId, messageId: assistantMsgId });

  postBudgetCheck(db, instanceSlug, agentConfig.id, costUsd);

  await handleAutoCompaction({
    db,
    instanceSlug,
    sessionId,
    agentConfig,
    resolvedModel,
    ...(input.internalResolvedModel !== undefined
      ? { internalResolvedModel: input.internalResolvedModel }
      : {}),
    tokensIn,
    tokensOut,
    ...(input.compactionConfig !== undefined ? { compactionConfig: input.compactionConfig } : {}),
    workDir: input.workDir,
  });

  return {
    messageId: assistantMsgId,
    text: streamState.accumulatedText,
    tokens: { input: tokensIn, output: tokensOut, cacheRead, cacheWrite },
    costUsd,
    steps: streamState.stepCount,
  };
}

/**
 * Close Path-A parts for tool-errors in a step. onChunk does not receive
 * tool-error chunks (excluded by the SDK), but StepResult.content includes
 * them. Without this, Path-A parts stay state=null forever.
 */
function closeToolErrorParts(
  db: Database.Database,
  messageId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: readonly any[],
): void {
  for (const part of content) {
    if (part.type !== "tool-error") continue;
    const toolPart = findToolPartByCallId(db, messageId, part.toolCallId);
    if (toolPart && toolPart.state == null) {
      const errMsg =
        part.error instanceof Error ? part.error.message : String(part.error ?? "unknown error");
      updatePartState(db, toolPart.id, "error", `[Tool error: ${errMsg}]`);
    }
  }
}
