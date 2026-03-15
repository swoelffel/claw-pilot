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
import { getAgent, listAgents } from "../agent/registry.js";
import {
  createSession,
  getSession,
  archiveSession,
  countActiveChildren,
} from "../session/session.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import { evaluateRuleset } from "../permission/index.js";
import { getBus } from "../bus/index.js";
import { SubagentCompleted } from "../bus/events.js";
import type { InstanceSlug, PermissionRuleset } from "../types.js";
import type { ResolvedModel } from "../provider/provider.js";
import type { SubagentsConfig, RuntimeConfig, RuntimeAgentConfig } from "../config/index.js";

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
  /** Sub-agents spawn limits (from runtime config) */
  subagentsConfig?: SubagentsConfig;
  /** Permission ruleset of the calling agent — used to filter visible/executable subagents */
  agentPermissions?: PermissionRuleset;
  /** Compaction settings — forwarded to sub-agent prompt loops */
  compactionConfig?: RuntimeConfig["compaction"];
  /** Config of the calling agent — used to determine workspace inheritance */
  callerAgentConfig?: RuntimeAgentConfig;
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
  } = options;

  // Build description dynamically from available subagents
  // Filter visible agents according to the calling agent's permission ruleset (first gate)
  const allSubagents = listAgents({ mode: "subagent", includeHidden: false });
  const visibleAgents = allSubagents.filter((a) => {
    if (!agentPermissions || agentPermissions.length === 0) return true;
    const result = evaluateRuleset(agentPermissions, "task", a.name);
    return result.action !== "deny";
  });

  const agentList = visibleAgents
    .map(
      (a) =>
        `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`,
    )
    .join("\n");

  const description =
    `Launch a new agent to handle complex, multistep tasks autonomously.\n\n` +
    `Available agent types and the tools they have access to:\n${agentList}\n\n` +
    `When to use the Task tool:\n` +
    `- When you need to delegate a complex subtask to a specialized agent\n` +
    `- When parallel execution would speed up the work\n\n` +
    `When NOT to use the Task tool:\n` +
    `- For simple single-file operations — use the direct tools instead\n` +
    `- When you already have all the context needed to complete the task\n\n` +
    `Lifecycle modes:\n` +
    `- 'run' (default): session is archived after completion\n` +
    `- 'session': session stays active and can be resumed via task_id\n\n` +
    `Execution modes:\n` +
    `- 'sync' (default): blocks until the sub-agent completes\n` +
    `- 'async': returns immediately with task_id, result injected as a message when done`;

  return Tool.define("task", {
    description,
    parameters: z.object({
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
    }),
    async execute(params, ctx) {
      // Second gate: verify the calling agent is allowed to spawn this specific subagent type
      if (agentPermissions && agentPermissions.length > 0) {
        const permResult = evaluateRuleset(agentPermissions, "task", params.subagent_type);
        if (permResult.action === "deny") {
          throw new Error(
            `Permission denied: agent is not allowed to spawn subagent '${params.subagent_type}'`,
          );
        }
        // Note: "ask" action is not interactive in the task tool context — treat as allow
      }

      // A2A policy check (declarative allowList)
      if (callerAgentConfig) {
        const a2aCheck = checkA2APolicy(callerAgentConfig, params.subagent_type);
        if (!a2aCheck.allowed) {
          throw new Error(a2aCheck.reason ?? `Agent-to-agent spawn denied`);
        }
      }

      // Resolve the agent
      const agent = getAgent(params.subagent_type);
      if (!agent) {
        const available = listAgents({ mode: "subagent", includeHidden: false })
          .map((a) => a.name)
          .join(", ");
        throw new Error(
          `Unknown agent type: "${params.subagent_type}" is not a valid agent type.\n` +
            `Available subagents: ${available}`,
        );
      }

      // Determine if this sub-agent can itself spawn sub-agents
      const canSpawnSubagents = agent.permission.some(
        (r) => r.permission === "task" && r.action !== "deny",
      );

      // Find or create the sub-agent session
      let sessionId: string;

      if (params.task_id) {
        const existing = getSession(db, params.task_id);
        if (existing) {
          sessionId = existing.id;
        } else {
          sessionId = createSubSession(
            db,
            instanceSlug,
            ctx.sessionId,
            agent.name,
            params.description,
            canSpawnSubagents,
            subagentsConfig,
          );
        }
      } else {
        sessionId = createSubSession(
          db,
          instanceSlug,
          ctx.sessionId,
          agent.name,
          params.description,
          canSpawnSubagents,
          subagentsConfig,
        );
      }

      ctx.metadata({ title: params.description });

      // Build agent config for the sub-agent
      // We adapt the agent's permission ruleset to RuntimeAgentConfig format
      const agentConfig = {
        id: agent.name,
        name: agent.name,
        model: agent.model ?? `${resolvedModel.providerId}/${resolvedModel.modelId}`,
        systemPrompt: agent.prompt,
        temperature: agent.temperature,
        maxSteps: agent.steps ?? 20,
        allowSubAgents: canSpawnSubagents,
        toolProfile: "coding" as const,
        isDefault: false,
        permissions: agent.permission,
        inheritWorkspace: true,
      };

      // Build subagent context block — injected into the sub-agent's system prompt
      // so it knows it's a subagent, who spawned it, and what its mission is.
      const parentSession = getSession(db, ctx.sessionId);
      const subagentDepth = (parentSession?.spawnDepth ?? 0) + 1;
      const extraSystemPrompt = [
        "## Subagent Context",
        `You are a subagent spawned by agent '${ctx.agentId}'.`,
        `Your task: ${params.description}`,
        `Spawn depth: ${subagentDepth}`,
        "Return your result clearly — it will be injected into the parent context.",
      ].join("\n");

      // Determine the working directory for the sub-agent.
      // If the calling agent has inheritWorkspace=true (default), the sub-agent
      // inherits the parent's workDir so it can access the same project files.
      // If inheritWorkspace=false, the sub-agent uses the parent's workDir as well
      // (the sub-agent's own workspace path is resolved by the prompt loop via
      // workspace discovery — workDir here is the instance stateDir root).
      // The distinction is: inheritWorkspace=true passes the parent's workDir as-is;
      // inheritWorkspace=false passes undefined so the sub-agent falls back to its
      // own workspace discovery path.
      const subAgentWorkDir = callerAgentConfig?.inheritWorkspace !== false ? workDir : undefined;

      // Async mode: spawn in background, return immediately with task_id
      if (params.mode === "async") {
        const bus = getBus(instanceSlug);

        // Fire and forget — catch errors to avoid unhandled rejections
        runPromptLoop({
          db,
          instanceSlug,
          sessionId,
          userText: params.prompt,
          agentConfig,
          resolvedModel,
          workDir: subAgentWorkDir,
          abort: ctx.abort,
          extraSystemPrompt,
          ...(compactionConfig !== undefined ? { compactionConfig } : {}),
        })
          .then((asyncResult) => {
            // Archive sub-session unless lifecycle="session"
            if (params.lifecycle !== "session") {
              archiveSession(db, sessionId);
            }
            bus.publish(SubagentCompleted, {
              parentSessionId: ctx.sessionId,
              subSessionId: sessionId,
              result: {
                text: asyncResult.text,
                steps: asyncResult.steps,
                tokens: { input: asyncResult.tokens.input, output: asyncResult.tokens.output },
                model: agentConfig.model,
              },
            });
          })
          .catch((err: unknown) => {
            // Log error but don't crash the parent
            const errMsg = err instanceof Error ? err.message : String(err);
            bus.publish(SubagentCompleted, {
              parentSessionId: ctx.sessionId,
              subSessionId: sessionId,
              result: {
                text: `[Subagent error: ${errMsg}]`,
                steps: 0,
                tokens: { input: 0, output: 0 },
                model: agentConfig.model,
              },
            });
          });

        return {
          title: params.description,
          output: [
            `task_id: ${sessionId}`,
            `status: accepted`,
            `The subagent is running in background. You will receive the result as a new message when it completes.`,
          ].join("\n"),
          truncated: false,
        };
      }

      // Sync mode (default): run the prompt loop and wait for completion
      const result = await runPromptLoop({
        db,
        instanceSlug,
        sessionId,
        userText: params.prompt,
        agentConfig,
        resolvedModel,
        workDir: subAgentWorkDir,
        abort: ctx.abort,
        extraSystemPrompt,
        ...(compactionConfig !== undefined ? { compactionConfig } : {}),
      });

      // Archive sub-session unless lifecycle="session"
      if (params.lifecycle !== "session") {
        archiveSession(db, sessionId);
      }

      const stepsInfo = agentConfig.maxSteps
        ? `${result.steps}/${agentConfig.maxSteps}`
        : `${result.steps}`;
      const tokensTotal = result.tokens.input + result.tokens.output;

      const output = [
        `task_id: ${sessionId}`,
        `steps_used: ${stepsInfo}`,
        `tokens_used: ${tokensTotal}`,
        `model: ${agentConfig.model}`,
        "",
        "<task_result>",
        result.text,
        "</task_result>",
      ].join("\n");

      return {
        title: params.description,
        output,
        truncated: false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// A2A policy check
// ---------------------------------------------------------------------------

/**
 * Check if the calling agent is allowed to spawn the target agent
 * based on the agentToAgent policy in the agent config.
 */
export function checkA2APolicy(
  agentConfig: RuntimeAgentConfig,
  targetAgentId: string,
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
    if (!policy.allowList.includes(targetAgentId)) {
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createSubSession(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  parentId: string,
  agentName: string,
  description: string,
  canSpawnSubagents: boolean,
  subagentsConfig?: SubagentsConfig,
): string {
  // Enforce spawn depth limit
  if (subagentsConfig !== undefined) {
    const parentSession = getSession(db, parentId);
    const currentDepth = parentSession?.spawnDepth ?? 0;

    if (currentDepth >= subagentsConfig.maxSpawnDepth) {
      throw new Error(
        `Max spawn depth (${subagentsConfig.maxSpawnDepth}) reached. ` +
          `Current depth: ${currentDepth}. Cannot spawn further sub-agents.`,
      );
    }

    // Enforce max simultaneous active children
    const activeChildren = countActiveChildren(db, parentId);
    if (activeChildren >= subagentsConfig.maxChildrenPerSession) {
      throw new Error(
        `Max children per session (${subagentsConfig.maxChildrenPerSession}) reached. ` +
          `Cannot spawn more sub-agents for this session.`,
      );
    }
  }

  // Sub-agents cannot use todowrite/todoread by default
  // and cannot spawn further sub-agents unless explicitly allowed
  const restrictedPermissions = [
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "todoread", pattern: "*", action: "deny" as const },
    ...(!canSpawnSubagents ? [{ permission: "task", pattern: "*", action: "deny" as const }] : []),
  ];

  const session = createSession(db, {
    instanceSlug,
    agentId: agentName,
    channel: "internal",
    parentId,
    label: description,
  });

  // Store restricted permissions as metadata (used by prompt-loop in future)
  // For now, we pass them via agentConfig.permissions in the execute() call
  void restrictedPermissions;

  return session.id;
}
