/**
 * runtime/bus/events.ts
 *
 * All typed event definitions for claw-runtime.
 * Each event has a unique string type and a typed payload.
 */

import type {
  InstanceSlug,
  SessionId,
  MessageId,
  AgentId,
  RuntimeInstanceState,
} from "../types.js";

// ---------------------------------------------------------------------------
// Event definition helper
// ---------------------------------------------------------------------------

export interface EventDef<T extends string, P> {
  readonly type: T;
  /** Used only for type inference — never instantiated */
  readonly _payload: P;
}

export function defineEvent<T extends string, P>(type: T): EventDef<T, P> {
  return { type } as EventDef<T, P>;
}

// ---------------------------------------------------------------------------
// Runtime instance events
// ---------------------------------------------------------------------------

export const RuntimeStarted = defineEvent<"runtime.started", { slug: InstanceSlug }>(
  "runtime.started",
);

export const RuntimeStopped = defineEvent<
  "runtime.stopped",
  { slug: InstanceSlug; reason?: string }
>("runtime.stopped");

export const RuntimeStateChanged = defineEvent<
  "runtime.state_changed",
  { slug: InstanceSlug; state: RuntimeInstanceState; previous: RuntimeInstanceState }
>("runtime.state_changed");

export const RuntimeError = defineEvent<
  "runtime.error",
  { slug: InstanceSlug; error: string; stack?: string }
>("runtime.error");

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

export const SessionCreated = defineEvent<
  "session.created",
  { sessionId: SessionId; agentId: AgentId; channel: string }
>("session.created");

export const SessionUpdated = defineEvent<
  "session.updated",
  { sessionId: SessionId; title?: string }
>("session.updated");

export const SessionEnded = defineEvent<
  "session.ended",
  { sessionId: SessionId; reason: "completed" | "cancelled" | "error" }
>("session.ended");

export const SessionStatusChanged = defineEvent<
  "session.status",
  {
    sessionId: SessionId;
    status: "idle" | "busy" | "retry";
    // Populated when status transitions to "idle" (end of prompt loop)
    agentId?: AgentId;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  }
>("session.status");

// ---------------------------------------------------------------------------
// Message events
// ---------------------------------------------------------------------------

export const MessageCreated = defineEvent<
  "message.created",
  { sessionId: SessionId; messageId: MessageId; role: "user" | "assistant" }
>("message.created");

export const MessageUpdated = defineEvent<
  "message.updated",
  { sessionId: SessionId; messageId: MessageId }
>("message.updated");

export const MessagePartDelta = defineEvent<
  "message.part.delta",
  { sessionId: SessionId; messageId: MessageId; partId: string; delta: string }
>("message.part.delta");

// ---------------------------------------------------------------------------
// Permission events
// ---------------------------------------------------------------------------

export const PermissionAsked = defineEvent<
  "permission.asked",
  {
    id: string;
    sessionId: SessionId;
    permission: string;
    pattern: string;
    description?: string;
  }
>("permission.asked");

export const PermissionReplied = defineEvent<
  "permission.replied",
  {
    id: string;
    sessionId: SessionId;
    action: "allow" | "deny";
    persist: boolean;
    /** Optional feedback message shown to the agent when the action is "deny" */
    feedback?: string;
  }
>("permission.replied");

// ---------------------------------------------------------------------------
// Provider events
// ---------------------------------------------------------------------------

export const ProviderAuthFailed = defineEvent<
  "provider.auth_failed",
  { providerId: string; profileId: string; reason: string }
>("provider.auth_failed");

export const ProviderFailover = defineEvent<
  "provider.failover",
  { providerId: string; fromProfileId: string; toProfileId: string; reason: string }
>("provider.failover");

// ---------------------------------------------------------------------------
// Subagent events
// ---------------------------------------------------------------------------

