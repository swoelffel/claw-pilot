/**
 * runtime/session/tool-set-builder.ts
 *
 * Converts Tool.Info[] to Vercel AI SDK ToolSet, wiring:
 * - doom-loop detection
 * - plugin hooks (tool.definition, tool.beforeCall, tool.afterCall)
 * - ownerOnly filtering
 * - provider-specific schema normalization
 * - dynamic tool injection (task, memory_search, invalid)
 * - workspace cache invalidation after write/edit/multiedit
 *
 * Extracted from prompt-loop.ts to keep each module focused.
 * NOTE: runPromptLoop is injected to avoid a circular dependency
 * (prompt-loop → tool-set-builder → task → prompt-loop).
 * task.ts defines its own local PromptLoopInput/Result interfaces.
 */

import { tool as aiTool, jsonSchema, zodSchema } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { InstanceSlug, SessionId } from "../types.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { Tool } from "../tool/tool.js";
import type { RuntimeConfig, SubagentsConfig } from "../config/index.js";
import type { McpRegistry } from "../mcp/registry.js";
import type { PluginInput } from "../plugin/types.js";
import { logger } from "../../lib/logger.js";
import { normalizeForProvider } from "../tool/normalize.js";
import { createPart, listParts, updatePartState } from "./part.js";
import { getBus } from "../bus/index.js";
import { DoomLoopDetected, MessageUpdated } from "../bus/events.js";
import { triggerToolAfterCall, getRegisteredHooks } from "../plugin/hooks.js";
import { dispatchToolBeforeCall } from "../plugin/dispatcher.js";
import type { ApprovalRequest } from "../plugin/types.js";
import { createMemorySearchTool } from "../memory/search-tool.js";
import { rebuildMemoryIndex } from "../memory/index.js";
import { createTaskTool } from "../tool/task.js";
import { createTaskBoardTool } from "../tool/task-board.js";
import { createSendMessageTool } from "../tool/send-message.js";
import { TOOL_PROFILES } from "../tool/registry.js";
import { invalidateWorkspaceCache } from "./workspace-cache.js";
import { markDirty } from "./system-prompt-dirty.js";
import { buildResolvedEnv } from "../../lib/env-reader.js";

// ---------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------

/**
 * Find the tool_call part created by onChunk Path-A (which has toolCallId).
 * Falls back to creating a new part if not found (e.g. streaming edge cases).
 */
function getOrCreateToolCallPart(
  db: import("better-sqlite3").Database,
  messageId: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
): ReturnType<typeof createPart> {
  const existing = listParts(db, messageId).find((p) => {
    if (p.type !== "tool_call" || !p.metadata) return false;
    try {
      const meta = JSON.parse(p.metadata) as { toolCallId?: string };
      return meta.toolCallId === toolCallId;
    } catch (err) {
      logger.warn("[tool-set-builder] JSON.parse of tool_call metadata failed", {
        error: String(err),
      });
      return false;
    }
  });
  if (existing) return existing;
  // Fallback: create with toolCallId so the part is properly identified
  return createPart(db, {
    messageId,
    type: "tool_call",
    metadata: JSON.stringify({ toolCallId, toolName, args }),
  });
}

// ---------------------------------------------------------------------------
// Memory file detection
// ---------------------------------------------------------------------------

function isMemoryFile(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? "";
  const parentDir = filePath.split("/").slice(-2, -1)[0] ?? "";
  return basename === "MEMORY.md" || (parentDir === "memory" && basename.endsWith(".md"));
}

// ---------------------------------------------------------------------------
// tool.definition hook helper
// ---------------------------------------------------------------------------

/**
 * Apply all registered plugin tool.definition hooks to a tool definition.
 * Used for ALL tools (built-in, MCP, plugin, and dynamic) to ensure uniform hook coverage.
 */
