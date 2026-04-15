// src/runtime/flow/engine.ts
//
// Flow engine — DAG-based workflow orchestration.
// Executes flow steps in parallel where possible, respecting dependency edges.
// Uses the wakeup-agent pattern for step execution (config loading, prompt loop).

import type Database from "better-sqlite3";
import {
  createFlowRun,
  updateFlowRunStatus,
  createStepRun,
  updateStepRun,
  getStepRunsForRun,
  getReadySteps,
  allStepsTerminal,
  hasFailedSteps,
  hasUnsuccessfulSteps,
  getFlowDefinition,
  getStepRun,
} from "../../core/repositories/flow-repository.js";
import type { FlowStepDef, FlowEngineContext, SitrepResult } from "./types.js";
import { buildBriefing } from "./briefing.js";
import { extractSitrep, injectSitrep } from "./sitrep.js";
import { executeStep } from "./step-executor.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a flow run and execute its DAG asynchronously.
 * Returns the run ID immediately (fire-and-forget pattern).
 */
export function startFlowRun(
  ctx: FlowEngineContext,
  flowId: number,
  triggerType: string,
  triggerDetail?: string,
): number {
  const flow = getFlowDefinition(ctx.db, flowId);
  if (!flow) throw new Error(`Flow definition #${flowId} not found`);

  const run = createFlowRun(ctx.db, {
    flowId,
    instanceSlug: ctx.instanceSlug,
    triggerType,
    ...(triggerDetail !== undefined ? { triggerDetail } : {}),
  });

  // Fire-and-forget the DAG execution
  void executeFlowDag(ctx, run.id, flow.name, flow.steps_json).catch((err: unknown) => {
    logger.error("flow_run_failed", {
      event: "flow_run_failed",
      runId: run.id,
      flowId,
      error: err instanceof Error ? err.message : String(err),
    });
    updateFlowRunStatus(ctx.db, run.id, "failed", String(err));
  });

  return run.id;
}

// ---------------------------------------------------------------------------
// DAG execution
// ---------------------------------------------------------------------------

/** Execute the flow DAG — main loop. */
async function executeFlowDag(
  ctx: FlowEngineContext,
  runId: number,
  flowName: string,
  stepsJson: string,
): Promise<void> {
  const stepDefs = JSON.parse(stepsJson) as FlowStepDef[];

  // 1. Create step run records for all steps
  for (const def of stepDefs) {
    createStepRun(ctx.db, { runId, stepId: def.id, agentId: def.agentId });
  }

  // 2. Mark run as running
  updateFlowRunStatus(ctx.db, runId, "running");

  // 3. DAG execution loop
  const runningSteps = new Map<string, Promise<void>>();

  while (!allStepsTerminal(ctx.db, runId)) {
    // Check for cancellation
    if (ctx.abort?.signal.aborted) {
      skipPendingSteps(ctx.db, runId);
      updateFlowRunStatus(ctx.db, runId, "cancelled");
      return;
    }

    // Find steps ready to execute
    const ready = getReadySteps(ctx.db, runId, stepsJson);

    if (ready.length === 0 && runningSteps.size === 0) {
      // No ready steps, no running steps, but some pending → deadlock
      const steps = getStepRunsForRun(ctx.db, runId);
      const pending = steps.filter((s) => s.status === "pending");
      if (pending.length > 0) {
        updateFlowRunStatus(
          ctx.db,
          runId,
          "failed",
          `Deadlock: ${pending.length} step(s) blocked with unresolvable dependencies`,
        );
        return;
      }
      break;
    }

    // Launch ready steps in parallel
    for (const stepRun of ready) {
      const stepDef = stepDefs.find((d) => d.id === stepRun.step_id);
      if (!stepDef) continue;

      // Mark step as running before launching
      updateStepRun(ctx.db, stepRun.id, { status: "running" });

      const promise = runStep(ctx, runId, flowName, stepDef, stepDefs)
        .catch((err: unknown) => {
          logger.error("flow_step_error", {
            event: "flow_step_error",
            runId,
            stepId: stepDef.id,
            error: err instanceof Error ? err.message : String(err),
          });
          const current = getStepRun(ctx.db, runId, stepDef.id);
          if (current && current.status === "running") {
            updateStepRun(ctx.db, current.id, {
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            });
            // A thrown exception is a non-success outcome — propagate skip
            // to dependent steps that don't opt into continueOnFailure.
            propagateSkipDownstream(ctx.db, runId, stepDefs, stepDef.id);
          }
        })
        .finally(() => {
          runningSteps.delete(stepDef.id);
        });

      runningSteps.set(stepDef.id, promise);
    }

    // Wait for at least one running step to complete before re-evaluating
    if (runningSteps.size > 0) {
      await Promise.race(runningSteps.values());
    }
  }

  // 4. Determine final status.
  //    A run is "completed" only if every step finished with sitrep
  //    outcome=success AND no step threw an exception. Any failure,
  //    partial outcome, or malformed sitrep marks the run as failed,
  //    even if dependent steps executed under `continueOnFailure`.
  if (hasFailedSteps(ctx.db, runId) || hasUnsuccessfulSteps(ctx.db, runId)) {
    updateFlowRunStatus(ctx.db, runId, "failed", "One or more steps did not succeed");
  } else {
    updateFlowRunStatus(ctx.db, runId, "completed");
  }
}