export const SubagentCompleted = defineEvent<
  "subagent.completed",
  {
    parentSessionId: SessionId;
    subSessionId: SessionId;
    result: {
      text: string;
      steps: number;
      tokens: { input: number; output: number };
      model: string;
    };
  }
>("subagent.completed");

export const AgentMessageSent = defineEvent<
  "agent.message.sent",
  {
    fromAgentId: AgentId;
    toAgentId: AgentId;
    expectReply: boolean;
    instanceSlug: InstanceSlug;
  }
>("agent.message.sent");

export const AgentTimeout = defineEvent<
  "agent.timeout",
  { sessionId: SessionId; agentId: AgentId; timeoutMs: number }
>("agent.timeout");

export const HeartbeatTick = defineEvent<
  "heartbeat.tick",
  { agentId: AgentId; instanceSlug: InstanceSlug }
>("heartbeat.tick");

export const HeartbeatAlert = defineEvent<
  "heartbeat.alert",
  { agentId: AgentId; instanceSlug: InstanceSlug; text: string }
>("heartbeat.alert");

// ---------------------------------------------------------------------------
// Budget events
// ---------------------------------------------------------------------------

export const BudgetSoftAlert = defineEvent<
  "budget.soft_alert",
  {
    instanceSlug: InstanceSlug;
    budgetId: number;
    scope: string;
    scopeId: string | null;
    spentUsd: number;
    limitUsd: number;
    pct: number;
  }
>("budget.soft_alert");

export const BudgetHardStop = defineEvent<
  "budget.hard_stop",
  {
    instanceSlug: InstanceSlug;
    budgetId: number;
    scope: string;
    scopeId: string | null;
    spentUsd: number;
    limitUsd: number;
  }
>("budget.hard_stop");

// ---------------------------------------------------------------------------
// Task board events
// ---------------------------------------------------------------------------

export const TaskCreated = defineEvent<
  "task.created",
  { instanceSlug: InstanceSlug; taskId: number; title: string; createdBy: string }
>("task.created");

export const TaskStatusChanged = defineEvent<
  "task.status_changed",
  {
    instanceSlug: InstanceSlug;
    taskId: number;
    oldStatus: string;
    newStatus: string;
    agentId?: string;
  }
>("task.status_changed");

export const TaskAssigned = defineEvent<
  "task.assigned",
  {
    instanceSlug: InstanceSlug;
    taskId: number;
    assigneeId: string;
    sessionId?: string;
    assignedBy?: string;
  }
>("task.assigned");

// ---------------------------------------------------------------------------
// MCP events
// ---------------------------------------------------------------------------

export const McpServerReconnected = defineEvent<"mcp.server.reconnected", { serverId: string }>(
  "mcp.server.reconnected",
);

export const McpToolsChanged = defineEvent<
  "mcp.tools.changed",
  { serverId: string; toolCount: number }
>("mcp.tools.changed");

// ---------------------------------------------------------------------------
// Tool events
// ---------------------------------------------------------------------------

export const DoomLoopDetected = defineEvent<
  "tool.doom_loop",
  { sessionId: SessionId; toolName: string }
>("tool.doom_loop");

export const LLMChunkTimeout = defineEvent<
  "llm.chunk_timeout",
  { sessionId: SessionId; agentId: AgentId; elapsedMs: number }
>("llm.chunk_timeout");

export const GuardrailBlocked = defineEvent<
  "guardrail.blocked",
  { sessionId: string; provider: string; reason: string }
>("guardrail.blocked");

export const ToolErrorRecovered = defineEvent<
  "tool.error.recovered",
  { sessionId: string; toolName: string; errorType: string }
>("tool.error.recovered");

// ---------------------------------------------------------------------------
// Question events
// ---------------------------------------------------------------------------

export const QuestionAsked = defineEvent<
  "question.asked",
  {
    questionId: string;
    sessionId: SessionId;
    messageId: MessageId;
    agentId: AgentId;
    question: string;
    options?: string[];
  }
