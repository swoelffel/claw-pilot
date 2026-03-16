/**
 * runtime/session/prompt-loop.ts
 *
 * The main agent loop — orchestrates LLM calls via Vercel AI SDK (streamText),
 * handles tool calls, persists messages/parts to DB, and emits bus events.
 *
 * Design decisions:
 * - The caller resolves the model + API key (no key resolution here)
 * - stopWhen: stepCountIs(maxSteps) handles the tool call → response loop
 * - Compaction is triggered automatically after each LLM call when the context
 *   approaches the model's context window limit (configurable via compaction config)
 */

import { createRequire } from "node:module";
import {
  streamText,
  stepCountIs,
  zodSchema,
  tool as aiTool,
  type ModelMessage,
  type ToolSet,
  type ToolResultPart,
} from "ai";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { Tool } from "../tool/tool.js";
import { getTools } from "../tool/registry.js";
import { normalizeForProvider } from "../tool/normalize.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getSession } from "./session.js";
import {
  createUserMessage,
  createAssistantMessage,
  updateMessageMetadata,
  listMessagesFromCompaction,
} from "./message.js";
import { createPart, updatePartState, listParts } from "./part.js";
import { getBus } from "../bus/index.js";
import {
  SessionStatusChanged,
  MessageCreated,
  MessageUpdated,
  MessagePartDelta,
  DoomLoopDetected,
  AgentTimeout,
  LLMChunkTimeout,
  PermissionReplied,
} from "../bus/events.js";
import type { MessageInfo } from "./message.js";
import { shouldCompact, compact } from "./compaction.js";
import { findModel } from "../provider/models.js";
import type { RuntimeConfig, SubagentsConfig } from "../config/index.js";
import type { McpRegistry } from "../mcp/registry.js";
import { createMemorySearchTool } from "../memory/search-tool.js";
import { rebuildMemoryIndex } from "../memory/index.js";
import { createTaskTool } from "../tool/task.js";
import {
  triggerToolBeforeCall,
  triggerToolAfterCall,
  triggerMessageSending,
  getRegisteredHooks,
} from "../plugin/hooks.js";
import type { PluginInput } from "../plugin/types.js";

// createRequire for synchronous JSON loading (package.json version)
const _moduleRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface PromptLoopInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  /** User message text */
  userText: string;
  /** Agent config (resolved by the caller) */
  agentConfig: RuntimeAgentConfig;
  /** Resolved model (language model + cost info) */
  resolvedModel: ResolvedModel;
  /** Working directory of the instance (for system-prompt + tools) */
  workDir: string | undefined;
  /** All agents configured in this runtime instance (for teammates block in system prompt) */
  runtimeAgents?: Array<{ id: string; name: string }>;
  /** AbortSignal to cancel the loop */
  abort?: AbortSignal;
  /**
   * Extra content appended to the system prompt (after BEHAVIOR_BLOCK).
   * Used by the Task tool to inject subagent context (parent agent, task description, depth).
   */
  extraSystemPrompt?: string;
  /**
   * Compaction settings from the runtime config.
   * If provided, automatic compaction is triggered after each LLM call when the
   * context approaches the model's context window limit.
   */
  compactionConfig?: RuntimeConfig["compaction"];
  /**
   * Open memory index database (FTS5).
   * If provided, the memory_search tool is injected into the tool set.
   * Created by openMemoryIndex() in runtime/memory/index.ts.
   */
  memoryDb?: Database.Database;
  /**
   * Sub-agents spawn limits (from runtime config).
   * Forwarded to the task tool for depth/children enforcement.
   */
  subagentsConfig?: SubagentsConfig;
  /**
   * MCP registry — if provided, MCP tools are injected into the tool set.
   * Initialized by ClawRuntime.start() when mcpEnabled is true.
   */
  mcpRegistry?: McpRegistry;
  /**
   * Resolved model to use for internal operations (compaction, title, summary).
   * If provided, overrides resolvedModel for compaction calls.
   * Allows using a cheaper/faster model for these simple tasks.
   */
  internalResolvedModel?: ResolvedModel;
}