async function applyToolDefinitionHooks(
  def: Tool.Definition<import("zod").ZodType>,
  pluginInput: PluginInput | undefined,
): Promise<Tool.Definition<import("zod").ZodType>> {
  if (!pluginInput) return def;
  const hooks = getRegisteredHooks();
  let result = def;
  for (const hook of hooks) {
    if (hook["tool.definition"]) {
      try {
        result = await hook["tool.definition"](result, pluginInput);
      } catch (err) {
        logger.warn(`Plugin hook tool.definition threw: ${err}`);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dynamic tool wiring — shared wrapper for task, task_board, send_message, memory_search
// ---------------------------------------------------------------------------

interface DynamicToolWireContext {
  db: Database.Database;
  messageId: string;
  sessionId: SessionId;
  ctx: Tool.Context;
  bus: ReturnType<typeof getBus>;
  providerId: string;
  pluginInput: PluginInput | undefined;
}

/** Wire a dynamic tool (task, task_board, send_message, memory_search) into the ToolSet. */
async function wireDynamicTool(
  set: ToolSet,
  toolName: string,
  toolInfo: Tool.Info,
  wireCtx: DynamicToolWireContext,
): Promise<void> {
  const def = await applyToolDefinitionHooks(await toolInfo.init(), wireCtx.pluginInput);
  const normalizedParams = normalizeForProvider(def.parameters, wireCtx.providerId);
  set[toolName] = aiTool({
    description: def.description,
    inputSchema: zodSchema(normalizedParams),
    execute: async (args: unknown, options: { toolCallId: string }) => {
      const part = getOrCreateToolCallPart(
        wireCtx.db,
        wireCtx.messageId,
        options.toolCallId,
        toolName,
        args,
      );
      try {
        const result = await def.execute(args as never, wireCtx.ctx);
        updatePartState(wireCtx.db, part.id, "completed", result.output);
        wireCtx.bus.publish(MessageUpdated, {
          sessionId: wireCtx.sessionId,
          messageId: wireCtx.messageId,
        });
        return result.output;
      } catch (err) {
        updatePartState(
          wireCtx.db,
          part.id,
          "error",
          err instanceof Error ? err.message : String(err),
        );
        wireCtx.bus.publish(MessageUpdated, {
          sessionId: wireCtx.sessionId,
          messageId: wireCtx.messageId,
        });
        throw err;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Workspace cache invalidation after write/edit
// ---------------------------------------------------------------------------

/** Invalidate workspace cache and trigger memory re-indexation when a file is written. */
function handleWriteInvalidation(
  toolId: string,
  args: unknown,
  sessionId: SessionId,
  memoryDb: Database.Database | undefined,
  workDir: string | undefined,
  agentId: string,
): void {
  if (toolId !== "write" && toolId !== "edit" && toolId !== "multiedit") return;

  const writtenPath: string | undefined =
    typeof args === "object" && args !== null && "filePath" in args
      ? String((args as { filePath: unknown }).filePath)
      : undefined;
  if (!writtenPath) return;

  invalidateWorkspaceCache(writtenPath);
  markDirty(sessionId, isMemoryFile(writtenPath) ? "memory" : "workspace");

  if (memoryDb && workDir && isMemoryFile(writtenPath)) {
    void Promise.resolve().then(() => {
      try {
        rebuildMemoryIndex(memoryDb, workDir, agentId);
      } catch (err) {
        logger.debug("[tool-set-builder] memory re-indexation failed", { error: String(err) });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// buildToolSet
// ---------------------------------------------------------------------------

/**
 * Convert Tool.Info[] to Vercel AI SDK ToolSet.
 * Injects task, memory_search, and invalid tools as needed.
 */
export async function buildToolSet(
  tools: Tool.Info[],
  ctx: Tool.Context,
  db: Database.Database,
  messageId: string,
  instanceSlug: InstanceSlug,
  sessionId: SessionId,
  resolvedModel: ResolvedModel,
  memoryDb: Database.Database | undefined,
  workDir: string | undefined,
  callerAgentConfig: import("../config/index.js").RuntimeAgentConfig | undefined,
  subagentsConfig: SubagentsConfig | undefined,
  compactionConfig: RuntimeConfig["compaction"] | undefined,
  pluginInput: PluginInput | undefined,
  agentKind: "primary" | "subagent" | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runPromptLoopFn: (input: any) => Promise<{
    text: string;
    steps: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>,
  runtimeAgentConfigs?: import("../config/index.js").RuntimeAgentConfig[],
  runtimeConfig?: RuntimeConfig,
  resolveTargetModel?: (
    agentConfig: import("../config/index.js").RuntimeAgentConfig,
  ) => ResolvedModel,
): Promise<ToolSet> {
  const set: ToolSet = {};
  const bus = getBus(instanceSlug);
  const recentCalls: Array<{ tool: string; hash: string }> = [];

  // 1. Wire built-in tools from the registry
  await wireBuiltInTools(
    set,
    tools,
    ctx,
    db,
    messageId,
    instanceSlug,
    sessionId,
    resolvedModel,
    memoryDb,
    workDir,
    pluginInput,
    bus,
    recentCalls,
  );

  // 2. Remove create_artifact when disabled
  if (runtimeConfig?.artifacts?.enabled === false) {
    delete set["create_artifact"];
  }

  // 3. Inject dynamic tools (task, task_board, send_message)
  const wireCtx: DynamicToolWireContext = {
    db,
    messageId,
    sessionId,
    ctx,
    bus,
    providerId: resolvedModel.providerId,
    pluginInput,
  };

  if (callerAgentConfig && agentKind !== "subagent") {
    await injectDynamicTools(set, wireCtx, callerAgentConfig, {
      db,
      instanceSlug,
      resolvedModel,
      workDir,
      ...(subagentsConfig !== undefined ? { subagentsConfig } : {}),
      ...(compactionConfig !== undefined ? { compactionConfig } : {}),
      ...(runtimeAgentConfigs !== undefined ? { runtimeAgentConfigs } : {}),
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      ...(resolveTargetModel !== undefined ? { resolveTargetModel } : {}),
      runPromptLoopFn,
    });
  }

  // 4. Memory search tool
  if (memoryDb) {
    await wireDynamicTool(set, "memory_search", createMemorySearchTool(memoryDb), wireCtx);
  }

  // 5. Invalid tool (catch-all for hallucinated tool names)
  wireInvalidTool(set, tools);

  return set;
}

/** Wire all built-in tools from the registry into the ToolSet. */
async function wireBuiltInTools(
  set: ToolSet,
  tools: Tool.Info[],
  ctx: Tool.Context,
  db: Database.Database,
  messageId: string,
  instanceSlug: InstanceSlug,
  sessionId: SessionId,
  resolvedModel: ResolvedModel,
  memoryDb: Database.Database | undefined,
  workDir: string | undefined,
  pluginInput: PluginInput | undefined,
  bus: ReturnType<typeof getBus>,
  recentCalls: Array<{ tool: string; hash: string }>,
): Promise<void> {
  for (const toolInfo of tools) {
    const def = await applyToolDefinitionHooks(await toolInfo.init(), pluginInput);
    if (def.ownerOnly && !ctx.senderIsOwner) continue;

    const normalizedParams = normalizeForProvider(def.parameters, resolvedModel.providerId);
    // Prefer a raw JSON Schema (e.g. provided by MCP tools) over the Zod schema
    // so the model receives the server-declared types verbatim. Without this,
    // MCP tools using arrays/nested objects are exposed as unconstrained records
    // and the model may emit complex args as JSON-encoded strings.
    const inputSchema = def.inputJsonSchema
      ? jsonSchema(def.inputJsonSchema as Parameters<typeof jsonSchema>[0])
      : zodSchema(normalizedParams);
    set[toolInfo.id] = aiTool({
      description: def.description,
      inputSchema,
      execute: async (args: unknown, options: { toolCallId: string }) => {
        checkDoomLoop(recentCalls, toolInfo.id, args, sessionId, bus);

        const { decision, effectiveArgs } = await dispatchToolBeforeCall(
          {
            instanceSlug,
            sessionId,
            messageId,
            toolName: toolInfo.id,
            args,
          },
          { agentId: ctx.agentId },
        );
        if (decision.action === "deny") {
          return formatDeniedToolResult(toolInfo.id, decision.reason);
        }
        if (decision.action === "require-approval") {
          return formatApprovalRequiredToolResult(toolInfo.id, decision.approvalRequest);
        }
        const execArgs = effectiveArgs;

        const part = getOrCreateToolCallPart(
          db,
          messageId,
          options.toolCallId,
          toolInfo.id,
          execArgs,
        );
        const callStart = Date.now();
        try {
          const callCtx = { ...ctx, toolCallId: options.toolCallId };
          const result = await def.execute(execArgs as never, callCtx);
          const durationMs = Date.now() - callStart;
          updatePartState(db, part.id, "completed", result.output);
          db.prepare("UPDATE rt_parts SET metadata = ?, updated_at = ? WHERE id = ?").run(
            JSON.stringify({
              toolCallId: options.toolCallId,
              toolName: toolInfo.id,
              args: execArgs,
              durationMs,
            }),
            new Date().toISOString(),
            part.id,
          );
          bus.publish(MessageUpdated, { sessionId, messageId });
          await triggerToolAfterCall({
            instanceSlug,
            sessionId,
            messageId,
            toolName: toolInfo.id,
            args: execArgs,
            output: result.output,
            durationMs,
          }).catch((err) => {
            logger.warn(`Plugin hook tool.afterCall threw: ${err}`);
          });
          handleWriteInvalidation(toolInfo.id, execArgs, sessionId, memoryDb, workDir, ctx.agentId);
          return result.output;
        } catch (err) {
          updatePartState(db, part.id, "error", err instanceof Error ? err.message : String(err));
          bus.publish(MessageUpdated, { sessionId, messageId });
          await triggerToolAfterCall({
            instanceSlug,
            sessionId,
            messageId,
            toolName: toolInfo.id,
            args: execArgs,
            output: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - callStart,
          }).catch((hookErr) => {
            logger.warn(`Plugin hook tool.afterCall threw on error path: ${hookErr}`);
          });
          throw err;
        }
      },
    });
  }
}

/**
 * Format the string returned to the LLM when a plugin denies a tool call.
 * Returned as the tool "output" so the model observes the refusal and adapts
 * rather than crashing the session.
 */
function formatDeniedToolResult(toolName: string, reason: string): string {
  return `Tool call "${toolName}" denied by policy: ${reason}`;
}

/**
 * Format the string returned when a plugin requests out-of-band approval.
 * Community does not resolve approvals — the LLM sees the request as a refusal
 * with the approval backend identifier so Enterprise flows remain observable
 * even when the resolver is absent.
 */
function formatApprovalRequiredToolResult(toolName: string, request: ApprovalRequest): string {
  return `Tool call "${toolName}" requires approval (kind="${request.kind}"). Community build does not resolve approvals.`;
}

/** Check for doom-loop (3 identical consecutive calls). */
function checkDoomLoop(
  recentCalls: Array<{ tool: string; hash: string }>,
  toolId: string,
  args: unknown,
  sessionId: SessionId,
  bus: ReturnType<typeof getBus>,
): void {
  const callHash = JSON.stringify(args);
  recentCalls.push({ tool: toolId, hash: callHash });
  if (recentCalls.length > 3) recentCalls.shift();
  const isDoomLoop =
    recentCalls.length === 3 && recentCalls.every((c) => c.tool === toolId && c.hash === callHash);
  if (isDoomLoop) {
    bus.publish(DoomLoopDetected, { sessionId, toolName: toolId });
    throw new Error(
      `Doom loop detected: '${toolId}' called 3 times with identical arguments. ` +
        `Stop repeating this call and try a different approach.`,
    );
  }
}

/** Inject dynamic tools (task, task_board, send_message) based on the agent's tool profile. */
/** Options shared by task and send_message tool injection. */
interface DynamicToolOpts {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  subagentsConfig?: SubagentsConfig;
  compactionConfig?: RuntimeConfig["compaction"];
  runtimeAgentConfigs?: import("../config/index.js").RuntimeAgentConfig[];
  runtimeConfig?: RuntimeConfig;
  resolveTargetModel?: (
    agentConfig: import("../config/index.js").RuntimeAgentConfig,
  ) => ResolvedModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runPromptLoopFn: (input: any) => Promise<{
    text: string;
    steps: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>;
}

/** Inject the task tool if allowed by profile. */
async function injectTaskTool(
  set: ToolSet,
  wireCtx: DynamicToolWireContext,
  callerAgentConfig: import("../config/index.js").RuntimeAgentConfig,
  opts: DynamicToolOpts,
): Promise<void> {
  const env = opts.workDir ? buildResolvedEnv(opts.workDir) : undefined;
  const taskToolInfo = createTaskTool({
    db: opts.db,
    instanceSlug: opts.instanceSlug,
    resolvedModel: opts.resolvedModel,
    workDir: opts.workDir,
    ...(opts.subagentsConfig !== undefined ? { subagentsConfig: opts.subagentsConfig } : {}),
    agentPermissions: callerAgentConfig.permissions,
    ...(opts.compactionConfig !== undefined ? { compactionConfig: opts.compactionConfig } : {}),
    callerAgentConfig,
    ...(opts.runtimeAgentConfigs !== undefined
      ? { runtimeAgentConfigs: opts.runtimeAgentConfigs }
      : {}),
    ...(opts.runtimeConfig?.models !== undefined
      ? { modelAliases: opts.runtimeConfig.models }
      : {}),
    ...(opts.resolveTargetModel !== undefined
      ? { resolveTargetModel: opts.resolveTargetModel }
      : {}),
    ...(env !== undefined ? { env } : {}),
    runPromptLoop: opts.runPromptLoopFn,
  });
  await wireDynamicTool(set, "task", taskToolInfo, wireCtx);
}

/** Inject the send_message tool if allowed by profile. */
async function injectSendMessageTool(
  set: ToolSet,
  wireCtx: DynamicToolWireContext,
  callerAgentConfig: import("../config/index.js").RuntimeAgentConfig,
  opts: DynamicToolOpts,
): Promise<void> {
  const sendMsgToolInfo = createSendMessageTool({
    db: opts.db,
    instanceSlug: opts.instanceSlug,
    resolvedModel: opts.resolvedModel,
    workDir: opts.workDir,
    callerAgentConfig,
    ...(opts.runtimeAgentConfigs !== undefined
      ? { runtimeAgentConfigs: opts.runtimeAgentConfigs }
      : {}),
    ...(opts.runtimeConfig?.models !== undefined
      ? { modelAliases: opts.runtimeConfig.models }
      : {}),
    ...(opts.resolveTargetModel !== undefined
      ? { resolveTargetModel: opts.resolveTargetModel }
      : {}),
    ...(opts.compactionConfig !== undefined ? { compactionConfig: opts.compactionConfig } : {}),
    runPromptLoop: opts.runPromptLoopFn,
  });
  await wireDynamicTool(set, "send_message", sendMsgToolInfo, wireCtx);
}

/** Inject dynamic tools (task, task_board, send_message) based on the agent's tool profile. */
async function injectDynamicTools(
  set: ToolSet,
  wireCtx: DynamicToolWireContext,
  callerAgentConfig: import("../config/index.js").RuntimeAgentConfig,
  opts: DynamicToolOpts,
): Promise<void> {
  const profile = callerAgentConfig.toolProfile ?? "executor";
  const allowedTools = new Set(
    profile === "custom" ? (callerAgentConfig.customTools ?? []) : (TOOL_PROFILES[profile] ?? []),
  );

  if (allowedTools.has("task")) {
    await injectTaskTool(set, wireCtx, callerAgentConfig, opts);
  }

  if (allowedTools.has("task_board")) {
    await wireDynamicTool(
      set,
      "task_board",
      createTaskBoardTool({ db: opts.db, instanceSlug: opts.instanceSlug }),
      wireCtx,
    );
  }

  if (allowedTools.has("send_message")) {
    await injectSendMessageTool(set, wireCtx, callerAgentConfig, opts);
  }
}

/** Wire the invalid tool (catch-all for hallucinated tool names). */
function wireInvalidTool(set: ToolSet, tools: Tool.Info[]): void {
  const availableToolNames = tools.map((t) => t.id);
  const invalidToolSchema = z.object({
    toolName: z.string(),
    reason: z.string().optional(),
  });
  set["invalid"] = aiTool({
    description: "",
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
}

export type { ToolSet, McpRegistry };
