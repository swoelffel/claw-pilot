/**
 * runtime/session/_prompt-loop-handlers.ts
 *
 * Extracted helpers for prompt-loop.ts — chunk handlers, watchdog management,
 * system prompt cache logic, and auto-compaction check.
 * Keeps each function under cognitive-complexity 20 / 150 lines.
 */

import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { RuntimeConfig } from "../config/index.js";
import type { Bus } from "../bus/index.js";
import {
  AgentTimeout,
  LLMChunkTimeout,
  MessagePartDelta,
  ToolCallStarted,
  ToolCallEnded,
} from "../bus/events.js";
import { createPart, updatePartState, listParts } from "./part.js";
import { buildSystemPrompt, buildSkillsBlock } from "./system-prompt.js";
import {
  getCachedBasePrompt,
  cacheBasePrompt,
  isDirty,
  clearDirty,
} from "./system-prompt-dirty.js";
import { shouldCompact, compact } from "./compaction.js";
import { findModel } from "../provider/models.js";
import { countMessagesSinceLastCompaction } from "./message.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// StreamingState — mutable state shared across chunk handlers
// ---------------------------------------------------------------------------

/** Mutable state accumulated during streaming, shared between chunk handlers. */
export interface StreamingState {
  textPartId: string | undefined;
  accumulatedText: string;
  reasoningPartId: string | undefined;
  reasoningProviderId: string | undefined;
  accumulatedReasoning: string;
  stepCount: number;
  lastChunkTime: number;
}