export interface PromptLoopResult {
  /** ID of the created assistant message */
  messageId: string;
  /** Final response text (concatenation of TextParts) */
  text: string;
  /** Token counts */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Estimated cost in USD */
  costUsd: number;
  /** Number of tool call steps performed */
  steps: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Execute the agent loop for a user message.
 */
export async function runPromptLoop(input: PromptLoopInput): Promise<PromptLoopResult> {
  const {
    db,
    instanceSlug,
    sessionId,
    userText,
    agentConfig,
    resolvedModel,
    workDir,
    runtimeAgents,
    extraSystemPrompt,
    compactionConfig,
    memoryDb,
    subagentsConfig,
    mcpRegistry,
    internalResolvedModel,
  } = input;

  // Abort check before starting
  if (input.abort?.aborted) {
    throw new Error("Aborted");
  }

  // Validate session exists
  const session = getSession(db, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const bus = getBus(instanceSlug);

  // Watchdog: abort the loop if it exceeds timeoutMs (default 5 min)
  const TIMEOUT_MS = agentConfig.timeoutMs ?? 5 * 60 * 1000;
  const watchdogController = new AbortController();
  const watchdogTimer = setTimeout(() => {
    bus.publish(AgentTimeout, { sessionId, agentId: agentConfig.id, timeoutMs: TIMEOUT_MS });
    watchdogController.abort();
  }, TIMEOUT_MS);

  // Combine watchdog abort with optional caller abort
  const combinedAbort = input.abort
    ? AbortSignal.any([input.abort, watchdogController.signal])
    : watchdogController.signal;

  // Chunk timeout watchdog: abort if no SSE chunk is received within CHUNK_TIMEOUT_MS.
  // Prevents sessions from hanging indefinitely when the LLM provider stalls.
  const CHUNK_TIMEOUT_MS = agentConfig.chunkTimeoutMs ?? 120_000;
  let lastChunkTime = Date.now();
  const chunkWatchdogController = new AbortController();
  const chunkWatchdogTimer = setInterval(() => {
    const elapsed = Date.now() - lastChunkTime;
    if (elapsed > CHUNK_TIMEOUT_MS) {
      bus.publish(LLMChunkTimeout, {
        sessionId,
        agentId: agentConfig.id,
        elapsedMs: elapsed,
      });
      chunkWatchdogController.abort();
    }
  }, 5_000);

  // Combine all abort signals: caller, watchdog, chunk timeout
  const fullAbort = AbortSignal.any([combinedAbort, chunkWatchdogController.signal]);

  // Emit busy status
  bus.publish(SessionStatusChanged, { sessionId, status: "busy" });

  let assistantMsgId: string | undefined;

  // Declared before try so they are accessible in finally for agent.end hook
  let loopTokensIn = 0;
  let loopTokensOut = 0;
  let loopCostUsd = 0;

  // Subscribe to PermissionReplied events for this session.
  // When a permission is denied with feedback, inject the feedback as a user message
  // so the agent receives context about why the action was blocked.
  const permissionFeedbackMessages: string[] = [];
  const unsubPermission = bus.subscribe(PermissionReplied, (payload) => {
    if (payload.sessionId === sessionId && payload.action === "deny" && payload.feedback) {
      permissionFeedbackMessages.push(payload.feedback);
    }
  });

  try {
    // 1. Create user message
    const userMsg = createUserMessage(db, { sessionId, text: userText });
    bus.publish(MessageCreated, { sessionId, messageId: userMsg.id, role: "user" });

    // Inject any pending permission feedback messages as user messages
    // (collected from PermissionReplied events before the loop started)
    for (const feedback of permissionFeedbackMessages) {
      const feedbackMsg = createUserMessage(db, {
        sessionId,
        text: `[Permission denied] ${feedback}`,
      });
      bus.publish(MessageCreated, { sessionId, messageId: feedbackMsg.id, role: "user" });
    }
    permissionFeedbackMessages.length = 0;

    // 2. Build system prompt
    const systemPrompt = await buildSystemPrompt({
      instanceSlug,
      agentConfig,
      channel: session.channel,
      workDir,
      ...(runtimeAgents !== undefined ? { runtimeAgents } : {}),
      ...(extraSystemPrompt !== undefined ? { extraSystemPrompt } : {}),
    });

    // 3. Load message history (from last compaction if any, for selective context loading)
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

    // 5. Load tools (apply toolProfile from agent config, inject MCP tools if registry provided)
    // Build pluginInput for plugin hooks (tools, tool.definition, etc.)
    const pluginInput: PluginInput = {
      instanceSlug,
      workDir,
      version: _getRuntimeVersion(),
    };

    const toolInfos = await getTools({
      toolProfile: agentConfig.toolProfile,
      ...(mcpRegistry !== undefined ? { mcpRegistry } : {}),
      pluginInput,
    });

    // Owner channels (web, telegram) have access to ownerOnly tools; internal sub-agents do not
    const senderIsOwner = session.channel !== "internal";

    const toolCtx: Tool.Context = {
      sessionId,
      messageId: assistantMsg.id,
      agentId: agentConfig.id,
      abort: input.abort ?? new AbortController().signal,
      senderIsOwner,
      metadata: (_meta) => {
        // Phase 2: update part metadata
      },
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
    );

    // 6. Stream the response
    let textPartId: string | undefined;
    let accumulatedText = "";
    let stepCount = 0;

    // Max-steps reminder: appended to the system prompt when the last step is reached,
    // so the LLM concludes gracefully instead of cutting off mid-task.
    // We track the step count via onStepFinish and rebuild the effective system prompt.
    const MAX_STEPS_REMINDER =
      `\n\n<system-reminder>This is your last allowed step. ` +
      `Conclude your work, summarize what was done, and stop.</system-reminder>`;
    let completedSteps = 0;

    // Effective system prompt — updated to include reminder before the last step
    const getEffectiveSystem = () =>
      completedSteps >= agentConfig.maxSteps - 1 ? systemPrompt + MAX_STEPS_REMINDER : systemPrompt;

    // Apply prompt caching for Anthropic (no-op for other providers)
    const {
      system: cachedSystem,
      messages: cachedMessages,
      systemProviderOptions,
    } = applyCaching(getEffectiveSystem(), coreMessages, resolvedModel.providerId);

    // Build provider-specific options (extended thinking + system caching for Anthropic)
    // ProviderOptions values must be JSONObject — cast via unknown to satisfy exactOptionalPropertyTypes
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

    // Trigger message.sending plugin hook before streaming
    const lastUserContent = [...coreMessages]
      .reverse()
      .find((m: ModelMessage) => m.role === "user");
    const sendingText =
      lastUserContent && typeof lastUserContent.content === "string"
        ? lastUserContent.content
        : userText;
    await triggerMessageSending({
      instanceSlug,
      sessionId,
      messageId: userMsg.id,
      role: "user",
      text: sendingText,
    }).catch((err) => {
      console.warn("[claw-runtime] plugin hook message.sending threw:", err);
    });

    const streamResult = streamText({
      model: resolvedModel.languageModel,
      system: cachedSystem,
      messages: cachedMessages,
      tools: toolSet,
      stopWhen: stepCountIs(agentConfig.maxSteps),
      abortSignal: fullAbort,
      ...(providerOptions !== undefined ? { providerOptions } : {}),
      onStepFinish: () => {
        completedSteps++;
      },
      onChunk: async ({ chunk }) => {
        // Reset chunk timeout watchdog on every received chunk
        lastChunkTime = Date.now();

        if (chunk.type === "text-delta") {
          accumulatedText += chunk.text;

          if (!textPartId) {
            // Create the text part on first delta
            const part = createPart(db, {
              messageId: assistantMsg.id,
              type: "text",
              content: chunk.text,
            });
            textPartId = part.id;
          } else {
            // Update existing text part with accumulated content
            updatePartState(db, textPartId, "completed", accumulatedText);
          }

          // Emit delta event for streaming to clients
          if (textPartId) {
            bus.publish(MessagePartDelta, {
              sessionId,
              messageId: assistantMsg.id,
              partId: textPartId,
              delta: chunk.text,
            });
          }
        }

        if (chunk.type === "tool-call") {
          stepCount++;
          // Create a tool_call part in "running" state
          createPart(db, {
            messageId: assistantMsg.id,
            type: "tool_call",
            metadata: JSON.stringify({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: "input" in chunk ? chunk.input : undefined,
            }),
          });
        }

        if (chunk.type === "tool-result") {
          // Find the matching tool_call part and update it to "completed"
          const parts = listParts(db, assistantMsg.id);
          const toolPart = parts.find((p) => {
            if (p.type !== "tool_call" || !p.metadata) return false;
            try {
              const meta = JSON.parse(p.metadata) as { toolCallId?: string };
              return meta.toolCallId === chunk.toolCallId;
            } catch {
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
          }
        }
      },
    });

    // Await the full stream to complete
    const finalResult = await streamResult;

    // Finalize text part state
    if (textPartId) {
      updatePartState(db, textPartId, "completed", accumulatedText);
    }

    // 7. Extract token usage and cost
    const usage = await finalResult.usage;
    const providerMetadata = await finalResult.providerMetadata;
    const normalized = normalizeTokenUsage(usage, providerMetadata, resolvedModel.providerId);
    const tokensIn = normalized.input;
    const tokensOut = normalized.output;
    const cacheRead = normalized.cacheRead;
    const cacheWrite = normalized.cacheWrite;

    const costUsd = resolvedModel.costPerMillion
      ? (tokensIn * resolvedModel.costPerMillion.input +
          tokensOut * resolvedModel.costPerMillion.output) /
        1_000_000
      : 0;

    // Assign to outer-scope variables for use in finally (agent.end hook)
    loopTokensIn = tokensIn;
    loopTokensOut = tokensOut;
    loopCostUsd = costUsd;

    // 8. Update assistant message with metadata
    updateMessageMetadata(db, assistantMsg.id, {
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: await finalResult.finishReason,
    });

    bus.publish(MessageUpdated, { sessionId, messageId: assistantMsg.id });

    // 9. Auto-compaction: trigger if context approaches the model's window limit
    const effectiveCompaction = compactionConfig ?? {
      auto: true,
      threshold: 0.85,
      reservedTokens: 8_000,
    };
    if (effectiveCompaction.auto && tokensIn + tokensOut > 0) {
      const modelInfo = findModel(resolvedModel.providerId, resolvedModel.modelId);
      const contextWindow = modelInfo?.capabilities.contextWindow ?? 100_000;
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
    // Update assistant message with error finish reason if it was created
    if (assistantMsgId) {
      updateMessageMetadata(db, assistantMsgId, { finishReason: "error" });
      bus.publish(MessageUpdated, { sessionId, messageId: assistantMsgId });
    }
    throw err;
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Runtime version helper
// ---------------------------------------------------------------------------

/**
 * Read the runtime version from package.json.
 * Uses _moduleRequire (createRequire) for synchronous JSON loading in ESM context.
 * Cached after first read. Falls back to "unknown" if unreadable.
 */
let _cachedRuntimeVersion: string | undefined;
function _getRuntimeVersion(): string {
  if (_cachedRuntimeVersion !== undefined) return _cachedRuntimeVersion;
  let version = "unknown";
  try {
    const pkg = _moduleRequire("../../../../package.json") as { version?: string };
    version = pkg.version ?? "unknown";
  } catch {
    // intentionally ignored — version stays "unknown"
  }
  _cachedRuntimeVersion = version;
  return version;
}

// ---------------------------------------------------------------------------
// Prompt caching (Anthropic)
// ---------------------------------------------------------------------------

/**
 * Apply Anthropic prompt caching markers to system prompt and messages.
 *
 * For Anthropic providers, marks the system prompt and the last 2 non-system
 * messages with `cacheControl: { type: "ephemeral" }` to enable prompt caching.
 * This reduces input token costs by 50-70% for repeated context.
 *
 * For non-Anthropic providers, returns the inputs unchanged.
 */
function applyCaching(
  systemPrompt: string,
  messages: ModelMessage[],
  providerId: string,
): { system: string; messages: ModelMessage[]; systemProviderOptions?: Record<string, unknown> } {
  if (providerId !== "anthropic") {
    return { system: systemPrompt, messages };
  }

  // Mark the last 2 non-system messages for caching (stable recent history)
  const nonSystemIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && msg.role !== "system") {
      nonSystemIndices.push(i);
    }
  }
  const indicesToCache = nonSystemIndices.slice(-2);

  const cachedMessages = messages.map((msg, i) => {
    if (!indicesToCache.includes(i) || !msg) return msg;

    // Convert string content to array with cacheControl
    if (typeof msg.content === "string") {
      return {
        ...msg,
        content: [
          {
            type: "text" as const,
            text: msg.content,
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
        ],
      };
    }

    // For array content, mark the last text part
    if (Array.isArray(msg.content) && msg.content.length > 0) {
      const contentCopy = [...msg.content];
      const lastIdx = contentCopy.length - 1;
      const lastPart = contentCopy[lastIdx];
      if (lastPart && lastPart.type === "text") {
        contentCopy[lastIdx] = {
          ...lastPart,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        };
      }
      return { ...msg, content: contentCopy };
    }

    return msg;
  });

  // System prompt caching: pass via providerOptions at the streamText level
  return {
    system: systemPrompt,
    // Cast needed: providerOptions on content parts is valid Vercel AI SDK v6 but
    // not reflected in the ModelMessage union type — safe at runtime
    messages: cachedMessages as ModelMessage[],
    systemProviderOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}

// ---------------------------------------------------------------------------
// Token usage normalization
// ---------------------------------------------------------------------------

/**
 * Normalize token usage across providers.
 *
 * In Vercel AI SDK v6, `usage.inputTokens` and `usage.outputTokens` are plain numbers.
 * Provider-specific metadata (cacheRead, cacheWrite) is available via `providerMetadata`.
 *
 * Anthropic excludes cached tokens from inputTokens, while OpenAI includes them.
 * This function produces a consistent "real input tokens" count for cost calculation.
 */
function normalizeTokenUsage(
  usage: import("ai").LanguageModelUsage,
  providerMetadata: import("ai").ProviderMetadata | undefined,
  providerId: string,
): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const rawInput = usage.inputTokens ?? 0;
  const rawOutput = usage.outputTokens ?? 0;

  // Extract cache token counts from Anthropic provider metadata
  const anthropicMeta = providerMetadata?.["anthropic"] as
    | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
    | undefined;
  const cacheRead = anthropicMeta?.cacheReadInputTokens ?? 0;
  const cacheWrite = anthropicMeta?.cacheCreationInputTokens ?? 0;

  if (providerId === "anthropic") {
    // Anthropic: inputTokens excludes cached tokens — add them back for real cost
    return {
      input: rawInput + cacheRead + cacheWrite,
      output: rawOutput,
      cacheRead,
      cacheWrite,
    };
  }

  return {
    input: rawInput,
    output: rawOutput,
    cacheRead,
    cacheWrite,
  };
}

// ---------------------------------------------------------------------------
// Memory file detection (for re-indexation trigger)
// ---------------------------------------------------------------------------

/**
 * Returns true if the given file path is a memory file that should trigger
 * a memory index rebuild when written (MEMORY.md or memory/*.md).
 */
function isMemoryFile(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? "";
  const parentDir = filePath.split("/").slice(-2, -1)[0] ?? "";
  return basename === "MEMORY.md" || (parentDir === "memory" && basename.endsWith(".md"));
}

// ---------------------------------------------------------------------------
// Tool output pruning
// ---------------------------------------------------------------------------

/**
 * Maximum total characters of tool outputs to keep in the LLM context.
 * Older tool outputs beyond this limit are replaced with "[output pruned]".
 * Data remains intact in the DB — only the LLM representation is trimmed.
 */
const PRUNE_PROTECT_CHARS = 40_000;

/**
 * Minimum total characters of tool outputs before pruning is triggered.
 * Below this threshold, no pruning is applied.
 */
const PRUNE_MINIMUM_CHARS = 20_000;

/**
 * Apply tool output pruning to a list of ModelMessages.
 *
 * If the total size of tool outputs exceeds PRUNE_PROTECT_CHARS, the oldest
 * tool results are replaced with "[output pruned]" until the total fits within
 * the limit. The most recent tool outputs are always preserved.
 *
 * DB data is never modified — only the in-memory representation sent to the LLM.
 */
function applyToolOutputPruning(messages: ModelMessage[]): ModelMessage[] {
  // Collect all tool-result parts with their position and char count
  type ToolResultRef = { msgIndex: number; partIndex: number; chars: number };
  const toolResults: ToolResultRef[] = [];
  let totalChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    const parts = Array.isArray(msg.content) ? msg.content : [];
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (
        part &&
        part.type === "tool-result" &&
        part.output &&
        typeof part.output === "object" &&
        "value" in part.output &&
        typeof part.output.value === "string"
      ) {
        const chars = part.output.value.length;
        toolResults.push({ msgIndex: i, partIndex: j, chars });
        totalChars += chars;
      }
    }
  }

  // Below minimum threshold — no pruning needed
  if (totalChars <= PRUNE_MINIMUM_CHARS) return messages;

  // Deep-clone messages to avoid mutating the original array
  const pruned = messages.map((msg) => {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) return msg;
    return { ...msg, content: msg.content.map((p) => ({ ...p })) };
  }) as ModelMessage[];

  // Prune oldest tool outputs until total fits within PRUNE_PROTECT_CHARS
  let remaining = totalChars;
  for (const ref of toolResults) {
    if (remaining <= PRUNE_PROTECT_CHARS) break;

    const msg = pruned[ref.msgIndex];
    if (!msg || msg.role !== "tool" || !Array.isArray(msg.content)) continue;

    const part = msg.content[ref.partIndex];
    if (
      part &&
      part.type === "tool-result" &&
      part.output &&
      typeof part.output === "object" &&
      "value" in part.output &&
      typeof part.output.value === "string"
    ) {
      remaining -= ref.chars;
      (part.output as { type: string; value: string }).value = "[output pruned]";
    }
  }

  return pruned;
}

// ---------------------------------------------------------------------------
// Core message builder
// ---------------------------------------------------------------------------

/**
 * Convert DB messages + their parts to Vercel AI SDK ModelMessage[].
 */
function buildCoreMessages(db: Database.Database, messages: MessageInfo[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    const parts = listParts(db, msg.id);

    if (msg.role === "user") {
      // Concatenate text parts
      const text = parts
        .filter((p) => p.type === "text")
        .map((p) => p.content ?? "")
        .join("\n");
      if (text) {
        result.push({ role: "user", content: text });
      }
    } else {
      // Assistant: reconstruct from text + tool parts
      // "compaction" parts are treated as text — they carry the compaction summary
      const textParts = parts.filter((p) => p.type === "text" || p.type === "compaction");
      const toolCallParts = parts.filter((p) => p.type === "tool_call");

      if (toolCallParts.length === 0) {
        // Simple text response
        const text = textParts.map((p) => p.content ?? "").join("\n");
        if (text) {
          result.push({ role: "assistant", content: text });
        }
      } else {
        // Mixed text + tool calls — build content array
        const contentParts: Array<
          | { type: "text"; text: string }
          | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
        > = [];

        for (const tp of textParts) {
          if (tp.content) {
            contentParts.push({ type: "text", text: tp.content });
          }
        }

        for (const tcp of toolCallParts) {
          if (tcp.metadata) {
            try {
              const meta = JSON.parse(tcp.metadata) as {
                toolCallId?: string;
                toolName?: string;
                args?: unknown;
              };
              if (meta.toolCallId && meta.toolName) {
                contentParts.push({
                  type: "tool-call",
                  toolCallId: meta.toolCallId,
                  toolName: meta.toolName,
                  input: meta.args ?? {},
                });
              }
            } catch {
              // Skip malformed tool call metadata
            }
          }
        }

        if (contentParts.length > 0) {
          result.push({ role: "assistant", content: contentParts });
        }

        // Add tool results as a tool message
        const toolResults: ToolResultPart[] = [];

        for (const tcp of toolCallParts) {
          if (tcp.metadata && tcp.state === "completed" && tcp.content) {
            try {
              const meta = JSON.parse(tcp.metadata) as { toolCallId?: string; toolName?: string };
              if (meta.toolCallId && meta.toolName) {
                toolResults.push({
                  type: "tool-result",
                  toolCallId: meta.toolCallId,
                  toolName: meta.toolName,
                  output: { type: "text", value: tcp.content },
                });
              }
            } catch {
              // Skip malformed metadata
            }
          }
        }

        if (toolResults.length > 0) {
          result.push({ role: "tool", content: toolResults });
        }
      }
    }
  }

  return applyToolOutputPruning(result);
}

/**
 * Convert Tool.Info[] to Vercel AI SDK ToolSet.
 * If memoryDb is provided, the memory_search tool is injected into the set.
 * If the agent's toolProfile includes "task", the task tool is injected dynamically.
 * If pluginInput is provided, plugin tool.definition hooks are applied and plugin tools are included.
 */
async function buildToolSet(
  tools: Tool.Info[],
  ctx: Tool.Context,
  db: Database.Database,
  messageId: string,
  instanceSlug: InstanceSlug,
  sessionId: SessionId,
  resolvedModel: ResolvedModel,
  memoryDb?: Database.Database,
  workDir?: string,
  callerAgentConfig?: import("../config/index.js").RuntimeAgentConfig,
  subagentsConfig?: SubagentsConfig,
  compactionConfig?: RuntimeConfig["compaction"],
  pluginInput?: PluginInput,
): Promise<ToolSet> {
  const set: ToolSet = {};
  const bus = getBus(instanceSlug);

  // Sliding window for doom-loop detection (last 3 calls across all tools)
  const recentCalls: Array<{ tool: string; hash: string }> = [];

  for (const toolInfo of tools) {
    let def = await toolInfo.init();

    // Apply tool.definition plugin hooks (description/parameters enrichment)
    if (pluginInput) {
      const hooks = getRegisteredHooks();
      for (const hook of hooks) {
        if (hook["tool.definition"]) {
          try {
            def = await hook["tool.definition"](def, pluginInput);
          } catch (err) {
            console.warn("[claw-runtime] Plugin hook tool.definition threw:", err);
          }
        }
      }
    }

    // Skip ownerOnly tools for non-owner channels (internal sub-agents)
    if (def.ownerOnly && !ctx.senderIsOwner) continue;

    // Normalize schema for providers that don't support all JSON Schema features (e.g. Gemini)
    const normalizedParams = normalizeForProvider(def.parameters, resolvedModel.providerId);

    set[toolInfo.id] = aiTool({
      description: def.description,
      inputSchema: zodSchema(normalizedParams),
      execute: async (args: unknown) => {
        // Doom-loop detection: abort if the same tool is called 3 times with identical args
        const callHash = JSON.stringify(args);
        recentCalls.push({ tool: toolInfo.id, hash: callHash });
        if (recentCalls.length > 3) recentCalls.shift();
        const isDoomLoop =
          recentCalls.length === 3 &&
          recentCalls.every((c) => c.tool === toolInfo.id && c.hash === callHash);
        if (isDoomLoop) {
          bus.publish(DoomLoopDetected, { sessionId, toolName: toolInfo.id });
          throw new Error(
            `Doom loop detected: '${toolInfo.id}' called 3 times with identical arguments. ` +
              `Stop repeating this call and try a different approach.`,
          );
        }

        // Trigger tool.beforeCall plugin hook
        await triggerToolBeforeCall({
          instanceSlug,
          sessionId,
          messageId,
          toolName: toolInfo.id,
          args,
        }).catch((err) => {
          console.warn("[claw-runtime] plugin hook tool.beforeCall threw:", err);
        });

        // Create tool_call part
        const part = createPart(db, {
          messageId,
          type: "tool_call",
          metadata: JSON.stringify({
            toolName: toolInfo.id,
            args,
          }),
        });

        const callStart = Date.now();
        try {
          const result = await def.execute(args as never, ctx);

          // Update part to completed
          updatePartState(db, part.id, "completed", result.output);
          bus.publish(MessageUpdated, { sessionId, messageId });

          // Trigger tool.afterCall plugin hook
          await triggerToolAfterCall({
            instanceSlug,
            sessionId,
            messageId,
            toolName: toolInfo.id,
            args,
            output: result.output,
            durationMs: Date.now() - callStart,
          }).catch((err) => {
            console.warn("[claw-runtime] plugin hook tool.afterCall threw:", err);
          });

          // Trigger memory re-indexation in background if a memory file was written
          if (
            memoryDb &&
            workDir &&
            (toolInfo.id === "write" || toolInfo.id === "edit" || toolInfo.id === "multiedit")
          ) {
            const writtenPath: string | undefined =
              typeof args === "object" && args !== null && "filePath" in args
                ? String((args as { filePath: unknown }).filePath)
                : undefined;
            if (writtenPath && isMemoryFile(writtenPath)) {
              // Fire and forget — re-indexation must not block the tool response
              void Promise.resolve().then(() => {
                try {
                  rebuildMemoryIndex(memoryDb, workDir, ctx.agentId);
                } catch {
                  // Silently ignore re-indexation errors
                }
              });
            }
          }

          return result.output;
        } catch (err) {
          // Update part to error
          updatePartState(db, part.id, "error", err instanceof Error ? err.message : String(err));
          bus.publish(MessageUpdated, { sessionId, messageId });

          // Trigger tool.afterCall plugin hook even on error
          await triggerToolAfterCall({
            instanceSlug,
            sessionId,
            messageId,
            toolName: toolInfo.id,
            args,
            output: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - callStart,
          }).catch(() => {});

          throw err;
        }
      },
    });
  }

  // Inject task tool if the agent's toolProfile is "full" (the only profile that includes "task").
  // The task tool is dynamic (needs DB, model, workDir) so it cannot be in BUILTIN_TOOLS.
  if (callerAgentConfig) {
    const profile = callerAgentConfig.toolProfile ?? "coding";
    const profileAllows = profile === "full";
    if (profileAllows) {
      const taskToolInfo = createTaskTool({
        db,
        instanceSlug,
        resolvedModel,
        workDir,
        ...(subagentsConfig !== undefined ? { subagentsConfig } : {}),
        agentPermissions: callerAgentConfig.permissions,
        ...(compactionConfig !== undefined ? { compactionConfig } : {}),
        callerAgentConfig,
        runPromptLoop,
      });
      const taskDef = await taskToolInfo.init();
      const normalizedTaskParams = normalizeForProvider(
        taskDef.parameters,
        resolvedModel.providerId,
      );
      set["task"] = aiTool({
        description: taskDef.description,
        inputSchema: zodSchema(normalizedTaskParams),
        execute: async (args: unknown) => {
          const part = createPart(db, {
            messageId,
            type: "tool_call",
            metadata: JSON.stringify({ toolName: "task", args }),
          });
          try {
            const result = await taskDef.execute(args as never, ctx);
            updatePartState(db, part.id, "completed", result.output);
            bus.publish(MessageUpdated, { sessionId, messageId });
            return result.output;
          } catch (err) {
            updatePartState(db, part.id, "error", err instanceof Error ? err.message : String(err));
            bus.publish(MessageUpdated, { sessionId, messageId });
            throw err;
          }
        },
      });
    }
  }

  // Inject memory_search tool if a memory index DB is available
  if (memoryDb) {
    const memorySearchTool = createMemorySearchTool(memoryDb);
    const memoryDef = await memorySearchTool.init();
    set["memory_search"] = aiTool({
      description: memoryDef.description,
      inputSchema: zodSchema(memoryDef.parameters),
      execute: async (args: unknown) => {
        const part = createPart(db, {
          messageId,
          type: "tool_call",
          metadata: JSON.stringify({ toolName: "memory_search", args }),
        });
        try {
          const result = await memoryDef.execute(args as never, ctx);
          updatePartState(db, part.id, "completed", result.output);
          bus.publish(MessageUpdated, { sessionId, messageId });
          return result.output;
        } catch (err) {
          updatePartState(db, part.id, "error", err instanceof Error ? err.message : String(err));
          bus.publish(MessageUpdated, { sessionId, messageId });
          throw err;
        }
      },
    });
  }

  // Hidden tool for repairing invalid tool calls (not visible to LLM in tool list)
  const availableToolNames = tools.map((t) => t.id);
  const invalidToolSchema = z.object({
    toolName: z.string(),
    reason: z.string().optional(),
  });
  set["invalid"] = aiTool({
    description: "", // empty = not visible to LLM in tool list
    inputSchema: zodSchema(invalidToolSchema),
    execute: async (args: unknown) => {
      const parsed = invalidToolSchema.safeParse(args);
      const toolName = parsed.success ? parsed.data.toolName : "unknown";
      const reason = parsed.success ? (parsed.data.reason ?? "") : "";
      return (
        `Tool '${toolName}' does not exist. ${reason}\n` +
        `Available tools: ${availableToolNames.join(", ")}`
      );
    },
  });

  return set;
}
