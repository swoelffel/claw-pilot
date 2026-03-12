/**
 * runtime/session/prompt-loop.ts
 *
 * The main agent loop — orchestrates LLM calls via Vercel AI SDK (streamText),
 * handles tool calls, persists messages/parts to DB, and emits bus events.
 *
 * Design decisions (V1):
 * - The caller resolves the model + API key (no key resolution here)
 * - stopWhen: stepCountIs(maxSteps) handles the tool call → response loop
 * - No compaction in this module — handled by compaction.ts (called by the runtime engine)
 */

import {
  streamText,
  stepCountIs,
  zodSchema,
  tool as aiTool,
  type ModelMessage,
  type ToolSet,
  type ToolResultPart,
} from "ai";
import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { Tool } from "../tool/tool.js";
import { getTools } from "../tool/registry.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getSession } from "./session.js";
import {
  createUserMessage,
  createAssistantMessage,
  updateMessageMetadata,
  listMessages,
} from "./message.js";
import { createPart, updatePartState, listParts } from "./part.js";
import { getBus } from "../bus/index.js";
import {
  SessionStatusChanged,
  MessageCreated,
  MessageUpdated,
  MessagePartDelta,
} from "../bus/events.js";
import type { MessageInfo } from "./message.js";

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
  /** AbortSignal to cancel the loop */
  abort?: AbortSignal;
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
  const { db, instanceSlug, sessionId, userText, agentConfig, resolvedModel, workDir } = input;

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

  // Emit busy status
  bus.publish(SessionStatusChanged, { sessionId, status: "busy" });

  let assistantMsgId: string | undefined;

  try {
    // 1. Create user message
    const userMsg = createUserMessage(db, { sessionId, text: userText });
    bus.publish(MessageCreated, { sessionId, messageId: userMsg.id, role: "user" });

    // 2. Build system prompt
    const systemPrompt = buildSystemPrompt({
      instanceSlug,
      agentConfig,
      channel: session.channel,
      workDir,
    });

    // 3. Load message history
    const allMessages = listMessages(db, sessionId);
    const coreMessages = buildCoreMessages(db, allMessages);

    // 4. Create empty assistant message
    const assistantMsg = createAssistantMessage(db, {
      sessionId,
      agentId: agentConfig.id,
      model: `${resolvedModel.providerId}/${resolvedModel.modelId}`,
    });
    assistantMsgId = assistantMsg.id;
    bus.publish(MessageCreated, { sessionId, messageId: assistantMsg.id, role: "assistant" });

    // 5. Load tools
    const toolInfos = await getTools();
    const toolCtx: Tool.Context = {
      sessionId,
      messageId: assistantMsg.id,
      agentId: agentConfig.id,
      abort: input.abort ?? new AbortController().signal,
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
    );

    // 6. Stream the response
    let textPartId: string | undefined;
    let accumulatedText = "";
    let stepCount = 0;

    const streamResult = streamText({
      model: resolvedModel.languageModel,
      system: systemPrompt,
      messages: coreMessages,
      tools: toolSet,
      stopWhen: stepCountIs(agentConfig.maxSteps),
      ...(input.abort !== undefined && { abortSignal: input.abort }),
      onChunk: async ({ chunk }) => {
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
    const tokensIn = usage.inputTokens ?? 0;
    const tokensOut = usage.outputTokens ?? 0;
    const cacheRead = 0;
    const cacheWrite = 0;

    const costUsd = resolvedModel.costPerMillion
      ? (tokensIn * resolvedModel.costPerMillion.input +
          tokensOut * resolvedModel.costPerMillion.output) /
        1_000_000
      : 0;

    // 8. Update assistant message with metadata
    updateMessageMetadata(db, assistantMsg.id, {
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: await finalResult.finishReason,
    });

    bus.publish(MessageUpdated, { sessionId, messageId: assistantMsg.id });

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
    bus.publish(SessionStatusChanged, { sessionId, status: "idle" });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
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
      const textParts = parts.filter((p) => p.type === "text");
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

  return result;
}

/**
 * Convert Tool.Info[] to Vercel AI SDK ToolSet.
 */
async function buildToolSet(
  tools: Tool.Info[],
  ctx: Tool.Context,
  db: Database.Database,
  messageId: string,
  instanceSlug: InstanceSlug,
  sessionId: SessionId,
): Promise<ToolSet> {
  const set: ToolSet = {};
  const bus = getBus(instanceSlug);

  for (const toolInfo of tools) {
    const def = await toolInfo.init();

    set[toolInfo.id] = aiTool({
      description: def.description,
      inputSchema: zodSchema(def.parameters),
      execute: async (args: unknown) => {
        // Create tool_call part
        const part = createPart(db, {
          messageId,
          type: "tool_call",
          metadata: JSON.stringify({
            toolName: toolInfo.id,
            args,
          }),
        });

        try {
          const result = await def.execute(args as never, ctx);

          // Update part to completed
          updatePartState(db, part.id, "completed", result.output);
          bus.publish(MessageUpdated, { sessionId, messageId });

          return result.output;
        } catch (err) {
          // Update part to error
          updatePartState(db, part.id, "error", err instanceof Error ? err.message : String(err));
          bus.publish(MessageUpdated, { sessionId, messageId });
          throw err;
        }
      },
    });
  }

  return set;
}
