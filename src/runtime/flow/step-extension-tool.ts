// src/runtime/flow/step-extension-tool.ts
//
// `request_step_extension` tool — factory-created, flow-session-only.
//
// When a flow step agent approaches its maxSteps soft cap, the prompt loop
// injects a system reminder giving it two choices: call `complete_step` to
// finish, or call this tool to request more steps. The tool mutates a
// shared `FlowStepState` object that the prompt loop's `stopWhen` closure
// reads on every evaluation — no SDK restart needed.
//
// Hard cap (`state.hardCap`) cannot be exceeded. If the agent asks for
// more steps than remain before the hard cap, the granted amount is
// clamped. If the hard cap is already reached, the tool says "denied".
//
// Availability: same as `complete_step` — NOT in `BUILTIN_TOOLS`, created
// per-step by `step-executor.ts`, injected via `extraTools`.

import { z } from "zod";
import { Tool } from "../tool/tool.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

/**
 * Mutable state shared between the `request_step_extension` tool and the
 * prompt loop's `stopWhen` / system-reminder logic. Created per step run
 * in `step-executor.ts` and passed by reference through the call chain.
 */
export interface FlowStepState {
  /** Current effective max steps — starts at the soft cap, grows on extension. */
  effectiveMaxSteps: number;
  /** Absolute ceiling — cannot be exceeded. Typically `softCap × 2` capped at 200. */
  hardCap: number;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const StepExtensionSchema = z.object({
  reason: z
    .string()
    .max(500)
    .describe("Brief explanation of why more steps are needed to complete the mission."),
  additionalSteps: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Number of additional steps requested (default 20, max 50 per request)."),
});

/**
 * Create a `request_step_extension` tool bound to a shared `FlowStepState`.
 *
 * When invoked, the tool increases `state.effectiveMaxSteps` by the requested
 * amount (clamped at `state.hardCap`). The prompt loop's `stopWhen` closure
 * reads `state.effectiveMaxSteps` on every step evaluation, so the extension
 * takes effect immediately without restarting the stream.
 */
export function createStepExtensionTool(
  state: FlowStepState,
): Tool.Info<typeof StepExtensionSchema> {
  return Tool.define("request_step_extension", {
    description:
      "Request additional LLM steps to continue your mission. Call this when " +
      "you receive the steps-limit warning and need more steps to complete " +
      "your work (e.g. you still have files to edit, commits to push, or a " +
      "PR to open). The engine will grant the extension up to a hard cap. " +
      "After the extension, continue your work and call `complete_step` when done.",
    parameters: StepExtensionSchema,
    execute: async (args) => {
      const requested = args.additionalSteps ?? 20;
      const newLimit = Math.min(state.effectiveMaxSteps + requested, state.hardCap);
      const granted = newLimit - state.effectiveMaxSteps;
      state.effectiveMaxSteps = newLimit;

      logger.debug("flow_step_extension", {
        requested,
        granted,
        newLimit,
        hardCap: state.hardCap,
        reason: args.reason,
      });

      if (granted > 0) {
        return {
          title: `Extension granted: +${granted} steps`,
          output:
            `Extension granted: ${granted} additional steps (new limit: ${newLimit}, ` +
            `hard cap: ${state.hardCap}). Continue your work and call complete_step when done.`,
          truncated: false,
        };
      }
      return {
        title: "Extension denied — hard cap reached",
        output:
          `Extension denied: hard cap reached (${state.hardCap} steps). ` +
          `You cannot get more steps. Call complete_step immediately to report ` +
          `whatever progress you have made.`,
        truncated: false,
      };
    },
  });
}