// ---------------------------------------------------------------------------
// Single step execution
// ---------------------------------------------------------------------------

/** Execute a single flow step with briefing and SITREP cycle. */
async function runStep(
  ctx: FlowEngineContext,
  runId: number,
  flowName: string,
  stepDef: FlowStepDef,
  stepDefs: FlowStepDef[],
): Promise<void> {
  const stepRun = getStepRun(ctx.db, runId, stepDef.id);
  if (!stepRun) return;

  // 1. Collect SITREPs from dependency steps
  const depSitreps = _collectDepSitreps(ctx.db, runId, stepDef.dependsOn);

  // 2. Build briefing
  const briefingText = buildBriefing(ctx.db, {
    instanceSlug: ctx.instanceSlug,
    agentId: stepDef.agentId,
    flowName,
    step: stepDef,
    depSitreps,
  });

  // 3. Execute prompt loop
  const result = await executeStep(ctx, {
    agentId: stepDef.agentId,
    briefingText,
    flowName,
    stepId: stepDef.id,
    ...(stepDef.timeoutMs !== undefined ? { timeoutMs: stepDef.timeoutMs } : {}),
    ...(ctx.abort ? { abort: ctx.abort.signal } : {}),
  });

  // 4. Extract SITREP from result
  const sitrep = extractSitrep(result.text);

  // 5. Update step run with results
  updateStepRun(ctx.db, stepRun.id, {
    status: "completed",
    sessionId: result.sessionId,
    resultText: result.text,
    sitrepJson: JSON.stringify(sitrep),
    tokensIn: result.tokens.input,
    tokensOut: result.tokens.output,
    costUsd: result.costUsd,
  });

  // 6. If the step did not report outcome=success, propagate skip to
  //    dependent steps that do not opt into continueOnFailure. This
  //    prevents the classic "cascade of partial failures" where a bad
  //    upstream silently leaks into downstream steps that then run
  //    against empty/invalid input.
  if (sitrep.outcome !== "success") {
    propagateSkipDownstream(ctx.db, runId, stepDefs, stepDef.id);
  }

  // 7. Inject SITREP into permanent session (SITREP up)
  injectSitrep(ctx.db, {
    instanceSlug: ctx.instanceSlug,
    agentId: stepDef.agentId,
    flowName,
    stepId: stepDef.id,
    sitrep,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect SITREPs from completed dependency steps.
 *
 * Exported for unit testing — the internal `_` prefix marks it as not
 * part of the public flow engine API. Root steps may omit `dependsOn`
 * entirely in the stored JSON (Zod schema makes it optional), so this
 * function MUST treat `undefined` as equivalent to `[]`.
 */
export function _collectDepSitreps(
  db: Database.Database,
  runId: number,
  dependsOn: string[] | undefined,
): Array<{ stepId: string; sitrep: SitrepResult }> {
  const result: Array<{ stepId: string; sitrep: SitrepResult }> = [];
  if (!dependsOn) return result;
  for (const depId of dependsOn) {
    const depStep = getStepRun(db, runId, depId);
    if (depStep?.sitrep_json) {
      try {
        result.push({ stepId: depId, sitrep: JSON.parse(depStep.sitrep_json) as SitrepResult });
      } catch (err) {
        logger.debug("flow_sitrep_parse_failed", { stepId: depId, error: String(err) });
      }
    }
  }
  return result;
}

/** Mark all pending steps as skipped (used on cancellation). */
function skipPendingSteps(db: Database.Database, runId: number): void {
  const steps = getStepRunsForRun(db, runId);
  for (const step of steps) {
    if (step.status === "pending") {
      updateStepRun(db, step.id, { status: "skipped" });
    }
  }
}

/**
 * Transitively mark as `skipped` every pending step whose dependency chain
 * passes through `failedStepId`, unless the step sets `continueOnFailure`.
 *
 * Called after a step ends with a non-success outcome (either exception,
 * sitrep outcome=failure, or sitrep outcome=partial). This prevents
 * dependent steps from running with missing/invalid upstream output.
 *
 * Exported for unit testing — the `_` prefix marks it as internal.
 */
export function propagateSkipDownstream(
  db: Database.Database,
  runId: number,
  stepDefs: FlowStepDef[],
  failedStepId: string,
): void {
  for (const def of stepDefs) {
    const deps = def.dependsOn ?? [];
    if (!deps.includes(failedStepId)) continue;
    if (def.continueOnFailure) continue;
    const sr = getStepRun(db, runId, def.id);
    if (!sr || sr.status !== "pending") continue;
    updateStepRun(db, sr.id, {
      status: "skipped",
      error: `Skipped: dependency "${failedStepId}" did not finish with outcome=success`,
    });
    // Recurse — steps that depend on this newly-skipped step must also be
    // skipped, unless they opt into continueOnFailure themselves.
    propagateSkipDownstream(db, runId, stepDefs, def.id);
  }
}
