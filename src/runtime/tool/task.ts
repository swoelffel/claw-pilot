/**
 * runtime/tool/task.ts
 *
 * Task tool — spawns a sub-agent session to handle a delegated task.
 *
 * Design:
 * - Creates a child session with restricted permissions (no task spawning by default)
 * - Runs the prompt loop for the sub-agent
 * - Returns the sub-agent's final text response
 * - Supports task_id for resuming a previous sub-agent session
 *
 * Depth tracking: sub-agents cannot spawn further sub-agents unless their
 * permission ruleset explicitly allows the "task" permission.
 */

import { z } from "zod";
import type Database from "better-sqlite3";
import { Tool } from "./tool.js";
import { listAgents } from "../agent/registry.js";
import { evaluateRuleset } from "../permission/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { InstanceSlug, PermissionRuleset } from "../types.js";
import type {
  SubagentsConfig,
  RuntimeConfig,
  RuntimeAgentConfig,
  ModelAlias,
} from "../config/index.js";

import {
  resolveTargetAgent,
  resolveAgentModel,
  handleA2ADelegation,
  handleSubagentExecution,
} from "./_task-handlers.js";
import type { TaskPromptLoopInput, TaskPromptLoopResult } from "./_task-handlers.js";

// Re-export for consumers
export { resolveAgentModel };
export type { TaskPromptLoopInput, TaskPromptLoopResult };

// ---------------------------------------------------------------------------
// Task tool factory
// ---------------------------------------------------------------------------

/**
 * Create the task tool with access to the runtime context.
 * Must be called at runtime startup with the DB and resolved model.
 */
export function createTaskTool(options: {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  subagentsConfig?: SubagentsConfig;
  agentPermissions?: PermissionRuleset;
  compactionConfig?: RuntimeConfig["compaction"];
  callerAgentConfig?: RuntimeAgentConfig;
  runtimeAgentConfigs?: RuntimeAgentConfig[];
  modelAliases?: ModelAlias[];
  resolveTargetModel?: (agentConfig: RuntimeAgentConfig) => ResolvedModel;
  env?: Record<string, string>;
  runPromptLoop: (input: TaskPromptLoopInput) => Promise<TaskPromptLoopResult>;
}): Tool.Info {
  const {
    db,
    instanceSlug,
    resolvedModel,
    workDir,
    subagentsConfig,
    agentPermissions,
    compactionConfig,
    callerAgentConfig,
    runtimeAgentConfigs,
    modelAliases,
    resolveTargetModel,
    env,
    runPromptLoop,
  } = options;

  const description = buildToolDescription(
    agentPermissions,
    callerAgentConfig,
    runtimeAgentConfigs,
  );

  const tctx = {
    db,
    instanceSlug,
    resolvedModel,
    workDir,
    subagentsConfig,
    compactionConfig,
    callerAgentConfig,
    runtimeAgentConfigs,
    modelAliases,
    resolveTargetModel,
    env,
    runPromptLoop,
  };

  return Tool.define("task", {
    description,
    parameters: taskParameters,
    async execute(params, ctx) {
      // 1. Permission gate: verify the calling agent is allowed to spawn this subagent type
      checkTaskPermission(agentPermissions, params.subagent_type);

      // 2. A2A policy check (declarative allowList)
      checkA2APolicyForTask(callerAgentConfig, runtimeAgentConfigs ?? [], params.subagent_type);

      // 3. Try to resolve as a user-defined primary agent (A2A peer delegation)
      const primaryPeerConfig = resolveTargetAgent(
        params.subagent_type,
        callerAgentConfig,
        runtimeAgentConfigs ?? [],
      );

      if (primaryPeerConfig) {
        return handleA2ADelegation(
          { description: params.description, prompt: params.prompt, mode: params.mode },
          ctx,
          primaryPeerConfig,
          tctx,
        );
      }

      // 4. Resolve as a built-in or user-defined subagent
      return handleSubagentExecution(
        {
          description: params.description,
          prompt: params.prompt,
          subagent_type: params.subagent_type,
          task_id: params.task_id,
          lifecycle: params.lifecycle,
          mode: params.mode,
          contract: params.contract,
        },
        ctx,
        tctx,
      );
    },
  });
}

// ---------------------------------------------------------------------------
// A2A policy check
// ---------------------------------------------------------------------------

/**
 * Check if the calling agent is allowed to spawn the target agent
 * based on the agentToAgent policy in the agent config.
 * The allowList accepts agent IDs and/or archetype names.
 */
export function checkA2APolicy(
  agentConfig: RuntimeAgentConfig,
  targetAgentId: string,
  targetArchetype?: string | null,
): { allowed: boolean; reason?: string } {
  const policy = agentConfig.agentToAgent;
  if (!policy) return { allowed: true };
  if (!policy.enabled) {
    return {
      allowed: false,
      reason: `Agent '${agentConfig.id}' has agentToAgent.enabled = false`,
    };
  }
  if (policy.allowList && !policy.allowList.includes("*")) {
    const allowed =
      policy.allowList.includes(targetAgentId) ||
      (targetArchetype != null && policy.allowList.includes(targetArchetype));
    if (!allowed) {
      return {
        allowed: false,
        reason:
          `Agent '${agentConfig.id}' is not allowed to spawn '${targetAgentId}'. ` +
          `Allowed: [${policy.allowList.join(", ")}]`,
      };
    }
  }
  return { allowed: true };
}

