export type SidebarSection =
  | "general"
  | "agents"
  | "runtime"
  | "channels"
  | "mcp"
  | "permissions"
  | "config";

export interface InstanceInfo {
  id: number;
  slug: string;
  display_name: string | null;
  port: number;
  state: "running" | "stopped" | "error" | "unknown";
  config_path: string;
  state_dir: string;
  systemd_unit: string;
  telegram_bot: string | null;
  default_model: string | null;
  discovered: number;
  instance_type: "claw-runtime";
  created_at: string;
  updated_at: string;
  // health (from WS updates or /api/instances)
  gateway?: "healthy" | "unhealthy" | "unknown";
  agentCount?: number;
  pendingPermissions?: number;
  telegram?: "connected" | "disconnected" | "not_configured";
  /** Transient lifecycle transition — set by server during start/stop, cleared on completion. */
  transitioning?: "starting" | "stopping";
  // gateway token for zero-friction Control UI login
  gatewayToken?: string | null;
}

export interface HealthUpdate {
  type: "health_update";
  payload: {
    instances: Array<{
      slug: string;
      port: number;
      /** Pre-computed state from backend — use directly, do not re-derive */
      state: "running" | "stopped" | "error" | "unknown";
      gateway: "healthy" | "unhealthy" | "unknown";
      pid?: number;
      uptime?: string;
      agentCount?: number;
      telegram?: "connected" | "disconnected" | "not_configured";
      /** Number of persisted permission rules awaiting a decision */
      pendingPermissions?: number;
      /** Number of MCP servers currently connected */
      mcpConnected?: number;
      /** Number of agents with heartbeat enabled */
      heartbeatAgents?: number;
      /** Number of heartbeat alerts in the last 24h */
      heartbeatAlerts?: number;
      /** Transient lifecycle transition — set by server during start/stop, cleared on completion. */
      transitioning?: "starting" | "stopping";
    }>;
  };
}

export interface WsMessage {
  type: string;
  payload: unknown;
}

export interface AgentDefinition {
  id: string;
  name: string;
  model?: string;
  isDefault?: boolean;
}

export interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isDefault?: boolean;
  defaultModel: string;
  models: string[];
}

export interface ProvidersResponse {
  canReuseCredentials: boolean;
  sourceInstance: string | null;
  providers: ProviderInfo[];
}

export interface CreateInstanceRequest {
  slug: string;
  displayName: string;
  port: number;
  defaultModel: string;
  provider: string;
  apiKey: string;
  agents: AgentDefinition[];
  blueprintId?: number;
}

// Agents Builder types

export interface AgentFileSummary {
  filename: string;
  content_hash: string | null;
  size: number;
  updated_at: string | null;
}

export interface AgentBuilderInfo {
  id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: boolean;
  /** Agent category: "user" (custom), "tool" (built-in utility), "system" (internal infrastructure) */
  category: "user" | "tool" | "system";
  role: string | null;
  tags: string | null;
  notes: string | null;
  skills: string[] | null; // null = toutes les skills (champ absent en DB)
  synced_at: string | null;
  position_x: number | null;
  position_y: number | null;
  files: AgentFileSummary[];
}

export interface AgentMetaPatch {
  role?: string | null;
  tags?: string | null;
  notes?: string | null;
  skills?: string[] | null; // null = supprimer le filtre (= toutes les skills)
}

// Skills types

export interface AgentLink {
  source_agent_id: string;
  target_agent_id: string;
  link_type: "a2a" | "spawn";
}

export interface AgentFileContent {
  filename: string;
  content: string;
  content_hash: string;
  updated_at: string;
  editable: boolean;
}

export interface BuilderData {
  instance: {
    slug: string;
    display_name: string | null;
    port: number;
    state: string;
    default_model: string | null;
  };
  agents: AgentBuilderInfo[];
  links: AgentLink[];
}

export interface CreateAgentRequest {
  agentSlug: string;
  name: string;
  role: string;
  provider: string;
  model: string;
}

export interface SyncResult {
  synced: true;
  agents: AgentBuilderInfo[];
  links: AgentLink[];
  changes: {
    agentsAdded: string[];
    agentsRemoved: string[];
    agentsUpdated: string[];
    filesChanged: number;
    linksChanged: number;
  };
}

