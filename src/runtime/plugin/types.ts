/**
 * runtime/plugin/types.ts
 *
 * Plugin SDK types for claw-runtime.
 *
 * Plugins are JavaScript/TypeScript modules that export a default function
 * receiving a PluginInput and returning a PluginHooks object.
 *
 * Example plugin:
 * ```ts
 * import type { Plugin } from "claw-runtime/plugin";
 *
 * const myPlugin: Plugin = (input) => ({
 *   "agent.beforeStart": async (ctx) => {
 *     console.log("Agent starting:", ctx.agentName);
 *   },
 * });
 *
 * export default myPlugin;
 * ```
 */

import type { InstanceSlug, SessionId } from "../types.js";

// ---------------------------------------------------------------------------
// Hook context types
// ---------------------------------------------------------------------------

export interface AgentStartContext {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  agentName: string;
  model: string;
}

export interface AgentEndContext {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  agentName: string;
  /** Total tokens used in this session */
  tokensIn: number;
  tokensOut: number;
  /** Total cost in USD */
  costUsd: number;
}

export interface ToolCallContext {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  messageId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultContext {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  messageId: string;
  toolName: string;
  args: unknown;
  output: string;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface MessageContext {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  messageId: string;
  role: "user" | "assistant";
  text: string;
}

export interface SessionContext {
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
}

// ---------------------------------------------------------------------------
// Plugin hooks
// ---------------------------------------------------------------------------

export interface PluginHooks {
  /** Called before the agent starts processing a message */
  "agent.beforeStart"?: (ctx: AgentStartContext) => Promise<void> | void;
  /** Called after the agent finishes processing (success or error) */
  "agent.end"?: (ctx: AgentEndContext) => Promise<void> | void;
  /** Called before a tool is invoked */
  "tool.beforeCall"?: (ctx: ToolCallContext) => Promise<void> | void;
  /** Called after a tool returns a result */
  "tool.afterCall"?: (ctx: ToolResultContext) => Promise<void> | void;
  /** Called when a user message is received */
  "message.received"?: (ctx: MessageContext) => Promise<void> | void;
  /** Called when an assistant message is about to be sent */
  "message.sending"?: (ctx: MessageContext) => Promise<void> | void;
  /** Called when a session is created */
  "session.start"?: (ctx: SessionContext) => Promise<void> | void;
  /** Called when a session is archived/ended */
  "session.end"?: (ctx: SessionContext) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Plugin input (passed to plugin factory)
// ---------------------------------------------------------------------------

export interface PluginInput {
  instanceSlug: InstanceSlug;
  /** Working directory of the instance */
  workDir: string | undefined;
  /** Runtime version */
  version: string;
}

// ---------------------------------------------------------------------------
// Plugin factory type
// ---------------------------------------------------------------------------

/** A plugin is a function that receives input and returns hooks */
export type Plugin = (input: PluginInput) => PluginHooks | Promise<PluginHooks>;

/** Plugin descriptor (name + factory) */
export interface PluginDescriptor {
  name: string;
  plugin: Plugin;
}
