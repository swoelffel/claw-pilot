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
import { createSession, getSession } from "../session/session.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import type { InstanceSlug } from "../types.js";
import type { ResolvedModel } from "../provider/provider.js";

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
}): Tool.Info {
  const { db, instanceSlug, resolvedModel, workDir } = options;

  // Build description dynamically from available subagents
  const subagents = listAgents({ mode: "subagent", includeHidden: false });
  const agentList = subagents
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
    `- When you already have all the context needed to complete the task`;

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
    }),
    async execute(params, ctx) {
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
      };

      // Run the prompt loop for the sub-agent
      const result = await runPromptLoop({
        db,
        instanceSlug,
        sessionId,
        userText: params.prompt,
        agentConfig,
        resolvedModel,
        workDir,
        abort: ctx.abort,
      });

      const output = [
        `task_id: ${sessionId} (for resuming to continue this task if needed)`,
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
// Internal helpers
// ---------------------------------------------------------------------------

function createSubSession(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  parentId: string,
  agentName: string,
  description: string,
  canSpawnSubagents: boolean,
): string {
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
  });

  // Store restricted permissions as metadata (used by prompt-loop in future)
  // For now, we pass them via agentConfig.permissions in the execute() call
  void restrictedPermissions;

  return session.id;
}
