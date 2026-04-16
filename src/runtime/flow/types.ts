// src/runtime/flow/types.ts
//
// Type definitions for the flow orchestration engine.

import type Database from "better-sqlite3";
import type { Registry } from "../../core/registry.js";
import type { RuntimeConfig } from "../config/index.js";
import type { InstanceSlug } from "../types.js";

// ---------------------------------------------------------------------------
// Flow step definition (stored as JSON in rt_flow_definitions.steps_json)
// ---------------------------------------------------------------------------

export interface FlowStepDef {
  id: string;
  agentId: string;
  prompt: string;
  /**
   * Other step ids this step waits on. Optional — root steps omit this field
   * entirely in the stored JSON (matches the Zod schema in the flow creation
   * tools and routes). Callers MUST treat `undefined` as equivalent to `[]`.
   */
  dependsOn?: string[];
  timeoutMs?: number;
  retries?: number;
  /**
   * Soft cap on the number of LLM steps the agent may consume for this step.
   * Default when omitted: `FLOW_DEFAULT_MAX_STEPS` (50) — higher than the
   * interactive session default (20) to accommodate multi-tool mission workflows
   * (clone repo, read files, edit, commit, push, PR, complete_step).
   *
   * When the agent approaches this limit, a system reminder is injected
   * giving it the choice to call `complete_step` or `request_step_extension`.
   * Hard cap is `softCap × 2` (capped at 200).
   */
  maxSteps?: number;
  /**
   * When true, this step runs even if its upstream dependencies did not
   * finish with `outcome: "success"` (either the sitrep outcome was
   * failure/partial, or the dependency step itself threw an exception).
   * Default: false — any non-success upstream causes this step to be
   * marked `skipped` without running.
   *
   * Typical use case: a `notify` / cleanup step that should execute
   * whatever happened, so the user gets a report of the failure.
   */
  continueOnFailure?: boolean;
  briefing?: {
    /**
     * Number of recent messages to inject from the agent's permanent session
     * as "standing context" in the mission briefing.
     *
     * Default: 0 (disabled for flow steps). Permanent session history
     * accumulates SITREPs across runs and can contaminate future briefings
     * with stale references to step names / agents that no longer exist.
     * Opt-in explicitly (`> 0`) only when the agent genuinely needs
     * institutional memory across runs (e.g., a continuity-tracking agent).
     */
    includeLastN?: number;
    extraContext?: string;
  };
}

// ---------------------------------------------------------------------------
// SITREP result (structured extraction from agent response)
// ---------------------------------------------------------------------------

export interface SitrepResult {
  outcome: "success" | "failure" | "partial";
  summary: string;
  keyFindings: string[];
}

// ---------------------------------------------------------------------------
// Flow engine context
// ---------------------------------------------------------------------------

export interface FlowEngineContext {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  registry: Registry;
  config: RuntimeConfig;
  workDir: string | undefined;
  abort?: AbortController;
}
