/**
 * runtime/plugin/index.ts
 *
 * Barrel export for the plugin system.
 */

export type {
  Plugin,
  PluginDescriptor,
  PluginHooks,
  PluginInput,
  AgentStartContext,
  AgentEndContext,
  ToolCallContext,
  ToolResultContext,
  MessageContext,
  SessionContext,
} from "./types.js";

export {
  registerHooks,
  clearHooks,
  getRegisteredHooks,
  triggerAgentBeforeStart,
  triggerAgentEnd,
  triggerToolBeforeCall,
  triggerToolAfterCall,
  triggerMessageReceived,
  triggerMessageSending,
  triggerSessionStart,
  triggerSessionEnd,
} from "./hooks.js";

export { registerPlugin, initPlugins, loadPluginFromFile, resetPlugins } from "./plugin.js";
