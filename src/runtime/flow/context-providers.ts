// src/runtime/flow/context-providers.ts
//
// Extension point: flow-context-providers.
//
// Registry of named providers that contribute key/value pairs to the
// templating context of a flow step briefing. Each provider is a pure
// function called once per step run, before `buildBriefing`. Its returned
// object is merged into the templating context under its registered name
// (e.g. provider "trigger" → context.trigger = { ... }).
//
// Templates use `{{ path.to.value }}` syntax inside `step.prompt` and
// `step.briefing.extraContext`. Unknown paths are left as-is so legacy
// prompts that happen to contain `{{...}}` are not silently mangled.
//
// This module ships no providers. It is the no-op extension point that
// downstream features (e.g. TRIGGER-001 with `$trigger.payload`) plug into.
//
// Extension-Point: flow-context-providers

import type { InstanceSlug, AgentId } from "../types.js";
import type { FlowStepDef } from "./types.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FlowContextProviderArgs {
  instanceSlug: InstanceSlug;
  agentId: AgentId;
  flowName: string;
  step: FlowStepDef;
  /** Run-scoped facts the engine has at briefing time. */
  runId: number;
}

/**
 * A flow context provider produces a key/value bag merged into the
 * templating context under the provider's registered name.
 *
 * Providers MUST be synchronous and side-effect-free. They are called on
 * every step's briefing build — keep them cheap.
 */
export type FlowContextProvider = (args: FlowContextProviderArgs) => Record<string, unknown>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const providers = new Map<string, FlowContextProvider>();

/** Register a provider under `name`. Re-registering replaces silently. */
export function registerFlowContextProvider(name: string, provider: FlowContextProvider): void {
  if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid flow context provider name: "${name}"`);
  }
  providers.set(name, provider);
}

/** Remove a provider. Returns true if a provider was removed. */
export function unregisterFlowContextProvider(name: string): boolean {
  return providers.delete(name);
}

/** Test helper — clears the registry. Not exported via barrel. */
export function _resetFlowContextProvidersForTests(): void {
  providers.clear();
}

/** Collect the templating context by invoking every registered provider. */
export function collectFlowContext(args: FlowContextProviderArgs): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const [name, provider] of providers) {
    try {
      ctx[name] = provider(args);
    } catch (err) {
      logger.warn("flow_context_provider_failed", {
        event: "flow_context_provider_failed",
        provider: name,
        error: err instanceof Error ? err.message : String(err),
      });
      ctx[name] = {};
    }
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Templating
// ---------------------------------------------------------------------------

// Allow kebab-case segments (e.g. `{{step-investigate.summary}}`) — step ids
// in flow definitions accept dashes, and run-time vars from `POST /flows/:id/run`
// may carry dashed keys.
const TEMPLATE_TAG = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g;

/**
 * Substitute `{{ path.to.value }}` tags in `template` with values resolved
 * from `context`. Unknown paths are preserved verbatim so existing prompts
 * containing literal `{{...}}` are not mutated.
 *
 * Resolved values are stringified via `String(value)`. Objects render as
 * `[object Object]` — providers should expose primitive leaves, not nested
 * payloads. Arrays render comma-joined.
 */
export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  if (!template.includes("{{")) return template;
  return template.replace(TEMPLATE_TAG, (match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null) return match;
    if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
    return String(value);
  });
}

function resolvePath(context: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = context;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
