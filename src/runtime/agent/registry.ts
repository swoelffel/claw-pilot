/**
 * runtime/agent/registry.ts
 *
 * Agent registry for claw-runtime.
 *
 * Provides:
 * - Built-in agents (always available)
 * - Config-based agent overrides (from RuntimeConfig.agents)
 * - get() / list() / defaultAgent() API
 */

import { Agent } from "./agent.js";
import { BUILTIN_AGENTS } from "./defaults.js";
import type { RuntimeAgentConfig, AgentPersistence } from "../config/index.js";

// ---------------------------------------------------------------------------
// Registry state (module-level singleton, reset on init)
// ---------------------------------------------------------------------------

let _registry: Map<string, Agent.Info> | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the registry from a list of agent configs.
 * Merges config overrides on top of built-in agents.
 * Call this once at runtime startup.
 */
export function initAgentRegistry(agentConfigs: RuntimeAgentConfig[]): void {
  const registry = new Map<string, Agent.Info>();

  // Start with built-ins
  for (const agent of BUILTIN_AGENTS) {
    registry.set(agent.name, { ...agent });
  }

  // Apply config overrides
  for (const cfg of agentConfigs) {
    const existing = registry.get(cfg.id);

    if (existing) {
      // Override built-in
      registry.set(cfg.id, mergeAgentConfig(existing, cfg));
    } else {
      // New user-defined agent
      registry.set(cfg.id, createFromConfig(cfg));
    }
  }

  _registry = registry;
}

/**
 * Get an agent by name. Returns undefined if not found.
 */
export function getAgent(name: string): Agent.Info | undefined {
  return getRegistry().get(name);
}

/**
 * List all agents. Optionally filter by mode.
 */
export function listAgents(options?: {
  mode?: Agent.Info["mode"] | "primary" | "subagent";
  includeHidden?: boolean;
}): Agent.Info[] {
  const all = Array.from(getRegistry().values());

  return all.filter((a) => {
    if (!options?.includeHidden && a.hidden) return false;
    if (options?.mode) {
      if (options.mode === "primary") return a.mode === "primary" || a.mode === "all";
      if (options.mode === "subagent") return a.mode === "subagent" || a.mode === "all";
      return a.mode === options.mode;
    }
    return true;
  });
}

/**
 * Return the name of the default primary agent.
 * Prefers "build" if available, otherwise first visible primary agent.
 */
export function defaultAgentName(): string {
  const registry = getRegistry();

  const build = registry.get("build");
  if (build && build.mode !== "subagent" && !build.hidden) {
    return "build";
  }

  for (const agent of registry.values()) {
    if (agent.mode !== "subagent" && !agent.hidden) {
      return agent.name;
    }
  }

  throw new Error("No primary visible agent found in registry");
}

/**
 * Reset the registry (useful for testing).
 */
export function resetAgentRegistry(): void {
  _registry = undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getRegistry(): Map<string, Agent.Info> {
  if (!_registry) {
    // Lazy init with no overrides
    initAgentRegistry([]);
  }
  // _registry is guaranteed to be set after initAgentRegistry()
  return _registry as Map<string, Agent.Info>;
}

/**
 * Resolve the effective persistence for an agent.
 * Priority: explicit config value > kind inference > safe default.
 */
export function resolveEffectivePersistence(
  agentInfo: Agent.Info,
  config?: RuntimeAgentConfig,
): AgentPersistence {
  // 1. Explicit value in runtime.json config
  if (config?.persistence !== undefined) return config.persistence;

  // 2. Infer from kind
  if (agentInfo.kind === "primary") return "permanent";
  if (agentInfo.kind === "subagent") return "ephemeral";

  // 3. Safe default
  return "ephemeral";
}

/**
 * Merge a RuntimeAgentConfig override onto an existing Agent.Info.
 */
function mergeAgentConfig(base: Agent.Info, cfg: RuntimeAgentConfig): Agent.Info {
  const result: Agent.Info = { ...base };

  if (cfg.name) result.name = cfg.name;
  if (cfg.systemPrompt) result.prompt = cfg.systemPrompt;
  if (cfg.temperature !== undefined) result.temperature = cfg.temperature;
  if (cfg.maxSteps !== undefined) result.steps = cfg.maxSteps;
  // model is always set in RuntimeAgentConfig (required field)
  result.model = cfg.model;

  // Merge permissions: config permissions appended after base (last-match-wins)
  if (cfg.permissions.length > 0) {
    result.permission = [...base.permission, ...cfg.permissions];
  }

  return result;
}

/**
 * Create a new Agent.Info from a RuntimeAgentConfig (for user-defined agents).
 * User-defined agents default to mode "all" and kind "primary" (safe default).
 */
function createFromConfig(cfg: RuntimeAgentConfig): Agent.Info {
  // User-defined agents have no mode in RuntimeAgentConfig — default to "all"
  // kind defaults to "primary" (safe default: visible agent = primary agent)
  return Agent.Info.parse({
    name: cfg.name,
    mode: "all",
    kind: "primary",
    native: false,
    prompt: cfg.systemPrompt,
    temperature: cfg.temperature,
    steps: cfg.maxSteps,
    model: cfg.model,
    permission: cfg.permissions,
    options: {},
  });
}
