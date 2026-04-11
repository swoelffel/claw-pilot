// src/runtime/flow/step-executor.ts
//
// Executes a single flow step by running a prompt loop for the target agent.
// Follows the wakeup-agent pattern: config loading, session creation, prompt loop.

import { getRuntimeStateDir } from "../../lib/platform.js";
import { buildResolvedEnv } from "../../lib/env-reader.js";
import {
  runPromptLoop,
  createSession,
  initAgentRegistry,
  getAgent,
  type RuntimeAgentConfig,
} from "../index.js";
import { resolveAgentWorkspacePath } from "../../core/agent-workspace.js";
import { runMiddlewarePipeline } from "../middleware/pipeline.js";
import { registerMiddleware, clearMiddlewares } from "../middleware/registry.js";
import { guardrailMiddleware } from "../middleware/built-in/guardrail.js";
import { multimodalMiddleware } from "../middleware/built-in/multimodal.js";
import { toolErrorRecoveryMiddleware } from "../middleware/built-in/tool-error-recovery.js";
import { loadMergedConfigDbFirst } from "../../dashboard/routes/_config-helpers.js";
import { resolveModelForAgent } from "../channel/router.js";
import type { FlowEngineContext } from "./types.js";

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
  timeoutMs?: number;
  abort?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

/**
 * Execute a single flow step: create ephemeral session, run prompt loop, return result.
 * Follows the wakeup-agent pattern but with an ephemeral (mission) session.
 */
export async function executeStep(
  ctx: FlowEngineContext,
  input: StepExecutionInput,
): Promise<StepExecutionResult> {
  const { db, instanceSlug, registry } = ctx;
  const { agentId, briefingText, flowName, stepId } = input;

  // 1. Load merged config
  const stateDir = getRuntimeStateDir(instanceSlug);
  const config = loadMergedConfigDbFirst(registry, instanceSlug, stateDir);
  if (!config) throw new Error(`Cannot load config for instance ${instanceSlug}`);

  // 2. Init agent registry + middlewares
  initAgentRegistry(config.agents);
  clearMiddlewares();
  registerMiddleware(guardrailMiddleware);
  registerMiddleware(multimodalMiddleware);
  registerMiddleware(toolErrorRecoveryMiddleware);

  // 3. Resolve agent
  const agentInfo = getAgent(agentId);
  if (!agentInfo) throw new Error(`Agent "${agentId}" not found in instance ${instanceSlug}`);

  const agentCfg: RuntimeAgentConfig = config.agents.find((a) => a.id === agentId) ?? {
    id: agentInfo.name,
    name: agentInfo.name,
    model: agentInfo.model ?? config.defaultModel,
    permissions: agentInfo.permission ?? [],
    maxSteps: agentInfo.steps ?? 20,
    allowSubAgents: true,
    toolProfile: "executor",
    isDefault: false,
    inheritWorkspace: true,
  };

  // 4. Load env for API key resolution
  const mergedEnv = buildResolvedEnv(stateDir);
  for (const [key, value] of Object.entries(mergedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  // 5. Resolve model
  const resolvedModel = resolveModelForAgent(db, instanceSlug, agentCfg, config);

  // 6. Create ephemeral mission session
  const session = createSession(db, {
    instanceSlug,
    agentId,
    channel: "flow",
    label: `flow:${flowName}:step:${stepId}`,
  });

  // 7. Set up timeout
  const timeoutMs = input.timeoutMs ?? 300_000; // Default 5 minutes
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort(new Error(`Step "${stepId}" timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  // Combine with external abort signal
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

  const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);

  try {
    // 8. Run prompt loop via middleware pipeline
    const pipelineOutput = await runMiddlewarePipeline({
      ctx: {
        db,
        instanceSlug,
        sessionId: session.id,
        agentConfig: agentCfg,
        message: { text: briefingText, channelType: "web", peerId: "flow-engine" },
      },
      runLoop: () =>
        runPromptLoop({
          db,
          instanceSlug,
          sessionId: session.id,
          userText: briefingText,
          agentConfig: agentCfg,
          resolvedModel,
          workDir: stateDir,
          agentWorkDir,
          runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
          runtimeConfig: config,
          compactionConfig: config.compaction,
          subagentsConfig: config.subagents,
          abort: abortController.signal,
          extraSystemPrompt:
            "You are executing a flow mission step. Work autonomously — do not ask questions.",
          resolveTargetModel: (targetCfg) =>
            resolveModelForAgent(db, instanceSlug, targetCfg, config),
        }),
    });

    const loopResult = pipelineOutput.result;
    return {
      sessionId: session.id,
      text: loopResult?.text ?? "",
      tokens: {
        input: loopResult?.tokens.input ?? 0,
        output: loopResult?.tokens.output ?? 0,
      },
      costUsd: loopResult?.costUsd ?? 0,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
