// src/runtime/flow/step-executor.ts
//
// Executes a single flow step via the runtime's ChannelRouter.
// The runtime daemon has already initialized agent registry, middlewares, and config.
// No dashboard imports — fully decoupled.

import { createSession } from "../session/session.js";
import { ChannelRouter } from "../channel/router.js";
import type { FlowEngineContext } from "./types.js";
import { createCompleteStepTool, FLOW_DEFAULT_MAX_STEPS } from "./complete-step-tool.js";
import { createStepExtensionTool } from "./step-extension-tool.js";
import type { FlowStepState } from "./step-extension-tool.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepExecutionResult {
  sessionId: string;
  text: string;
  tokens: { input: number; output: number };
  costUsd: number;
}

interface StepExecutionInput {
  agentId: string;
  briefingText: string;
  flowName: string;
  stepId: string;
  /**
   * DB row id of the `rt_flow_step_runs` record for this step run. Passed so
   * that the injected `complete_step` tool can write `sitrep_json` directly
   * to this specific row — no correlation id or metadata plumbing required.
   */
  stepRunId: number;
  /** Soft cap on LLM steps for this step. Defaults to FLOW_DEFAULT_MAX_STEPS. */
  maxSteps?: number;
  timeoutMs?: number;
  abort?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

/**
 * Execute a single flow step: create ephemeral session, route through ChannelRouter.
 * Uses the runtime's already-initialized agent registry, middlewares, and config.
 */
export async function executeStep(
  ctx: FlowEngineContext,
  input: StepExecutionInput,
): Promise<StepExecutionResult> {
  const { db, instanceSlug, config } = ctx;
  const { agentId, briefingText, flowName, stepId } = input;

  // 1. Create ephemeral mission session
  const session = createSession(db, {
    instanceSlug,
    agentId,
    channel: "web",
    label: `flow:${flowName}:step:${stepId}`,
  });

  // 2. Set up timeout
  const timeoutMs = input.timeoutMs ?? 300_000;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort(new Error(`Step "${stepId}" timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (input.abort) {
    if (input.abort.aborted) {
      clearTimeout(timeoutId);
      abortController.abort(input.abort.reason);
    } else {
      input.abort.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        abortController.abort(input.abort!.reason);
      });
    }
  }

  // 3. Build per-step flow tools (complete_step + request_step_extension).
  //    Both are factory tools — NOT in BUILTIN_TOOLS, invisible outside flow
  //    step sessions.
  const completeStepTool = createCompleteStepTool(db, input.stepRunId);

  // Mutable state shared between request_step_extension and the prompt loop's
  // stopWhen / reminder logic. The soft cap defaults to FLOW_DEFAULT_MAX_STEPS
  // (50) if not overridden in the step definition. The hard cap is 2× the soft
  // cap, clamped at 200.
  const softCap = input.maxSteps ?? FLOW_DEFAULT_MAX_STEPS;
  const flowStepState: FlowStepState = {
    effectiveMaxSteps: softCap,
    hardCap: Math.min(softCap * 2, 200),
  };
  const extensionTool = createStepExtensionTool(flowStepState);

  try {
    // 4. Route through ChannelRouter (uses runtime's initialized middlewares + agent registry)
    //    Pass sessionId so messages are persisted in the mission session, not the permanent one.
    const result = await ChannelRouter.route({
      db,
      instanceSlug,
      config,
      message: {
        channelType: "web",
        peerId: "flow-engine",
        text: briefingText,
      },
      agentId,
      sessionId: session.id,
      ...(ctx.workDir !== undefined ? { workDir: ctx.workDir } : {}),
      abort: abortController.signal,
      extraTools: [completeStepTool, extensionTool],
      maxSteps: softCap,
      flowStepState,
    });

    return {
      sessionId: session.id,
      text: result.response.text,
      tokens: {
        input: result.tokens.input,
        output: result.tokens.output,
      },
      costUsd: result.costUsd,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