// Re-export contract functions (moved to _task-handlers.ts to avoid circular dep)
export {
  buildContractPrompt,
  parseContractVerdict,
  isContractSatisfied,
  buildRetryFeedback,
  formatContractReport,
} from "./_task-handlers.js";
export type { CriterionVerdict } from "./_task-handlers.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check the calling agent's permission to spawn a specific subagent type. */
function checkTaskPermission(
  agentPermissions: PermissionRuleset | undefined,
  subagentType: string,
): void {
  if (agentPermissions && agentPermissions.length > 0) {
    const permResult = evaluateRuleset(agentPermissions, "task", subagentType);
    if (permResult.action === "deny") {
      throw new Error(
        `Permission denied: agent is not allowed to spawn subagent '${subagentType}'`,
      );
    }
  }
}

/** Check A2A policy for the calling agent against the target. */
function checkA2APolicyForTask(
  callerAgentConfig: RuntimeAgentConfig | undefined,
  runtimeAgentConfigs: RuntimeAgentConfig[],
  subagentType: string,
): void {
  if (!callerAgentConfig) return;

  const resolvedArchetype = runtimeAgentConfigs.find(
    (cfg) =>
      cfg.id === subagentType ||
      (cfg.id !== callerAgentConfig.id && cfg.archetype != null && cfg.archetype === subagentType),
  )?.archetype;
  const a2aCheck = checkA2APolicy(callerAgentConfig, subagentType, resolvedArchetype);
  if (!a2aCheck.allowed) {
    throw new Error(a2aCheck.reason ?? `Agent-to-agent spawn denied`);
  }
}

/** Build the tool description dynamically from available agents. */
function buildToolDescription(
  agentPermissions: PermissionRuleset | undefined,
  callerAgentConfig: RuntimeAgentConfig | undefined,
  runtimeAgentConfigs: RuntimeAgentConfig[] | undefined,
): string {
  // 1. Built-in subagents (mode: "subagent" or "all", hidden=false)
  const allSubagents = listAgents({ mode: "subagent", includeHidden: false });
  const visibleSubagents = allSubagents.filter((a) => {
    if (!agentPermissions || agentPermissions.length === 0) return true;
    const result = evaluateRuleset(agentPermissions, "task", a.name);
    return result.action !== "deny";
  });

  // 2. User-defined primary agents
  const primaryPeers: RuntimeAgentConfig[] = (runtimeAgentConfigs ?? []).filter((cfg) => {
    if (cfg.id === callerAgentConfig?.id) return false;
    if (cfg.agentToAgent && cfg.agentToAgent.enabled === false) return false;
    return true;
  });

  const subagentList = visibleSubagents
    .map(
      (a) =>
        `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`,
    )
    .join("\n");

  const primaryList = primaryPeers
    .map((cfg) => {
      const arch = cfg.archetype ? ` [archetype: ${cfg.archetype}]` : "";
      return `- ${cfg.id} (${cfg.name})${arch}: Primary agent — use for peer-to-peer delegation.`;
    })
    .join("\n");

  const agentSection =
    subagentList +
    (primaryList
      ? `\n\nUser-defined primary agents (peer delegation — use lifecycle:'session' to keep state):\n${primaryList}`
      : "");

  return (
    `Launch a new agent to handle complex, multistep tasks autonomously.\n\n` +
    `Available agent types and the tools they have access to:\n${agentSection}\n\n` +
    `When to use the Task tool:\n` +
    `- When you need to delegate a complex subtask to a specialized agent\n` +
    `- When parallel execution would speed up the work\n` +
    `- When you want to communicate with a peer agent (use the agent's id as subagent_type)\n` +
    `- When you want to route by archetype: use an archetype name as subagent_type (e.g. "evaluator", "planner") — the runtime resolves the first primary agent with that archetype\n\n` +
    `When NOT to use the Task tool:\n` +
    `- For simple single-file operations — use the direct tools instead\n` +
    `- When you already have all the context needed to complete the task\n\n` +
    `Lifecycle modes:\n` +
    `- 'run' (default): session is archived after completion\n` +
    `- 'session': session stays active and can be resumed via task_id\n\n` +
    `Execution modes:\n` +
    `- 'sync' (default): blocks until the sub-agent completes\n` +
    `- 'async': returns immediately with task_id, result injected as a message when done`
  );
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const taskParameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .optional()
    .describe(
      "This should only be set if you mean to resume a previous task " +
        "(you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    ),
  lifecycle: z
    .enum(["run", "session"])
    .default("run")
    .describe(
      "Lifecycle of the sub-agent session after completion. " +
        "'run' (default): session is archived after completion. " +
        "'session': session stays active and can be resumed via task_id.",
    ),
  mode: z
    .enum(["sync", "async"])
    .default("sync")
    .describe(
      "Execution mode. 'sync' (default): blocks until the sub-agent completes. " +
        "'async': returns immediately with task_id, result injected as a message when done.",
    ),
  contract: z
    .object({
      criteria: z
        .array(z.string().min(1))
        .min(1)
        .describe("Testable acceptance criteria for the task"),
      grading: z
        .union([z.literal("all_pass"), z.object({ threshold: z.number().int().min(1) })])
        .default("all_pass")
        .describe(
          "Grading mode: 'all_pass' requires all criteria to pass, { threshold: N } requires at least N",
        ),
      max_iterations: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(3)
        .describe("Maximum retry attempts if criteria are not met"),
    })
    .optional()
    .describe("Optional contract with structured acceptance criteria for the task"),
});
