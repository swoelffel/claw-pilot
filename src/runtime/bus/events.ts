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
  { sessionId: SessionId; status: "idle" | "busy" | "retry" }
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
  | typeof MessageCreated
  | typeof MessageUpdated
  | typeof MessagePartDelta
  | typeof PermissionAsked
  | typeof PermissionReplied
  | typeof ProviderAuthFailed
  | typeof ProviderFailover
  | typeof ChannelMessageReceived
  | typeof ChannelMessageSent;

export type AnyEvent = {
  [K in AnyEventDef["type"]]: {
    type: K;
    payload: Extract<AnyEventDef, { type: K }>["_payload"];
  };
}[AnyEventDef["type"]];