// Agent detail panel context — identifies whether the panel is used inside an
// instance builder or a blueprint builder, and carries the relevant identifier.
export type PanelContext =
  | { kind: "instance"; slug: string }
  | { kind: "blueprint"; blueprintId: number };

// Blueprint types

export interface Blueprint {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  tags?: string | null; // JSON array string, ex: '["rh","legal"]'
  color?: string | null;
  agent_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface BlueprintBuilderData {
  blueprint: Blueprint;
  agents: AgentBuilderInfo[];
  links: AgentLink[];
}

export interface CreateBlueprintRequest {
  name: string;
  description?: string;
  icon?: string;
  tags?: string;
  color?: string;
}

// Instance Settings types

/** A single provider entry as returned by the config API */
export interface ProviderEntry {
  id: string;
  label: string;
  envVar: string;
  apiKeyMasked: string | null;
  apiKeySet: boolean;
  requiresKey: boolean;
  baseUrl: string | null;
  source: "models" | "auth";
}

/** Structured config returned by GET /api/instances/:slug/config */
export interface InstanceConfig {
  general: {
    displayName: string;
    defaultModel: string;
    port: number;
  };
  providers: ProviderEntry[];
  agentDefaults: {
    compaction: { mode: string; threshold: number; reservedTokens: number };
    subagents: { maxSpawnDepth: number; maxChildrenPerSession: number; retentionHours: number };
    heartbeat: { every?: string; model?: string };
    defaultInternalModel: string;
    models: Array<{ id: string; provider: string; model: string }>;
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    toolProfile: string;
    maxSteps: number;
    temperature: number | null;
    thinking: { enabled: boolean; budgetTokens: number } | null;
    timeoutMs: number;
    chunkTimeoutMs: number;
    promptMode: string;
    allowSubAgents: boolean;
    instructionUrls: string[];
    expertIn: string[];
    heartbeat: {
      every?: string;
      model?: string;
      ackMaxChars?: number;
      prompt?: string;
      activeHours?: { start: string; end: string; tz?: string };
    } | null;
  }>;
  channels: {
    telegram: {
      enabled: boolean;
      botTokenMasked: string | null;
      dmPolicy: "pairing" | "open" | "allowlist" | "disabled";
      groupPolicy: "open" | "allowlist" | "disabled";
      streamMode?: string;
    } | null;
  };
  plugins: {
    mem0: {
      enabled: boolean;
      ollamaUrl: string;
      qdrantHost: string;
      qdrantPort: number;
    } | null;
  };
  gateway: {
    port: number;
  };
}

/** Result of PATCH /api/instances/:slug/config */
export interface ConfigPatchResult {
  ok: boolean;
  requiresRestart: boolean;
  hotReloaded: boolean;
  warnings: string[];
  restartReason?: string;
}

// Telegram DM pairing types

export interface TelegramPairingRequest {
  /** Telegram numeric user ID (string) */
  id: string;
  /** 8-char uppercase pairing code */
  code: string;
  /** ISO timestamp — request created */
  createdAt: string;
  /** ISO timestamp — last contact from this user */
  lastSeenAt: string;
  /** Channel-specific metadata */
  meta: { accountId?: string; username?: string };
}

export interface TelegramPairingList {
  pending: TelegramPairingRequest[];
  /** Array of approved Telegram user IDs */
  approved: string[];
}

// Discover instances types

export interface DiscoveredInstanceInfo {
  slug: string;
  stateDir: string;
  port: number;
  agentCount: number;
  gatewayHealthy: boolean;
  telegramBot: string | null;
  defaultModel: string | null;
  source: string;
}

export interface DiscoverResult {
  found: DiscoveredInstanceInfo[];
}

export interface AdoptResult {
  adopted: string[];
  errors: string[];
}

/** Etat de la mise a jour de claw-pilot lui-meme — GET /api/self/update-status */
export interface SelfUpdateStatus {
  // Versions
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  // Job en cours (polling)
  status: "idle" | "running" | "done" | "error";
  jobId?: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  fromVersion?: string;
  toVersion?: string;
}

// Runtime chat types

export interface RuntimeSession {
  id: string;
  instanceSlug: string;
  agentId: string;
  agentName?: string;
  agentIsDefault?: boolean;
  channel: string;
  state: "active" | "archived";
  title: string | null;
  createdAt: string;
  updatedAt: string;
  persistent: boolean;
  // Champs agrégés (enrichis par le backend depuis rt_messages)
  totalCostUsd?: number;
  messageCount?: number;
  totalTokens?: number;
}

export interface RuntimeChatResponse {
  sessionId: string;
  messageId: string;
  text: string;
  tokens: { input: number; output: number };
  costUsd: number | null;
  steps: number;
}

// --- Runtime Pilot types ---

export type PilotPartType =
  | "text"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "subtask"
  | "compaction";

export type PilotPartState = "pending" | "running" | "completed" | "error";

export interface PilotPart {
  id: string;
  messageId: string;
  type: PilotPartType;
  state?: PilotPartState;
  content?: string;
  /** JSON — parsed client-side per part type */
  metadata?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Message enrichi avec ses parts — retourné par GET /sessions/:id/messages */
export interface PilotMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  agentId?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  finishReason?: string;
  isCompaction: boolean;
  createdAt: string;
  parts: PilotPart[];
}

/** Contexte LLM de la session — retourné par GET /sessions/:id/context */
export interface SessionContext {
  agent: {
    id: string;
    name: string;
    model: string;
    toolProfile: string;
    temperature?: number;
    maxSteps?: number;
    thinking?: { enabled: boolean; budgetTokens?: number };
  };
  model: {
    providerId: string;
    modelId: string;
    contextWindow: number;
    maxOutputTokens: number;
    capabilities: {
      streaming: boolean;
      toolCalling: boolean;
      vision: boolean;
      reasoning: boolean;
    };
  };
  tokenUsage: {
    estimated: number;
    contextWindow: number;
    compactionThreshold: number;
  };
  compaction: {
    lastCompactedAt: string | null;
    messagesSinceCompaction: number;
    periodicMessageCount: number | null;
  };
  tools: Array<{
    name: string;
    source: "builtin" | "mcp";
    serverId?: string;
  }>;
  mcpServers: Array<{
    id: string;
    type: string;
    status: string;
    toolCount: number;
    lastError?: string;
  }>;
  systemPromptFiles: string[];
  /** Built system prompt — populated from in-memory cache after first LLM call. Null before first call. */
  systemPrompt: string | null;
  /** ISO 8601 timestamp of when the system prompt was last built. */
  systemPromptBuiltAt: string | null;
  teammates: Array<{
    id: string;
    name: string;
    kind: string;
  }>;
  sessionTree: Array<{
    sessionId: string;
    parentId: string | null;
    agentId: string;
    spawnDepth: number;
    state: "active" | "archived";
    label?: string;
  }>;
}

/** Événement bus générique pour le journal d'événements */
export interface PilotBusEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Agent Blueprints (standalone reusable agent templates)
// ---------------------------------------------------------------------------

export interface AgentBlueprintInfo {
  id: string;
  name: string;
  description: string | null;
  category: "user" | "tool" | "system";
  config_json: string;
  icon: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  file_count?: number;
  files?: AgentBlueprintFileSummary[];
}

export interface AgentBlueprintFileSummary {
  filename: string;
  content_hash: string | null;
  size: number;
  updated_at: string | null;
}

export interface AgentBlueprintFileContent {
  filename: string;
  content: string;
  content_hash: string | null;
  updated_at: string | null;
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

export type ProfileSection = "general" | "providers" | "instructions";

export interface UserProfile {
  userId: number;
  displayName: string | null;
  language: string;
  timezone: string | null;
  communicationStyle: "concise" | "detailed" | "technical";
  customInstructions: string | null;
  defaultModel: string | null;
  avatarUrl: string | null;
  uiPreferences: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProvider {
  providerId: string;
  apiKeyEnvVar: string;
  baseUrl: string | null;
  priority: number;
  headers: Record<string, string> | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  providerId: string;
}

// ---------------------------------------------------------------------------
// Cost Dashboard
// ---------------------------------------------------------------------------

export interface CostSummary {
  messageCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  period: string;
}

export interface DailyCost {
  day: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AgentCost {
  agentId: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  messageCount: number;
}

export interface ModelCost {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  messageCount: number;
}
