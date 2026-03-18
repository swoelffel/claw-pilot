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

import { tool as aiTool, zodSchema } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { InstanceSlug, SessionId } from "../types.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { Tool } from "../tool/tool.js";
import type { RuntimeConfig, SubagentsConfig } from "../config/index.js";
import type { McpRegistry } from "../mcp/registry.js";
import type { PluginInput } from "../plugin/types.js";
import { normalizeForProvider } from "../tool/normalize.js";
import { createPart, listParts, updatePartState } from "./part.js";
import { getBus } from "../bus/index.js";
import { DoomLoopDetected, MessageUpdated } from "../bus/events.js";
import {
  triggerToolBeforeCall,
  triggerToolAfterCall,
  getRegisteredHooks,
} from "../plugin/hooks.js";
import { createMemorySearchTool } from "../memory/search-tool.js";
import { rebuildMemoryIndex } from "../memory/index.js";
import { createTaskTool } from "../tool/task.js";
import { invalidateWorkspaceCache } from "./workspace-cache.js";

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
    } catch {
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
): Promise<ToolSet> {
  const set: ToolSet = {};
  const bus = getBus(instanceSlug);

  const recentCalls: Array<{ tool: string; hash: string }> = [];

  for (const toolInfo of tools) {
    let def = await toolInfo.init();

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

    if (def.ownerOnly && !ctx.senderIsOwner) continue;

    const normalizedParams = normalizeForProvider(def.parameters, resolvedModel.providerId);

    set[toolInfo.id] = aiTool({
      description: def.description,
      inputSchema: zodSchema(normalizedParams),
      execute: async (args: unknown, options: { toolCallId: string }) => {
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

        await triggerToolBeforeCall({
          instanceSlug,
          sessionId,
          messageId,
          toolName: toolInfo.id,
          args,
        }).catch((err) => {
          console.warn("[claw-runtime] plugin hook tool.beforeCall threw:", err);
        });

        // Reuse the part created by onChunk Path-A (which has toolCallId).
        // This prevents duplicate tool_call parts in the DB.
        const part = getOrCreateToolCallPart(db, messageId, options.toolCallId, toolInfo.id, args);

        const callStart = Date.now();
        try {
          const result = await def.execute(args as never, ctx);

          const durationMs = Date.now() - callStart;
          updatePartState(db, part.id, "completed", result.output);
          // Persist durationMs in metadata so the UI can display execution time.
          // Keep toolCallId so message-builder can correlate tool_call ↔ tool_result.
          db.prepare("UPDATE rt_parts SET metadata = ?, updated_at = ? WHERE id = ?").run(
            JSON.stringify({
              toolCallId: options.toolCallId,
              toolName: toolInfo.id,
              args,
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
            args,
            output: result.output,
            durationMs,
          }).catch((err) => {
            console.warn("[claw-runtime] plugin hook tool.afterCall threw:", err);
          });

          // Invalidate workspace cache for write/edit operations
          if (toolInfo.id === "write" || toolInfo.id === "edit" || toolInfo.id === "multiedit") {
            const writtenPath: string | undefined =
              typeof args === "object" && args !== null && "filePath" in args
                ? String((args as { filePath: unknown }).filePath)
                : undefined;
            if (writtenPath) {
              invalidateWorkspaceCache(writtenPath);

              // Trigger memory re-indexation in background if a memory file was written
              if (memoryDb && workDir && isMemoryFile(writtenPath)) {
                void Promise.resolve().then(() => {
                  try {
                    rebuildMemoryIndex(memoryDb, workDir, ctx.agentId);
                  } catch {
                    // Silently ignore re-indexation errors
                  }
                });
              }
            }
          }

          return result.output;
        } catch (err) {
          updatePartState(db, part.id, "error", err instanceof Error ? err.message : String(err));
          bus.publish(MessageUpdated, { sessionId, messageId });

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

  if (callerAgentConfig && agentKind !== "subagent") {
    const profile = callerAgentConfig.toolProfile ?? "coding";
    if (profile === "full") {
      const taskToolInfo = createTaskTool({
        db,
        instanceSlug,
        resolvedModel,
        workDir,
        ...(subagentsConfig !== undefined ? { subagentsConfig } : {}),
        agentPermissions: callerAgentConfig.permissions,
        ...(compactionConfig !== undefined ? { compactionConfig } : {}),
        callerAgentConfig,
        ...(runtimeAgentConfigs !== undefined ? { runtimeAgentConfigs } : {}),
        ...(runtimeConfig?.models !== undefined ? { modelAliases: runtimeConfig.models } : {}),
        runPromptLoop: runPromptLoopFn,
      });
      const taskDef = await taskToolInfo.init();
      const normalizedTaskParams = normalizeForProvider(
        taskDef.parameters,
        resolvedModel.providerId,
      );
      set["task"] = aiTool({
        description: taskDef.description,
        inputSchema: zodSchema(normalizedTaskParams),
        execute: async (args: unknown, options: { toolCallId: string }) => {
          const part = getOrCreateToolCallPart(db, messageId, options.toolCallId, "task", args);
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

  if (memoryDb) {
    const memorySearchTool = createMemorySearchTool(memoryDb);
    const memoryDef = await memorySearchTool.init();
    set["memory_search"] = aiTool({
      description: memoryDef.description,
      inputSchema: zodSchema(memoryDef.parameters),
      execute: async (args: unknown, options: { toolCallId: string }) => {
        const part = getOrCreateToolCallPart(
          db,
          messageId,
          options.toolCallId,
          "memory_search",
          args,
        );
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

  return set;
}

export type { ToolSet, McpRegistry };