>("question.asked");

// ---------------------------------------------------------------------------
// Session system prompt event
// ---------------------------------------------------------------------------

export const SessionSystemPromptBuilt = defineEvent<
  "session.system_prompt",
  { sessionId: SessionId; agentId: AgentId; systemPrompt: string; builtAt: string }
>("session.system_prompt");

// ---------------------------------------------------------------------------
// Suggestion events
// ---------------------------------------------------------------------------

export const SuggestionsGenerated = defineEvent<
  "suggestions.generated",
  { sessionId: SessionId; messageId: MessageId; suggestions: string[] }
>("suggestions.generated");

// ---------------------------------------------------------------------------
// Flow orchestration events
// ---------------------------------------------------------------------------

export const FlowRunStarted = defineEvent<
  "flow.run.started",
  { instanceSlug: InstanceSlug; runId: number; flowId: number; flowName: string }
>("flow.run.started");

export const FlowStepCompleted = defineEvent<
  "flow.step.completed",
  { instanceSlug: InstanceSlug; runId: number; stepId: string; agentId: AgentId; outcome: string }
>("flow.step.completed");

export const FlowRunCompleted = defineEvent<
  "flow.run.completed",
  { instanceSlug: InstanceSlug; runId: number; flowId: number; status: string }
>("flow.run.completed");

// ---------------------------------------------------------------------------
// Workspace events
// ---------------------------------------------------------------------------

export const WorkspaceFileChanged = defineEvent<
  "workspace.file.changed",
  { instanceSlug: InstanceSlug; agentId: AgentId; filename: string; filePath: string }
>("workspace.file.changed");

// ---------------------------------------------------------------------------
// Channel events
// ---------------------------------------------------------------------------

export const ChannelMessageReceived = defineEvent<
  "channel.message.received",
  { channelType: string; peerId: string; text: string }
>("channel.message.received");

export const ChannelMessageSent = defineEvent<
  "channel.message.sent",
  { channelType: string; peerId: string; text: string; sessionId: string }
>("channel.message.sent");

// ---------------------------------------------------------------------------
// Union type of all events (for wildcard subscriptions)
// ---------------------------------------------------------------------------

export type AnyEventDef =
  | typeof RuntimeStarted
  | typeof RuntimeStopped
  | typeof RuntimeStateChanged
  | typeof RuntimeError
  | typeof SessionCreated
  | typeof SessionUpdated
  | typeof SessionEnded
  | typeof SessionStatusChanged
  | typeof SessionSystemPromptBuilt
  | typeof MessageCreated
  | typeof MessageUpdated
  | typeof MessagePartDelta
  | typeof PermissionAsked
  | typeof PermissionReplied
  | typeof ProviderAuthFailed
  | typeof ProviderFailover
  | typeof DoomLoopDetected
  | typeof ChannelMessageReceived
  | typeof ChannelMessageSent
  | typeof SubagentCompleted
  | typeof AgentMessageSent
  | typeof AgentTimeout
  | typeof HeartbeatTick
  | typeof HeartbeatAlert
  | typeof BudgetSoftAlert
  | typeof BudgetHardStop
  | typeof TaskCreated
  | typeof TaskStatusChanged
  | typeof TaskAssigned
  | typeof McpServerReconnected
  | typeof McpToolsChanged
  | typeof LLMChunkTimeout
  | typeof GuardrailBlocked
  | typeof ToolErrorRecovered
  | typeof QuestionAsked
  | typeof SuggestionsGenerated
  | typeof FlowRunStarted
  | typeof FlowStepCompleted
  | typeof FlowRunCompleted
  | typeof WorkspaceFileChanged;

export type AnyEvent = {
  [K in AnyEventDef["type"]]: {
    type: K;
    payload: Extract<AnyEventDef, { type: K }>["_payload"];
  };
}[AnyEventDef["type"]];
