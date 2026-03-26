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
import type { McpRegistry } from "../mcp/registry.js";
import type { ProfileResolver } from "../profile/types.js";
import {
  createSession,
  getSession,
  getSessionByKey,
  buildSessionKey,
  getOrCreatePermanentSession,
} from "../session/session.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import type { PromptLoopResult } from "../session/prompt-loop.js";
import { getAgent, defaultAgentName, resolveEffectivePersistence } from "../agent/registry.js";
import { resolveModel } from "../provider/provider.js";
import { getBus } from "../bus/index.js";
import { ChannelMessageReceived, ChannelMessageSent, SubagentCompleted } from "../bus/events.js";
import { resolveAgentWorkspacePath } from "../../core/agent-workspace.js";
import { runMiddlewarePipeline } from "../middleware/pipeline.js";
import { listParts } from "../session/part.js";
import type { OutboundArtifact } from "../types.js";

// ---------------------------------------------------------------------------
// Per-session serialization queue
// Ensures concurrent messages for the same session are processed in order.
// ---------------------------------------------------------------------------

const sessionQueues = new Map<string, Promise<unknown>>();

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
  /** MCP registry — forwarded to runPromptLoop to inject MCP tools */
  mcpRegistry?: McpRegistry;
  /** Profile resolver — used to inject user profile into system prompt */
  profileResolver?: ProfileResolver;
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
    const { db, instanceSlug, config, message, workDir, mcpRegistry } = input;
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

    // Guard: only primary agents can receive user messages through channels.
    // Subagents are ephemeral tools spawned by primary agents — they must never
    // be addressable directly from a user-facing channel (chat, Telegram, etc.).
    if (agentInfo.kind === "subagent") {
      throw new Error(
        `Agent "${agentId}" is a subagent and cannot receive messages from user channels. ` +
          `Only primary agents (kind: "primary") are user-facing.`,
      );
    }

    // Build RuntimeAgentConfig from Agent.Info + global config
    const agentConfig = buildAgentConfig(agentInfo, config);

    // 2. Resolve model (supports named aliases from config.models)
    const modelStr = agentConfig.model ?? config.defaultModel;
    const resolvedModel = resolveModelFromString(modelStr, config.models);

    // Resolve internal model (for compaction/title/summary) if configured
    const internalResolvedModel = config.defaultInternalModel
      ? resolveModelFromString(config.defaultInternalModel, config.models)
      : undefined;

    // 3. Find or create session for this peer
    const sessionId = findOrCreateSession(db, instanceSlug, message, agentId, config);

    // 4. Run middleware pipeline + prompt loop — serialized per session via queue
    // Resolve the agent's workspace directory to show to the agent (env block).
    const agentWorkDir = workDir
      ? resolveAgentWorkspacePath(workDir, agentId, undefined)
      : undefined;

    // Resolve user profile for dynamic prompt injection (if profileResolver provided)
    const userProfile = input.profileResolver?.getActiveProfile();

    const prev = sessionQueues.get(sessionId) ?? Promise.resolve();
    const next: Promise<PromptLoopResult> = prev.then(async () => {
      const pipelineResult = await runMiddlewarePipeline({
        ctx: {
          db,
          instanceSlug,
          sessionId,
          agentConfig,
          message,
        },
        runLoop: () =>
          runPromptLoop({
            db,
            instanceSlug,
            sessionId,
            userText: message.text,
            agentConfig,
            resolvedModel,
            workDir,
            ...(agentWorkDir !== undefined ? { agentWorkDir } : {}),
            runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
            compactionConfig: config.compaction,
            subagentsConfig: config.subagents,
            runtimeConfig: config,
            ...(input.abort !== undefined ? { abort: input.abort } : {}),
            ...(mcpRegistry !== undefined ? { mcpRegistry } : {}),
            ...(internalResolvedModel !== undefined ? { internalResolvedModel } : {}),
            ...(userProfile !== undefined ? { userProfile } : {}),
            // Pass validated attachments from middleware-enriched message
            ...(message.attachments !== undefined && message.attachments.length > 0
              ? { imageAttachments: message.attachments }
              : {}),
          }),
      });

      if (pipelineResult.aborted || !pipelineResult.result) {
        // Return a minimal result when pipeline was aborted
        return {
          messageId: "",
          text: pipelineResult.abortReason ?? "Request aborted by middleware.",
          steps: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
        } satisfies PromptLoopResult;
      }

      return pipelineResult.result;
    });
    sessionQueues.set(sessionId, next);

    let result: PromptLoopResult;
    try {
      result = await next;
    } finally {
      // Clean up the queue entry once this promise is the last one
      if (sessionQueues.get(sessionId) === next) {
        sessionQueues.delete(sessionId);
      }
    }

    // 5. Extract artifacts from message parts (for channel delivery as documents)
    const artifacts = extractArtifacts(db, result.messageId);

    // 6. Build outbound message
    const response: OutboundMessage = {
      channelType: message.channelType,
      peerId: message.peerId,
      ...(message.accountId !== undefined ? { accountId: message.accountId } : {}),
      text: result.text,
      ...(artifacts.length > 0 ? { artifacts } : {}),
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
 * Find an existing active session for this (instanceSlug, agentId, channel, peerId)
 * using the session_key index (O(1) lookup), or create a new one.
 *
 * For permanent agents, routes to getOrCreatePermanentSession() which provides
 * cross-channel session continuity and automatic reactivation after force cleanup.
 */
function findOrCreateSession(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  message: InboundMessage,
  agentId: string,
  config: RuntimeConfig,
): string {
  // Déterminer si l'agent est permanent
  const agentInfo = getAgent(agentId);
  const agentConfig = config.agents.find((a) => a.id === agentId);
  const isPermanent =
    resolveEffectivePersistence(
      agentInfo ?? {
        kind: "primary",
        category: "user",
        archetype: null,
        name: agentId,
        permission: [],
        mode: "all",
        options: {},
      },
      agentConfig,
    ) === "permanent";

  if (isPermanent) {
    const session = getOrCreatePermanentSession(db, {
      instanceSlug,
      agentId,
      channel: message.channelType,
      ...(message.peerId !== undefined ? { peerId: message.peerId } : {}),
    });
    return session.id;
  }

  // Session éphémère : comportement actuel
  const key = buildSessionKey(instanceSlug, agentId, message.channelType, message.peerId);
  const existing = getSessionByKey(db, key);
  if (existing && existing.state === "active") return existing.id;

  const session = createSession(db, {
    instanceSlug,
    agentId,
    channel: message.channelType,
    ...(message.peerId !== undefined ? { peerId: message.peerId } : {}),
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
  // Resolve persistence from config (explicit) or agent kind (inferred)
  const agentConfigFromRuntime = config.agents.find((a) => a.id === agent.name);
  const persistence = resolveEffectivePersistence(agent, agentConfigFromRuntime);

  return {
    id: agent.name,
    name: agent.name,
    model: agent.model ?? config.defaultModel,
    systemPrompt: agent.prompt,
    temperature: agent.temperature,
    maxSteps: agent.steps ?? 20,
    allowSubAgents: true,
    toolProfile: "executor",
    isDefault: false,
    permissions: agent.permission ?? [],
    inheritWorkspace: true,
    persistence,
  };
}

/**
 * Parse a "provider/model" string or resolve a named alias, then call resolveModel.
 * If aliases are provided and modelRef matches an alias id, the alias is used.
 */
function resolveModelFromString(
  modelRef: string,
  aliases?: import("../config/index.js").ModelAlias[],
) {
  // Try alias resolution first
  if (aliases && aliases.length > 0) {
    const alias = aliases.find((a) => a.id === modelRef);
    if (alias) {
      return resolveModel(alias.provider, alias.model);
    }
  }

  // Standard "provider/model" format
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(
      `Invalid model reference "${modelRef}": must be "provider/model" format or a named alias.`,
    );
  }
  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);
  return resolveModel(providerId, modelId);
}

// ---------------------------------------------------------------------------
// Artifact extraction
// ---------------------------------------------------------------------------

/**
 * Extract artifacts from assistant message parts.
 * Artifacts are tool_call parts where toolName is "create_artifact".
 * The content comes from the matching tool_result part.
 */
function extractArtifacts(db: Database.Database, messageId: string): OutboundArtifact[] {
  const parts = listParts(db, messageId);
  const artifacts: OutboundArtifact[] = [];

  for (const part of parts) {
    if (part.type !== "tool_call") continue;
    let meta: { toolName?: string; toolCallId?: string; args?: Record<string, unknown> };
    try {
      meta = JSON.parse(part.metadata ?? "{}") as typeof meta;
    } catch {
      continue;
    }
    if (meta.toolName !== "create_artifact") continue;

    // Find the matching tool_result for content
    const resultPart = parts.find((p) => {
      if (p.type !== "tool_result") return false;
      try {
        const rm = JSON.parse(p.metadata ?? "{}") as { toolCallId?: string };
        return rm.toolCallId === meta.toolCallId;
      } catch {
        return false;
      }
    });

    const args = meta.args ?? {};
    const content = resultPart?.content ?? (args.content as string | undefined) ?? "";
    if (!content) continue;

    artifacts.push({
      title: (args.title as string | undefined) ?? "Artifact",
      artifactType: (args.artifactType as string | undefined) ?? "code",
      content,
      ...((args.language as string | undefined) !== undefined
        ? { language: args.language as string }
        : {}),
    });
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Async subagent result injection
// ---------------------------------------------------------------------------

/**
 * Register the SubagentCompleted bus handler for a given instance.
 *
 * When an async sub-agent completes, its result is injected as a user message
 * into the parent session, triggering a new prompt loop turn.
 *
 * Call this once at runtime startup (from the engine).
 * Returns an unsubscribe function to clean up on shutdown.
 */
export function registerSubagentCompletedHandler(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  config: RuntimeConfig,
  workDir?: string,
): () => void {
  const bus = getBus(instanceSlug);

  const unsubscribe = bus.subscribe(SubagentCompleted, (payload) => {
    const parentSession = getSession(db, payload.parentSessionId);
    if (!parentSession || parentSession.state !== "active") return;

    const stepsInfo = `${payload.result.steps}`;
    const tokensTotal = payload.result.tokens.input + payload.result.tokens.output;

    const resultText = [
      `[Async subagent result — task_id: ${payload.subSessionId}]`,
      `steps_used: ${stepsInfo}`,
      `tokens_used: ${tokensTotal}`,
      `model: ${payload.result.model}`,
      "<task_result>",
      payload.result.text,
      "</task_result>",
    ].join("\n");

    // Serialize via the session queue — ensures ordering with other messages
    const prev = sessionQueues.get(payload.parentSessionId) ?? Promise.resolve();
    const next = prev
      .then(() => {
        // Re-check session is still active before running
        const session = getSession(db, payload.parentSessionId);
        if (!session || session.state !== "active") return;

        const agentInfo = getAgent(parentSession.agentId);
        if (!agentInfo) return;

        const agentConfig = buildAgentConfig(agentInfo, config);
        const modelStr = agentConfig.model ?? config.defaultModel;
        const resolvedModel = resolveModelFromString(modelStr, config.models);
        const internalResolvedModel = config.defaultInternalModel
          ? resolveModelFromString(config.defaultInternalModel, config.models)
          : undefined;

        return runPromptLoop({
          db,
          instanceSlug,
          sessionId: payload.parentSessionId,
          userText: resultText,
          agentConfig,
          resolvedModel,
          workDir,
          runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
          compactionConfig: config.compaction,
          subagentsConfig: config.subagents,
          runtimeConfig: config,
          ...(internalResolvedModel !== undefined ? { internalResolvedModel } : {}),
        });
      })
      .catch(() => {
        // Ignore errors in async result injection — parent session continues normally
      });

    sessionQueues.set(payload.parentSessionId, next);

    // Clean up queue entry once this promise settles
    void next.finally(() => {
      if (sessionQueues.get(payload.parentSessionId) === next) {
        sessionQueues.delete(payload.parentSessionId);
      }
    });
  });

  return unsubscribe;
}