/** Create a fresh StreamingState for a new streaming call. */
export function createStreamingState(): StreamingState {
  return {
    textPartId: undefined,
    accumulatedText: "",
    reasoningPartId: undefined,
    reasoningProviderId: undefined,
    accumulatedReasoning: "",
    stepCount: 0,
    lastChunkTime: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Reasoning finalizer
// ---------------------------------------------------------------------------

/** Finalize an in-flight reasoning part (mark completed and reset state). */
export function finalizeReasoning(db: Database.Database, state: StreamingState): void {
  if (state.reasoningPartId) {
    updatePartState(db, state.reasoningPartId, "completed", state.accumulatedReasoning);
  }
  state.reasoningPartId = undefined;
  state.reasoningProviderId = undefined;
  state.accumulatedReasoning = "";
}

// ---------------------------------------------------------------------------
// Chunk handlers
// ---------------------------------------------------------------------------

interface ChunkContext {
  db: Database.Database;
  bus: Bus;
  sessionId: SessionId;
  messageId: string;
  state: StreamingState;
}

/** Handle a text-delta chunk — create or update the text part and emit delta. */
export function handleTextDelta(ctx: ChunkContext, chunkText: string): void {
  const { db, bus, sessionId, messageId, state } = ctx;
  finalizeReasoning(db, state);
  state.accumulatedText += chunkText;
  if (!state.textPartId) {
    const part = createPart(db, {
      messageId,
      type: "text",
      content: chunkText,
    });
    state.textPartId = part.id;
  } else {
    updatePartState(db, state.textPartId, "completed", state.accumulatedText);
  }
  if (state.textPartId) {
    bus.publish(MessagePartDelta, {
      sessionId,
      messageId,
      partId: state.textPartId,
      delta: chunkText,
      partType: "text",
    });
  }
}

/** Handle a reasoning-delta chunk — create new reasoning block on id change. */
export function handleReasoningDelta(
  ctx: ChunkContext,
  chunkText: string,
  chunkId: string | undefined,
): void {
  const { db, bus, sessionId, messageId, state } = ctx;
  if (state.reasoningProviderId !== chunkId) {
    finalizeReasoning(db, state);
    state.reasoningProviderId = chunkId;
    const part = createPart(db, {
      messageId,
      type: "reasoning",
      content: chunkText,
    });
    state.reasoningPartId = part.id;
    updatePartState(db, state.reasoningPartId, "running", chunkText);
    state.accumulatedReasoning = chunkText;
  } else {
    state.accumulatedReasoning += chunkText;
    if (state.reasoningPartId) {
      updatePartState(db, state.reasoningPartId, "running", state.accumulatedReasoning);
    }
  }
  if (state.reasoningPartId) {
    bus.publish(MessagePartDelta, {
      sessionId,
      messageId,
      partId: state.reasoningPartId,
      delta: chunkText,
      partType: "reasoning",
    });
  }
}

/** Handle a tool-call chunk — persist part and emit ToolCallStarted. */
export function handleToolCallChunk(
  ctx: ChunkContext,
  chunk: { toolCallId: string; toolName: string; input?: unknown },
): void {
  const { db, bus, sessionId, messageId, state } = ctx;
  finalizeReasoning(db, state);
  // Reset text accumulation so any text in the next SDK step creates a fresh
  // `text` part, correctly ordered AFTER this tool_call. Without this, text
  // streamed before and after a question/A2A tool call gets appended to the
  // same pre-tool-call part (sort_order 0), producing a single concatenated
  // blob in the timeline with the tool_call rendered visually "after" it.
  if (state.textPartId) {
    state.textPartId = undefined;
    state.accumulatedText = "";
  }
  state.stepCount++;
  createPart(db, {
    messageId,
    type: "tool_call",
    metadata: JSON.stringify({
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      args: chunk.input,
    }),
  });
  bus.publish(ToolCallStarted, {
    sessionId,
    messageId,
    toolName: chunk.toolName,
    toolCallId: chunk.toolCallId,
  });
}

/** Handle a tool-result chunk — find the matching tool_call part and complete it. */
export function handleToolResultChunk(
  ctx: ChunkContext,
  chunk: { toolCallId: string; output?: unknown },
): void {
  const { db, bus, sessionId, messageId } = ctx;
  const toolPart = findToolPartByCallId(db, messageId, chunk.toolCallId);
  if (!toolPart) return;

  const output =
    chunk.output !== undefined
      ? typeof chunk.output === "string"
        ? chunk.output
        : JSON.stringify(chunk.output)
      : "";
  updatePartState(db, toolPart.id, "completed", output);
  try {
    const meta = JSON.parse(toolPart.metadata ?? "{}") as { toolName?: string };
    bus.publish(ToolCallEnded, {
      sessionId,
      messageId,
      toolName: meta.toolName ?? "unknown",
      toolCallId: chunk.toolCallId,
    });
  } catch (err) {
    logger.debug("[prompt-loop] failed to publish ToolCallEnded", {
      error: String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Shared helper — find a tool_call part by toolCallId
// ---------------------------------------------------------------------------

/** Find a tool_call part matching the given toolCallId within a message. */
export function findToolPartByCallId(
  db: Database.Database,
  messageId: string,
  toolCallId: string,
): { id: string; metadata: string | undefined; state: string | undefined } | undefined {
  const parts = listParts(db, messageId);
  return parts.find((p) => {
    if (p.type !== "tool_call" || !p.metadata) return false;
    try {
      const meta = JSON.parse(p.metadata) as { toolCallId?: string };
      return meta.toolCallId === toolCallId;
    } catch (err) {
      logger.warn("[prompt-loop] JSON.parse of tool_call metadata failed", {
        error: String(err),
      });
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Watchdog management
// ---------------------------------------------------------------------------

/** Return value of createWatchdogManager — abort signals and lifecycle hooks. */
export interface WatchdogManager {
  /** Combined abort signal (user abort + agent timeout + chunk stall). */
  fullAbort: AbortSignal;
  /** Suspend both watchdogs while an async function runs (e.g. permission prompt). */
  onLongWait: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Clean up all timers. Must be called in a finally block. */
  cleanup: () => void;
  /** Update the last-chunk timestamp (call on every chunk). */
  touchChunk: () => void;
}

/** Create agent-timeout and chunk-stall watchdogs. */
export function createWatchdogManager(
  bus: Bus,
  sessionId: SessionId,
  agentId: string,
  timeoutMs: number,
  chunkTimeoutMs: number,
  externalAbort?: AbortSignal,
): WatchdogManager {
  const watchdogController = new AbortController();
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    bus.publish(AgentTimeout, { sessionId, agentId, timeoutMs });
    watchdogController.abort();
  }, timeoutMs);

  const combinedAbort = externalAbort
    ? AbortSignal.any([externalAbort, watchdogController.signal])
    : watchdogController.signal;

  let lastChunkTime = Date.now();
  let watchdogsPaused = 0;
  const chunkWatchdogController = new AbortController();
  const chunkWatchdogTimer = setInterval(() => {
    if (watchdogsPaused > 0) {
      lastChunkTime = Date.now();
      return;
    }
    const elapsed = Date.now() - lastChunkTime;
    if (elapsed > chunkTimeoutMs) {
      clearInterval(chunkWatchdogTimer);
      bus.publish(LLMChunkTimeout, { sessionId, agentId, elapsedMs: elapsed });
      chunkWatchdogController.abort();
    }
  }, 5_000);

  const onLongWait = async <T>(fn: () => Promise<T>): Promise<T> => {
    watchdogsPaused++;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = undefined;
    }
    try {
      return await fn();
    } finally {
      watchdogsPaused--;
      if (watchdogsPaused === 0) {
        watchdogTimer = setTimeout(() => {
          bus.publish(AgentTimeout, { sessionId, agentId, timeoutMs });
          watchdogController.abort();
        }, timeoutMs);
        lastChunkTime = Date.now();
      }
    }
  };

  const fullAbort = AbortSignal.any([combinedAbort, chunkWatchdogController.signal]);

  return {
    fullAbort,
    onLongWait,
    touchChunk: () => {
      lastChunkTime = Date.now();
    },
    cleanup: () => {
      clearTimeout(watchdogTimer);
      clearInterval(chunkWatchdogTimer);
    },
  };
}

// ---------------------------------------------------------------------------
// System prompt with cache
// ---------------------------------------------------------------------------

/** Options for buildSystemPromptWithCache. */
export interface SystemPromptCacheInput {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  agentConfig: RuntimeAgentConfig;
  channel: string;
  workDir: string | undefined;
  agentWorkDir?: string;
  runtimeAgents?: Array<{ id: string; name: string }>;
  userText: string;
  extraSystemPrompt?: string;
  db: Database.Database;
  runtimeConfig?: RuntimeConfig;
  userProfile?: import("../profile/types.js").UserProfile;
}

/**
 * Build the system prompt, using the dirty-flag cache for the base prompt
 * and always re-computing the skills block.
 */
export async function buildSystemPromptWithCache(input: SystemPromptCacheInput): Promise<string> {
  const {
    instanceSlug,
    sessionId,
    agentConfig,
    channel,
    workDir,
    agentWorkDir,
    runtimeAgents,
    userText,
    extraSystemPrompt,
    db,
    runtimeConfig,
    userProfile,
  } = input;

  const cachedBase = getCachedBasePrompt(sessionId);

  let basePrompt: string;
  if (cachedBase && !isDirty(sessionId)) {
    basePrompt = cachedBase;
    logger.debug(`[prompt-loop] system_prompt_cache_hit sid=${sessionId}`);
  } else {
    basePrompt = await buildSystemPrompt({
      instanceSlug,
      agentConfig,
      channel,
      workDir,
      ...(agentWorkDir !== undefined ? { agentWorkDir } : {}),
      ...(runtimeAgents !== undefined ? { runtimeAgents } : {}),
      ...(runtimeConfig?.agents !== undefined ? { runtimeAgentConfigs: runtimeConfig.agents } : {}),
      db,
      sessionId,
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      ...(userProfile !== undefined ? { userProfile } : {}),
      skipSkills: true,
    });
    cacheBasePrompt(sessionId, basePrompt);
    clearDirty(sessionId);
    logger.debug(`[prompt-loop] system_prompt_cache_miss sid=${sessionId}`);
  }

  const skillsBlock = workDir ? await buildSkillsBlock(workDir, agentConfig, userText) : undefined;
  return [basePrompt, skillsBlock, extraSystemPrompt?.trim()].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Auto-compaction
// ---------------------------------------------------------------------------

/** Options for handleAutoCompaction. */
export interface AutoCompactionInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  agentConfig: RuntimeAgentConfig;
  resolvedModel: ResolvedModel;
  internalResolvedModel?: ResolvedModel;
  tokensIn: number;
  tokensOut: number;
  compactionConfig?: RuntimeConfig["compaction"];
  workDir: string | undefined;
}

/**
 * Run auto-compaction if token usage exceeds thresholds, or periodic
 * message count triggers compaction for permanent sessions.
 */
export async function handleAutoCompaction(input: AutoCompactionInput): Promise<void> {
  const {
    db,
    instanceSlug,
    sessionId,
    agentConfig,
    resolvedModel,
    internalResolvedModel,
    tokensIn,
    tokensOut,
    compactionConfig,
    workDir,
  } = input;

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
}
