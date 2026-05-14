// src/runtime/flow/complete-step-tool.ts
//
// `complete_step` tool — factory-created, flow-session-only.
//
// This tool replaces the fragile regex-based SITREP extraction from free text.
// Every flow step agent MUST call this tool as its final action to record a
// structured SITREP. The tool writes `sitrep_json` directly to `rt_flow_step_runs`
// via the DB handle captured at construction time.
//
// Availability: this factory is the ONLY way the tool enters a session's tool
// set. It is NOT in `BUILTIN_TOOLS` (src/runtime/tool/built-in/index.ts), so it
// is structurally invisible outside flow step sessions. `step-executor.ts`
// creates an instance per step run and injects it via `extraTools` on
// `ChannelRouter.route()` → `runPromptLoop()`.

import type Database from "better-sqlite3";
import { z } from "zod";
import { Tool } from "../tool/tool.js";
import { updateStepRun } from "../../core/repositories/flow-repository.js";
import { normaliseSitrepArgs } from "./_sitrep-normalizer.js";

/**
 * Default maxSteps for flow step sessions. Higher than the interactive default
 * (20) to accommodate multi-tool mission workflows (clone repo → read files →
 * edit × N → git add/commit/push → PR → complete_step).
 */
export const FLOW_DEFAULT_MAX_STEPS = 50;

export const CompleteStepSchema = z.preprocess(
  normaliseSitrepArgs,
  z.object({
    outcome: z
      .enum(["success", "failure", "partial", "stopped"])
      .describe(
        "success: mission fully accomplished. failure: unable to proceed — explain in summary. " +
          "partial: some work done but the mission is incomplete (timeout, partial data, etc.). " +
          "stopped: gate decision — this step intentionally halts downstream steps (run counts as completed, not failed).",
      ),
    summary: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "One to three sentences describing what was achieved (for success), attempted " +
          "(for partial), or why the mission failed (for failure). Be specific — downstream " +
          "steps read this to decide their own actions.",
      ),
    keyFindings: z
      .array(z.string().max(2000))
      .default([])
      .describe(
        "Bullet-point list of notable observations, outputs, URLs, file paths, or decisions. " +
          "Kept separate from summary so downstream consumers can parse them. " +
          "Each item is capped at 2000 characters.",
      ),
  }),
);

/**
 * Create a `complete_step` tool bound to a specific flow step run.
 *
 * The returned `Tool.Info` writes the structured SITREP to the DB row identified
 * by `stepRunId` when invoked. The engine reads that value back after the session
 * ends, so this tool is the single source of truth for the step outcome — the
 * regex-based `extractSitrep()` is retained only as a fallback for sessions that
 * do not receive this tool (i.e. non-flow sessions, which cannot reach this
 * factory at all).
 */
export function createCompleteStepTool(
  db: Database.Database,
  stepRunId: number,
): Tool.Info<typeof CompleteStepSchema> {
  return Tool.define("complete_step", {
    description:
      "Report mission completion for this flow step. Call this tool as your FINAL " +
      "action — calling it is MANDATORY. The flow engine records the structured " +
      "SITREP from your arguments. Without this call, your step is marked as failed " +
      "regardless of what other work you performed.",
    parameters: CompleteStepSchema,
    execute: async (args) => {
      // Tool.define validates via Zod.parse() but forwards the original (pre-parse)
      // args to execute(). Re-parse here so z.preprocess normalisation and
      // z.default() values are applied before we write to the DB.
      const parsed = CompleteStepSchema.parse(args);
      const keyFindings = parsed.keyFindings ?? [];
      updateStepRun(db, stepRunId, {
        sitrepJson: JSON.stringify({
          outcome: parsed.outcome,
          summary: parsed.summary,
          keyFindings,
        }),
      });
      return {
        title: `SITREP recorded — ${parsed.outcome}`,
        output: `Step SITREP saved (outcome=${parsed.outcome}). The engine will now mark this step as completed and notify downstream steps.`,
        truncated: false,
      };
    },
  });
}
