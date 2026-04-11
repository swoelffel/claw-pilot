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
  dependsOn: string[];
  timeoutMs?: number;
  retries?: number;
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
