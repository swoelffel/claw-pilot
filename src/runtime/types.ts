/**
 * runtime/types.ts
 *
 * Core shared types for claw-runtime.
 * All subsystems import from here to avoid circular dependencies.
 */

// ---------------------------------------------------------------------------
// Instance identity
// ---------------------------------------------------------------------------

/** Unique identifier for a runtime instance (= instance slug from registry) */
export type InstanceSlug = string;

/** Unique identifier for an agent within an instance */
export type AgentId = string;

/** Unique identifier for a session (ULID) */
export type SessionId = string;

/** Unique identifier for a message (ULID) */
export type MessageId = string;

/** Unique identifier for a message part (ULID) */
export type PartId = string;

// ---------------------------------------------------------------------------
// LLM Provider types
// ---------------------------------------------------------------------------

/** Supported LLM API formats */
export type ModelApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "google-generative-ai"
  | "ollama"
  | "openrouter";

/** Provider identifier */
export type ProviderId = string;

/** Model identifier (e.g. "claude-sonnet-4-5", "gpt-4o") */
export type ModelId = string;

/** @public Fully qualified model reference: "provider/model" */
export type ModelRef = `${ProviderId}/${ModelId}`;

/** Model capability flags */
export interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  reasoning: boolean;
  /** Max context window in tokens */
  contextWindow: number;
  /** Max output tokens */
  maxOutputTokens: number;
}

/** Cost per million tokens (USD) */
export interface ModelCost {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion?: number;
  cacheReadPerMillion?: number;
}

/** Full model descriptor */
export interface ModelInfo {
  id: ModelId;
  providerId: ProviderId;
  name: string;
  api: ModelApi;
  capabilities: ModelCapabilities;
  cost: ModelCost;
  /** Whether this model is deprecated */
  deprecated?: boolean;
}

// ---------------------------------------------------------------------------
// Auth / Provider config
// ---------------------------------------------------------------------------

/** Auth profile for a provider API key */
export interface AuthProfile {
  id: string;
  instanceSlug: InstanceSlug;
  providerId: ProviderId;
  /** Reference to the env var name holding the actual key (never the key itself) */
  apiKeyRef: string;
  priority: number;
  cooldownUntil: Date | undefined;
  failureCount: number;
  lastError: AuthFailureReason | undefined;
  createdAt: Date;
  updatedAt: Date;
}

/** Reason for auth profile failure / failover trigger */
export type AuthFailureReason =
  | "rate_limit"
  | "billing"
  | "auth_invalid"
  | "context_overflow"
  | "timeout"
  | "server_error"
  | "unknown";

// ---------------------------------------------------------------------------
// Permission types
// ---------------------------------------------------------------------------

/** Permission action */
export type PermissionAction = "allow" | "deny" | "ask";

/** A single permission rule */
export interface PermissionRule {
  /** The permission category (e.g. "read", "write", "bash", "task") */
  permission: string;
  /** Glob pattern for the target (file path, tool name, etc.) */
  pattern: string;
  action: PermissionAction;
}

/** An ordered ruleset — evaluated last-match-wins */
export type PermissionRuleset = PermissionRule[];

/** Result of a permission check */
export interface PermissionResult {
  action: PermissionAction;
  /** The rule that matched, if any */
  matchedRule?: PermissionRule;
}

// ---------------------------------------------------------------------------
// Channel types
// ---------------------------------------------------------------------------

/** Supported messaging channels */
export type ChannelType = "web" | "telegram" | "discord" | "slack";

/** Attachment type classification */
export type AttachmentType = "image" | "document" | "audio" | "video";

/** Structured attachment metadata for inbound messages */
export interface InboundAttachment {
  /** Unique attachment identifier */
  id: string;
  /** High-level attachment type */
  type: AttachmentType;
  /** MIME type (e.g. "image/jpeg", "application/pdf") */
  mimeType: string;
  /** Base64-encoded file content */
  data: string;
  /** Optional original filename */
  filename?: string;
  /** File size in bytes (before base64 encoding) */
  sizeBytes?: number;
}

/** Inbound message from a channel */
export interface InboundMessage {
  channelType: ChannelType;
  /** Channel-specific peer identifier (user ID, chat ID, etc.) */
  peerId: string;
  /** Channel-specific account identifier (bot ID, workspace ID, etc.) */
  accountId?: string;
  text: string;
  /** Optional structured attachments (images, documents, etc.) */
  attachments?: InboundAttachment[];
  /** Original raw message from the channel SDK */
  raw?: unknown;
}

/** Artifact produced by the create_artifact tool */
export interface OutboundArtifact {
  title: string;
  artifactType: string;
  content: string;
  language?: string;
}

/** Outbound message to a channel */
export interface OutboundMessage {
  channelType: ChannelType;
  peerId: string;
  accountId?: string;
  text: string;
  /** Whether to stream the response token by token */
  streaming?: boolean;
  /** Artifacts to deliver as files (e.g. Telegram documents) */
  artifacts?: OutboundArtifact[];
}

// ---------------------------------------------------------------------------
// Runtime instance state
// ---------------------------------------------------------------------------

/** Lifecycle state of a runtime instance */
export type RuntimeInstanceState = "starting" | "running" | "stopping" | "stopped" | "error";

/** @public Minimal runtime instance descriptor (used by the registry) */
export interface RuntimeInstanceInfo {
  slug: InstanceSlug;
  state: RuntimeInstanceState;
  startedAt?: Date;
  error?: string;
}
