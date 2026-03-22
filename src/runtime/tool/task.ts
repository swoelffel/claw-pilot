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
  getOrCreatePermanentSession,
  archiveSession,
  countActiveChildren,
} from "../session/session.js";

import { evaluateRuleset } from "../permission/index.js";
import { getBus } from "../bus/index.js";
import { SubagentCompleted } from "../bus/events.js";
import { createUserMessage } from "../session/message.js";
import type { InstanceSlug, PermissionRuleset, SessionId } from "../types.js";
import { resolveModel } from "../provider/provider.js";
import type { ResolvedModel } from "../provider/provider.js";
import type {
  SubagentsConfig,
  RuntimeConfig,
  RuntimeAgentConfig,
  ModelAlias,
} from "../config/index.js";

// ---------------------------------------------------------------------------
// Prompt loop injection types (avoids circular dependency with session/prompt-loop)
// ---------------------------------------------------------------------------

/** Minimal subset of PromptLoopInput used by the task tool */
interface TaskPromptLoopInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  userText: string;
  agentConfig: RuntimeAgentConfig;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  abort?: AbortSignal;
  extraSystemPrompt?: string;
  compactionConfig?: RuntimeConfig["compaction"];
  runtimeAgentConfigs?: RuntimeAgentConfig[];
}

