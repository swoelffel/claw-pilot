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
