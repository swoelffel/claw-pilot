/**
 * runtime/tool/_task-handlers.ts
 *
 * Internal helpers extracted from task.ts to reduce cognitive complexity.
 * Handles A2A peer delegation, subagent execution, and async dispatch.
 */

import type Database from "better-sqlite3";
import type { Agent } from "../agent/agent.js";
import { getAgent, listAgents } from "../agent/registry.js";
import {
  createSession,
  getSession,
  getOrCreatePermanentSession,
  archiveSession,
  countActiveChildren,
} from "../session/session.js";
import { getBus } from "../bus/index.js";
import { SubagentCompleted } from "../bus/events.js";
import { createUserMessage } from "../session/message.js";
import type { InstanceSlug, SessionId } from "../types.js";
import { resolveModel, type ResolvedModel } from "../provider/provider.js";
import type {
  SubagentsConfig,
  RuntimeConfig,
  RuntimeAgentConfig,
  ModelAlias,
} from "../config/index.js";
import { logger } from "../../lib/logger.js";
import type { Tool } from "./tool.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal subset of PromptLoopInput used by the task tool */
export interface TaskPromptLoopInput {
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
export interface TaskPromptLoopResult {
  text: string;
  steps: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** Shared context for task execution handlers */
export interface TaskExecContext {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  resolvedModel: ResolvedModel;
  workDir: string | undefined;
  subagentsConfig: SubagentsConfig | undefined;
  compactionConfig: RuntimeConfig["compaction"] | undefined;
  callerAgentConfig: RuntimeAgentConfig | undefined;
  runtimeAgentConfigs: RuntimeAgentConfig[] | undefined;
  modelAliases: ModelAlias[] | undefined;
  resolveTargetModel: ((agentConfig: RuntimeAgentConfig) => ResolvedModel) | undefined;
  env: Record<string, string> | undefined;
  runPromptLoop: (input: TaskPromptLoopInput) => Promise<TaskPromptLoopResult>;
}

// ---------------------------------------------------------------------------
// A2A peer delegation
// ---------------------------------------------------------------------------

/**
 * Resolve the target primary agent for A2A peer delegation.
 * Resolution order: exact match by agent ID, then archetype match.
 * Returns undefined if no primary peer matches.
 */
/**
 * Resolve a model reference (string) to a ResolvedModel via alias or "provider/model" format.
 * Falls back to the caller's resolvedModel if resolution fails.
 */
export function resolveAgentModel(
  modelRef: string,
  aliases: ModelAlias[],
  fallback: ResolvedModel,
  env?: Record<string, string>,
): ResolvedModel {
  try {
    if (aliases.length > 0) {
      const alias = aliases.find((a) => a.id === modelRef);
      if (alias) {
        return resolveModel(alias.provider, alias.model, env !== undefined ? { env } : {});
      }
    }
    const slashIdx = modelRef.indexOf("/");
    if (slashIdx === -1) return fallback;
    const providerId = modelRef.slice(0, slashIdx);
    const modelId = modelRef.slice(slashIdx + 1);
    return resolveModel(providerId, modelId, env !== undefined ? { env } : {});
  } catch (err) {
    logger.debug("[tool:task] model resolution failed, using fallback", { error: String(err) });
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Contract verdict parsing and grading
// ---------------------------------------------------------------------------

export interface CriterionVerdict {
  id: string;
  status: "PASS" | "FAIL";
  explanation: string;
}

/** Build the contract block injected into the subagent's extraSystemPrompt. */
export function buildContractPrompt(
  criteria: string[],
  grading: "all_pass" | { threshold: number },
): string {
  const gradingDesc =
    grading === "all_pass"
      ? "ALL criteria must pass"
      : `at least ${grading.threshold} criteria must pass`;
  return [
    "## Task Contract",
    `You must satisfy the following acceptance criteria (${gradingDesc}):`,
    ...criteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "After completing your work, evaluate each criterion and report your verdict:",
    "<contract_verdict>",
    ...criteria.map(
      (_, i) => `  <criterion id="${i + 1}" status="PASS|FAIL">explanation</criterion>`,
    ),
    "</contract_verdict>",
  ].join("\n");
}

/** Parse the <contract_verdict> XML block from the agent's response text. */
export function parseContractVerdict(text: string, criteriaCount: number): CriterionVerdict[] {
  const blockMatch = text.match(/<contract_verdict>([\s\S]*?)<\/contract_verdict>/);
  if (!blockMatch) {
    return Array.from({ length: criteriaCount }, (_, i) => ({
      id: String(i + 1),
      status: "FAIL" as const,
      explanation: "No contract_verdict block found in response",
    }));
  }

  const block = blockMatch[1]!;
  const criterionRegex = /<criterion\s+id="(\d+)"\s+status="(PASS|FAIL)">([\s\S]*?)<\/criterion>/g;
  const verdicts: CriterionVerdict[] = [];
  let match;
  while ((match = criterionRegex.exec(block)) !== null) {
    verdicts.push({
      id: match[1]!,
      status: match[2]! as "PASS" | "FAIL",
      explanation: match[3]!.trim(),
    });
  }

  for (let i = 1; i <= criteriaCount; i++) {
    if (!verdicts.some((v) => v.id === String(i))) {
      verdicts.push({
        id: String(i),
        status: "FAIL",
        explanation: "Criterion not reported in verdict",
      });
    }
  }

  return verdicts.sort((a, b) => Number(a.id) - Number(b.id));
}

/** Check whether a verdict satisfies the grading rule. */
export function isContractSatisfied(
  verdicts: CriterionVerdict[],
  grading: "all_pass" | { threshold: number },
): boolean {
  const passCount = verdicts.filter((v) => v.status === "PASS").length;
  if (grading === "all_pass") return passCount === verdicts.length;
  return passCount >= grading.threshold;
}

/** Build a retry feedback prompt from failed verdicts. */
export function buildRetryFeedback(
  verdicts: CriterionVerdict[],
  criteria: string[],
  iteration: number,
  maxIterations: number,
): string {
  const failed = verdicts.filter((v) => v.status === "FAIL");
  const passed = verdicts.filter((v) => v.status === "PASS");
  return [
    "## Contract Retry Feedback",
    `Previous attempt failed contract criteria. Iteration ${iteration}/${maxIterations}.`,
    "",
    "FAILED criteria (fix these):",
    ...failed.map(
      (v) => `- Criterion ${v.id}: "${criteria[Number(v.id) - 1]}" — FAIL: ${v.explanation}`,
    ),
    "",
    ...(passed.length > 0
      ? [
          "PASSED criteria (do not regress):",
          ...passed.map((v) => `- Criterion ${v.id}: "${criteria[Number(v.id) - 1]}" — PASS`),
          "",
        ]
      : []),
    "Fix the failing criteria and try again. Maintain all passing criteria.",
  ].join("\n");
}

/** Format the contract report appended to the task result output. */
export function formatContractReport(
  verdicts: CriterionVerdict[],
  criteria: string[],
  iterationsUsed: number,
  maxIterations: number,
  satisfied: boolean,
): string {
  return [
    "<contract_report>",
    ...verdicts.map(
      (v) =>
        `  <criterion id="${v.id}" status="${v.status}">${criteria[Number(v.id) - 1]}: ${v.explanation}</criterion>`,
    ),
    `  iterations_used: ${iterationsUsed}/${maxIterations}`,
    `  final_verdict: ${satisfied ? "PASS" : "FAIL"}`,
    "</contract_report>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Target agent resolution
// ---------------------------------------------------------------------------

export function resolveTargetAgent(
  subagentType: string,
  callerAgentConfig: RuntimeAgentConfig | undefined,
  runtimeAgentConfigs: RuntimeAgentConfig[],
): RuntimeAgentConfig | undefined {
  return (
    runtimeAgentConfigs.find(
      (cfg) => cfg.id !== callerAgentConfig?.id && cfg.id === subagentType,
    ) ??
    runtimeAgentConfigs.find(
      (cfg) =>
        cfg.id !== callerAgentConfig?.id &&
        cfg.persistence !== "permanent" &&
        cfg.archetype != null &&
        cfg.archetype === subagentType,
    )
  );
}

/**
 * Resolve the model for a target primary agent.
 * Uses the injected resolver first, then alias resolution, then fallback.
 */
export function resolveTargetPeerModel(
  primaryPeerConfig: RuntimeAgentConfig,
  tctx: TaskExecContext,
): ResolvedModel {
  if (tctx.resolveTargetModel) {
    try {
      return tctx.resolveTargetModel(primaryPeerConfig);
    } catch (err) {
      logger.warn("[tool:task] target model resolution failed", { error: String(err) });
      return tctx.resolvedModel;
    }
  }
  return primaryPeerConfig.model
    ? resolveAgentModel(
        primaryPeerConfig.model,
        tctx.modelAliases ?? [],
        tctx.resolvedModel,
        tctx.env,
      )
    : tctx.resolvedModel;
}

/**
 * Handle A2A peer delegation (both sync and async modes).
 */
export async function handleA2ADelegation(
  params: { description: string; prompt: string; mode: "sync" | "async" },
  ctx: Tool.Context,
  primaryPeerConfig: RuntimeAgentConfig,
  tctx: TaskExecContext,
): Promise<Tool.Result> {
  // Guard: permanent agents cannot be spawned
  if (primaryPeerConfig.persistence === "permanent") {
    throw new Error(
      `Cannot delegate task to agent '${primaryPeerConfig.id}': it is a permanent agent. ` +
        `Use send_message to communicate with permanent agents.`,
    );
  }

  const { db, instanceSlug, resolvedModel, workDir, compactionConfig, runtimeAgentConfigs } = tctx;

  const targetSession = getOrCreatePermanentSession(db, {
    instanceSlug,
    agentId: primaryPeerConfig.id,
    channel: "internal",
  });

  ctx.metadata({ title: params.description });

  const targetAgentConfig: RuntimeAgentConfig = { ...primaryPeerConfig };

  const callerSession = getSession(db, ctx.sessionId);
  const extraSystemPrompt = [
    "## Incoming delegation",
    `Agent '${ctx.agentId}' is delegating the following task to you:`,
    `> ${params.description}`,
    ...(callerSession?.channel ? [`Source channel: ${callerSession.channel}`] : []),
    "This is an agent-to-agent delegation, not a direct user message.",
    "Respond with your result — it will be forwarded back to the delegating agent.",
  ].join("\n");

  const targetModel = resolveTargetPeerModel(primaryPeerConfig, tctx);
  const modelLabel =
    primaryPeerConfig.model ?? `${resolvedModel.providerId}/${resolvedModel.modelId}`;

  const loopInput = {
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
  };

  if (params.mode === "async") {
    return handleAsyncDelegation(
      params,
      ctx,
      primaryPeerConfig,
      targetSession,
      loopInput,
      modelLabel,
      tctx,
    );
  }

  return handleSyncDelegation(
    params,
    ctx,
    primaryPeerConfig,
    targetSession,
    loopInput,
    modelLabel,
    tctx,
  );
}

// ---------------------------------------------------------------------------
// Async/sync A2A delegation helpers
// ---------------------------------------------------------------------------

function handleAsyncDelegation(
  params: { description: string },
  ctx: Tool.Context,
  primaryPeerConfig: RuntimeAgentConfig,
  targetSession: { id: string },
  loopInput: TaskPromptLoopInput,
  modelLabel: string,
  tctx: TaskExecContext,
): Tool.Result {
  const bus = getBus(tctx.instanceSlug);
  const delegationStartedAt = new Date().toISOString();

  tctx
    .runPromptLoop(loopInput)
    .then((asyncResult) => {
      injectTaskTrace(tctx.db, {
        callerSessionId: ctx.sessionId,
        callerAgentId: ctx.agentId,
        targetAgentId: primaryPeerConfig.id,
        targetSessionId: targetSession.id,
        taskDescription: params.description,
        resultText: asyncResult.text,
        isPrimaryPeer: true,
        startedAt: delegationStartedAt,
      });
      bus.publish(SubagentCompleted, {
        parentSessionId: ctx.sessionId,
        subSessionId: targetSession.id,
        result: {
          text: asyncResult.text,
          steps: asyncResult.steps,
          tokens: { input: asyncResult.tokens.input, output: asyncResult.tokens.output },
          model: modelLabel,
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
          model: modelLabel,
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

async function handleSyncDelegation(
  params: { description: string },
  ctx: Tool.Context,
  primaryPeerConfig: RuntimeAgentConfig,
  targetSession: { id: string },
  loopInput: TaskPromptLoopInput,
  modelLabel: string,
  tctx: TaskExecContext,
): Promise<Tool.Result> {
  const syncDelegationStartedAt = new Date().toISOString();
  const result = await tctx.runPromptLoop(loopInput);

  injectTaskTrace(tctx.db, {
    callerSessionId: ctx.sessionId,
    callerAgentId: ctx.agentId,
    targetAgentId: primaryPeerConfig.id,
    targetSessionId: targetSession.id,
    taskDescription: params.description,
    resultText: result.text,
    isPrimaryPeer: true,
    startedAt: syncDelegationStartedAt,
  });

  const tokensTotal = result.tokens.input + result.tokens.output;
  const output = [
    `task_id: ${targetSession.id}`,
    `agent: ${primaryPeerConfig.id} (${primaryPeerConfig.name})`,
    `steps_used: ${result.steps}`,
    `tokens_used: ${tokensTotal}`,
    `model: ${modelLabel}`,
    "",
    "<task_result>",
    result.text,
    "</task_result>",
  ].join("\n");

  return { title: params.description, output, truncated: false };
}

// ---------------------------------------------------------------------------
// Subagent execution
// ---------------------------------------------------------------------------

/**
 * Handle subagent execution (both sync and async modes, with contract support).
 */
export async function handleSubagentExecution(
  params: {
    description: string;
    prompt: string;
    subagent_type: string;
    task_id: string | undefined;
    lifecycle: "run" | "session";
    mode: "sync" | "async";
    contract:
      | {
          criteria: string[];
          grading: "all_pass" | { threshold: number };
          max_iterations: number;
        }
      | undefined;
  },
  ctx: Tool.Context,
  tctx: TaskExecContext,
): Promise<Tool.Result> {
  const agent = getAgent(params.subagent_type);
  if (!agent) {
    throw buildAgentNotFoundError(params.subagent_type, tctx);
  }

  // Find or create the sub-agent session
  const sessionId = resolveOrCreateSubSession(
    params.task_id,
    tctx.db,
    tctx.instanceSlug,
    ctx.sessionId,
    agent.name,
    params.description,
    tctx.subagentsConfig,
  );

  ctx.metadata({ title: params.description });

  const agentConfig = buildSubagentConfig(agent, tctx.resolvedModel);

  const parentSession = getSession(tctx.db, ctx.sessionId);
  const subagentDepth = (parentSession?.spawnDepth ?? 0) + 1;
  const extraSystemPrompt = [
    "## Subagent Context",
    `You are a subagent spawned by agent '${ctx.agentId}'.`,
    `Your task: ${params.description}`,
    `Spawn depth: ${subagentDepth}`,
    "Return your result clearly — it will be injected into the parent context.",
  ].join("\n");

  const subAgentWorkDir =
    tctx.callerAgentConfig?.inheritWorkspace !== false ? tctx.workDir : undefined;

  if (params.mode === "async") {
    return handleAsyncSubagent(
      params,
      ctx,
      sessionId,
      agentConfig,
      extraSystemPrompt,
      subAgentWorkDir,
      agent.name,
      tctx,
    );
  }

  return handleSyncSubagent(
    params,
    ctx,
    sessionId,
    agentConfig,
    extraSystemPrompt,
    subAgentWorkDir,
    agent.name,
    tctx,
  );
}

// ---------------------------------------------------------------------------
// Subagent async/sync helpers
// ---------------------------------------------------------------------------

function handleAsyncSubagent(
  params: { description: string; prompt: string; lifecycle: "run" | "session" },
  ctx: Tool.Context,
  sessionId: string,
  agentConfig: RuntimeAgentConfig,
  extraSystemPrompt: string,
  subAgentWorkDir: string | undefined,
  agentName: string,
  tctx: TaskExecContext,
): Tool.Result {
  const bus = getBus(tctx.instanceSlug);
  const delegationStartedAt = new Date().toISOString();

  tctx
    .runPromptLoop({
      db: tctx.db,
      instanceSlug: tctx.instanceSlug,
      sessionId,
      userText: params.prompt,
      agentConfig,
      resolvedModel: tctx.resolvedModel,
      workDir: subAgentWorkDir,
      abort: ctx.abort,
      extraSystemPrompt,
      ...(tctx.compactionConfig !== undefined ? { compactionConfig: tctx.compactionConfig } : {}),
    })
    .then((asyncResult) => {
      if (params.lifecycle !== "session") {
        archiveSession(tctx.db, sessionId);
      }
      injectTaskTrace(tctx.db, {
        callerSessionId: ctx.sessionId,
        callerAgentId: ctx.agentId,
        targetAgentId: agentName,
        taskDescription: params.description,
        resultText: asyncResult.text,
        isPrimaryPeer: false,
        startedAt: delegationStartedAt,
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

async function handleSyncSubagent(
  params: {
    description: string;
    prompt: string;
    lifecycle: "run" | "session";
    contract:
      | {
          criteria: string[];
          grading: "all_pass" | { threshold: number };
          max_iterations: number;
        }
      | undefined;
  },
  ctx: Tool.Context,
  sessionId: string,
  agentConfig: RuntimeAgentConfig,
  extraSystemPrompt: string,
  subAgentWorkDir: string | undefined,
  agentName: string,
  tctx: TaskExecContext,
): Promise<Tool.Result> {
  const contract = params.contract;
  const contractPromptBlock = contract
    ? "\n\n" + buildContractPrompt(contract.criteria, contract.grading)
    : "";

  const subagentStartedAt = new Date().toISOString();
  let currentPrompt = params.prompt;
  let result: TaskPromptLoopResult | undefined;
  let contractVerdicts:
    | Array<{ id: string; status: "PASS" | "FAIL"; explanation: string }>
    | undefined;
  let contractSatisfied = false;
  let iterationsUsed = 1;
  const maxIterations = contract?.max_iterations ?? 1;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterationsUsed = iteration;
    result = await tctx.runPromptLoop({
      db: tctx.db,
      instanceSlug: tctx.instanceSlug,
      sessionId,
      userText: currentPrompt + contractPromptBlock,
      agentConfig,
      resolvedModel: tctx.resolvedModel,
      workDir: subAgentWorkDir,
      abort: ctx.abort,
      extraSystemPrompt,
      ...(tctx.compactionConfig !== undefined ? { compactionConfig: tctx.compactionConfig } : {}),
    });

    if (!contract) break;

    contractVerdicts = parseContractVerdict(result.text, contract.criteria.length);
    contractSatisfied = isContractSatisfied(contractVerdicts, contract.grading);

    if (contractSatisfied || iteration === maxIterations) break;

    currentPrompt = buildRetryFeedback(
      contractVerdicts,
      contract.criteria,
      iteration + 1,
      maxIterations,
    );
  }

  if (params.lifecycle !== "session") {
    archiveSession(tctx.db, sessionId);
  }

  injectTaskTrace(tctx.db, {
    callerSessionId: ctx.sessionId,
    callerAgentId: ctx.agentId,
    targetAgentId: agentName,
    taskDescription: params.description,
    resultText: result!.text,
    isPrimaryPeer: false,
    startedAt: subagentStartedAt,
  });

  const stepsInfo = agentConfig.maxSteps
    ? `${result!.steps}/${agentConfig.maxSteps}`
    : `${result!.steps}`;
  const tokensTotal = result!.tokens.input + result!.tokens.output;

  const outputParts = [
    `task_id: ${sessionId}`,
    `steps_used: ${stepsInfo}`,
    `tokens_used: ${tokensTotal}`,
    `model: ${agentConfig.model}`,
    ...(contract
      ? [
          `contract_status: ${contractSatisfied ? "PASS" : "FAIL"} (${iterationsUsed}/${maxIterations} iterations)`,
        ]
      : []),
    "",
    "<task_result>",
    result!.text,
    "</task_result>",
  ];

  if (contract && contractVerdicts) {
    outputParts.push(
      "",
      formatContractReport(
        contractVerdicts,
        contract.criteria,
        iterationsUsed,
        maxIterations,
        contractSatisfied,
      ),
    );
  }

  return {
    title: params.description,
    output: outputParts.join("\n"),
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Max length for the result summary injected into permanent sessions. */
const TRACE_SUMMARY_MAX_LENGTH = 200;

/**
 * Inject a compact trace of a completed task into permanent sessions so that
 * delegations survive compaction and agents remember past exchanges.
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
    startedAt: string;
  },
): void {
  const summary =
    opts.resultText.length > TRACE_SUMMARY_MAX_LENGTH
      ? opts.resultText.slice(0, TRACE_SUMMARY_MAX_LENGTH) + "..."
      : opts.resultText;

  createUserMessage(db, {
    sessionId: opts.callerSessionId,
    text: `[delegation] Asked ${opts.targetAgentId}: "${opts.taskDescription}" → ${summary}`,
    createdAt: opts.startedAt,
    ...(opts.targetSessionId !== undefined
      ? {
          metadata: JSON.stringify({
            kind: "delegation_sent",
            subSessionId: opts.targetSessionId,
            targetAgentId: opts.targetAgentId,
          }),
        }
      : {}),
  });

  if (opts.isPrimaryPeer && opts.targetSessionId) {
    createUserMessage(db, {
      sessionId: opts.targetSessionId,
      text: `[delegation] ${opts.callerAgentId} asked: "${opts.taskDescription}" → I responded: ${summary}`,
      createdAt: opts.startedAt,
      metadata: JSON.stringify({
        kind: "delegation_received",
        subSessionId: opts.callerSessionId,
        callerAgentId: opts.callerAgentId,
      }),
    });
  }
}

/** Build the agent-not-found error with helpful available agent lists. */
function buildAgentNotFoundError(subagentType: string, tctx: TaskExecContext): Error {
  const availableSubagents = listAgents({ mode: "subagent", includeHidden: false })
    .map((a) => a.name)
    .join(", ");
  const availablePrimary = (tctx.runtimeAgentConfigs ?? [])
    .filter((cfg) => cfg.id !== tctx.callerAgentConfig?.id)
    .map((cfg) => cfg.id)
    .join(", ");
  const declaredArchetypes = [
    ...new Set(
      (tctx.runtimeAgentConfigs ?? [])
        .filter((cfg) => cfg.id !== tctx.callerAgentConfig?.id && cfg.archetype != null)
        .map((cfg) => cfg.archetype!),
    ),
  ].join(", ");
  return new Error(
    `Unknown agent type: "${subagentType}" is not a valid agent type.\n` +
      `Available subagents: ${availableSubagents}\n` +
      (availablePrimary ? `Available primary agents: ${availablePrimary}\n` : "") +
      (declaredArchetypes ? `Available archetypes for routing: ${declaredArchetypes}` : ""),
  );
}

/** Resolve an existing session or create a new sub-session. */
function resolveOrCreateSubSession(
  taskId: string | undefined,
  db: Database.Database,
  instanceSlug: InstanceSlug,
  parentId: string,
  agentName: string,
  description: string,
  subagentsConfig?: SubagentsConfig,
): string {
  if (taskId) {
    const existing = getSession(db, taskId);
    if (existing) return existing.id;
  }
  return createSubSession(db, instanceSlug, parentId, agentName, description, subagentsConfig);
}

/** Create a sub-agent session with depth/children limit enforcement. */
function createSubSession(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  parentId: string,
  agentName: string,
  description: string,
  subagentsConfig?: SubagentsConfig,
): string {
  if (subagentsConfig !== undefined) {
    const parentSession = getSession(db, parentId);
    const currentDepth = parentSession?.spawnDepth ?? 0;

    if (currentDepth >= subagentsConfig.maxSpawnDepth) {
      throw new Error(
        `Max spawn depth (${subagentsConfig.maxSpawnDepth}) reached. ` +
          `Current depth: ${currentDepth}. Cannot spawn further sub-agents.`,
      );
    }

    const activeChildren = countActiveChildren(db, parentId);
    if (activeChildren >= subagentsConfig.maxChildrenPerSession) {
      throw new Error(
        `Max children per session (${subagentsConfig.maxChildrenPerSession}) reached. ` +
          `Cannot spawn more sub-agents for this session.`,
      );
    }
  }

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

  void restrictedPermissions;
  return session.id;
}

/** Build the RuntimeAgentConfig for a subagent from its agent definition. */
function buildSubagentConfig(agent: Agent.Info, resolvedModel: ResolvedModel): RuntimeAgentConfig {
  return {
    id: agent.name,
    name: agent.name,
    model: agent.model ?? `${resolvedModel.providerId}/${resolvedModel.modelId}`,
    systemPrompt: agent.prompt,
    temperature: agent.temperature,
    maxSteps: agent.steps ?? 20,
    allowSubAgents: false,
    toolProfile: "executor" as const,
    isDefault: false,
    permissions: agent.permission,
    inheritWorkspace: true,
  };
}