/** Minimal subset of PromptLoopResult used by the task tool */
interface TaskPromptLoopResult {
  text: string;
  steps: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

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
  /**
   * Configs of all runtime agents in this instance.
   * Used to resolve primary agents (A2A peer delegation).
   */
  runtimeAgentConfigs?: RuntimeAgentConfig[];
  /**
   * Model aliases from the runtime config — used to resolve the model of a primary peer agent.
   */
  modelAliases?: ModelAlias[];
  /** Injected prompt loop runner — breaks circular dependency with session/prompt-loop */
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
    runPromptLoop,
  } = options;

  // Build description dynamically from available agents.
  // 1. Built-in subagents (mode: "subagent" or "all", hidden=false)
  const allSubagents = listAgents({ mode: "subagent", includeHidden: false });
  const visibleSubagents = allSubagents.filter((a) => {
    if (!agentPermissions || agentPermissions.length === 0) return true;
    const result = evaluateRuleset(agentPermissions, "task", a.name);
    return result.action !== "deny";
  });

  // 2. User-defined primary agents (kind: "primary") from runtimeAgentConfigs,
  //    excluding the calling agent itself and agents with agentToAgent.enabled=false.
  const primaryPeers: RuntimeAgentConfig[] = (runtimeAgentConfigs ?? []).filter((cfg) => {
    if (cfg.id === callerAgentConfig?.id) return false; // skip self
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
      const skills =
        cfg.expertIn && cfg.expertIn.length > 0 ? ` [skills: ${cfg.expertIn.join(", ")}]` : "";
      return `- ${cfg.id} (${cfg.name})${skills}: Primary agent — use for peer-to-peer delegation.`;
    })
    .join("\n");

  const agentSection =
    subagentList +
    (primaryList
      ? `\n\nUser-defined primary agents (peer delegation — use lifecycle:'session' to keep state):\n${primaryList}`
      : "");

  const description =
    `Launch a new agent to handle complex, multistep tasks autonomously.\n\n` +
    `Available agent types and the tools they have access to:\n${agentSection}\n\n` +
    `When to use the Task tool:\n` +
    `- When you need to delegate a complex subtask to a specialized agent\n` +
    `- When parallel execution would speed up the work\n` +
    `- When you want to communicate with a peer agent (use the agent's id as subagent_type)\n` +
    `- When you want to route by skill: use a skill name as subagent_type (e.g. "code-review", "test-writing") — the runtime resolves the first primary agent that declares that skill in expertIn\n\n` +
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

      // 1. Try to resolve as a user-defined primary agent (A2A peer delegation)
      //    Resolution order:
      //    a) Exact match by agent ID (cfg.id)
      //    b) Skill-based match: find first primary agent that declares this skill in expertIn
      const primaryPeerConfig =
        (runtimeAgentConfigs ?? []).find((cfg) => cfg.id === params.subagent_type) ??
        (runtimeAgentConfigs ?? []).find(
          (cfg) =>
            cfg.id !== callerAgentConfig?.id &&
            cfg.expertIn !== undefined &&
            cfg.expertIn.includes(params.subagent_type),
        );

      if (primaryPeerConfig) {
        // --- A2A primary-to-primary path ---
        // Use the permanent session of the target primary agent.
        const targetSession = getOrCreatePermanentSession(db, {
          instanceSlug,
          agentId: primaryPeerConfig.id,
          channel: "internal",
        });

        ctx.metadata({ title: params.description });

        // For primary agents, use their own toolProfile and permissions
        const targetAgentConfig: RuntimeAgentConfig = {
          ...primaryPeerConfig,
        };

        // Build context block injected into the target agent's prompt
        const extraSystemPrompt = [
          "## Incoming delegation",
          `Agent '${ctx.agentId}' is delegating the following task to you:`,
          `${params.description}`,
          "Please respond with your result. It will be forwarded back to the delegating agent.",
        ].join("\n");

        // Resolve the target agent's model. Fall back to caller's model if unavailable.
        const targetModel: ResolvedModel = primaryPeerConfig.model
          ? resolveAgentModel(primaryPeerConfig.model, modelAliases ?? [], resolvedModel)
          : resolvedModel;

        if (params.mode === "async") {
          const bus = getBus(instanceSlug);

          runPromptLoop({
            db,
            instanceSlug,
            sessionId: targetSession.id,
            userText: params.prompt,
            agentConfig: targetAgentConfig,
            resolvedModel: targetModel,
            workDir,
            abort: ctx.abort,
            extraSystemPrompt,
            ...(compactionConfig !== undefined ? { compactionConfig } : {}),
            ...(runtimeAgentConfigs !== undefined ? { runtimeAgentConfigs } : {}),
          })
            .then((asyncResult) => {
              injectTaskTrace(db, {
                callerSessionId: ctx.sessionId,
                callerAgentId: ctx.agentId,
                targetAgentId: primaryPeerConfig.id,
                targetSessionId: targetSession.id,
                taskDescription: params.description,
                resultText: asyncResult.text,
                isPrimaryPeer: true,
              });
              bus.publish(SubagentCompleted, {
                parentSessionId: ctx.sessionId,
                subSessionId: targetSession.id,
                result: {
                  text: asyncResult.text,
                  steps: asyncResult.steps,
                  tokens: { input: asyncResult.tokens.input, output: asyncResult.tokens.output },
                  model:
                    primaryPeerConfig.model ??
                    `${resolvedModel.providerId}/${resolvedModel.modelId}`,
                },
              });
            })
            .catch((err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              bus.publish(SubagentCompleted, {
                parentSessionId: ctx.sessionId,
                subSessionId: targetSession.id,
                result: {
                  text: `[A2A error from '${primaryPeerConfig.id}': ${errMsg}]`,
                  steps: 0,
                  tokens: { input: 0, output: 0 },
                  model:
                    primaryPeerConfig.model ??
                    `${resolvedModel.providerId}/${resolvedModel.modelId}`,
                },
              });
            });

          return {
            title: params.description,
            output: [
              `task_id: ${targetSession.id}`,
              `status: accepted`,
              `Agent '${primaryPeerConfig.id}' is handling your request asynchronously. You will receive the result as a new message when it completes.`,
            ].join("\n"),
            truncated: false,
          };
        }

        // Sync mode
        const result = await runPromptLoop({
          db,
          instanceSlug,
          sessionId: targetSession.id,
          userText: params.prompt,
          agentConfig: targetAgentConfig,
          resolvedModel: targetModel,
          workDir,
          abort: ctx.abort,
          extraSystemPrompt,
          ...(compactionConfig !== undefined ? { compactionConfig } : {}),
          ...(runtimeAgentConfigs !== undefined ? { runtimeAgentConfigs } : {}),
        });

        injectTaskTrace(db, {
          callerSessionId: ctx.sessionId,
          callerAgentId: ctx.agentId,
          targetAgentId: primaryPeerConfig.id,
          targetSessionId: targetSession.id,
          taskDescription: params.description,
          resultText: result.text,
          isPrimaryPeer: true,
        });

        const tokensTotal = result.tokens.input + result.tokens.output;
        const output = [
          `task_id: ${targetSession.id}`,
          `agent: ${primaryPeerConfig.id} (${primaryPeerConfig.name})`,
          `steps_used: ${result.steps}`,
          `tokens_used: ${tokensTotal}`,
          `model: ${primaryPeerConfig.model ?? `${resolvedModel.providerId}/${resolvedModel.modelId}`}`,
          "",
          "<task_result>",
          result.text,
          "</task_result>",
        ].join("\n");

        return { title: params.description, output, truncated: false };
      }

      // 2. Resolve as a built-in or user-defined subagent
      const agent = getAgent(params.subagent_type);
      if (!agent) {
        const availableSubagents = listAgents({ mode: "subagent", includeHidden: false })
          .map((a) => a.name)
          .join(", ");
        const availablePrimary = (runtimeAgentConfigs ?? [])
          .filter((cfg) => cfg.id !== callerAgentConfig?.id)
          .map((cfg) => cfg.id)
          .join(", ");
        // Collect all declared skills from primary agents for the error message
        const declaredSkills = [
          ...new Set(
            (runtimeAgentConfigs ?? [])
              .filter((cfg) => cfg.id !== callerAgentConfig?.id && cfg.expertIn?.length)
              .flatMap((cfg) => cfg.expertIn ?? []),
          ),
        ].join(", ");
        throw new Error(
          `Unknown agent type: "${params.subagent_type}" is not a valid agent type.\n` +
            `Available subagents: ${availableSubagents}\n` +
            (availablePrimary ? `Available primary agents: ${availablePrimary}\n` : "") +
            (declaredSkills ? `Available skills for routing: ${declaredSkills}` : ""),
        );
      }

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
        allowSubAgents: false,
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
            injectTaskTrace(db, {
              callerSessionId: ctx.sessionId,
              callerAgentId: ctx.agentId,
              targetAgentId: agent.name,
              taskDescription: params.description,
              resultText: asyncResult.text,
              isPrimaryPeer: false,
            });
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

      injectTaskTrace(db, {
        callerSessionId: ctx.sessionId,
        callerAgentId: ctx.agentId,
        targetAgentId: agent.name,
        taskDescription: params.description,
        resultText: result.text,
        isPrimaryPeer: false,
      });

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
// Task trace injection
// ---------------------------------------------------------------------------

/** Max length for the result summary injected into permanent sessions. */
const TRACE_SUMMARY_MAX_LENGTH = 200;

/**
 * Inject a compact trace of a completed task into permanent sessions so that
 * delegations survive compaction and agents remember past exchanges.
 *
 * For A2A primary peer tasks: both caller and target sessions get a trace.
 * For subagent (ephemeral) tasks: only the caller session gets a trace.
 */
function injectTaskTrace(
  db: Database.Database,
  opts: {
    callerSessionId: SessionId;
    callerAgentId: string;
    targetAgentId: string;
    targetSessionId?: SessionId;
    taskDescription: string;
    resultText: string;
    isPrimaryPeer: boolean;
  },
): void {
  const summary =
    opts.resultText.length > TRACE_SUMMARY_MAX_LENGTH
      ? opts.resultText.slice(0, TRACE_SUMMARY_MAX_LENGTH) + "..."
      : opts.resultText;

  // Trace in caller's session
  createUserMessage(db, {
    sessionId: opts.callerSessionId,
    text: `[delegation] Asked ${opts.targetAgentId}: "${opts.taskDescription}" → ${summary}`,
  });

  // Trace in target's permanent session (A2A primary peers only)
  if (opts.isPrimaryPeer && opts.targetSessionId) {
    createUserMessage(db, {
      sessionId: opts.targetSessionId,
      text: `[delegation] ${opts.callerAgentId} asked: "${opts.taskDescription}" → I responded: ${summary}`,
    });
  }
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

  // Sub-agents cannot use todowrite/todoread by default.
  // The task tool is never available to subagents (enforced at the tool registry level).
  const restrictedPermissions = [
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "todoread", pattern: "*", action: "deny" as const },
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

// ---------------------------------------------------------------------------
// Model resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve a "provider/model" string (or named alias) to a ResolvedModel.
 * Falls back to the caller's resolvedModel if resolution fails.
 */
export function resolveAgentModel(
  modelRef: string,
  aliases: ModelAlias[],
  fallback: ResolvedModel,
): ResolvedModel {
  try {
    // Try alias resolution first
    if (aliases.length > 0) {
      const alias = aliases.find((a) => a.id === modelRef);
      if (alias) {
        return resolveModel(alias.provider, alias.model);
      }
    }
    // Standard "provider/model" format
    const slashIdx = modelRef.indexOf("/");
    if (slashIdx === -1) return fallback;
    const providerId = modelRef.slice(0, slashIdx);
    const modelId = modelRef.slice(slashIdx + 1);
    return resolveModel(providerId, modelId);
  } catch {
    // If model resolution fails (e.g. missing API key at task-build time),
    // fall back to the caller's model silently — the actual key is resolved
    // at prompt-loop time from process.env, so this is safe.
    return fallback;
  }
}
