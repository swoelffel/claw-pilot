export type SidebarSection = "general" | "agents" | "telegram" | "plugins" | "gateway" | "devices";

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
  created_at: string;
  updated_at: string;
  // health (from WS updates or /api/instances)
  gateway?: "healthy" | "unhealthy" | "unknown";
  systemd?: "active" | "inactive" | "failed" | "unknown";
  agentCount?: number;
  pendingDevices?: number;
  // gateway token for zero-friction Control UI login
  gatewayToken?: string | null;
}

export interface AgentInfo {
  id: number;
  instance_id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: number;
}

export interface HealthUpdate {
  type: "health_update";
  payload: {
    instances: Array<{
      slug: string;
      port: number;
      gateway: "healthy" | "unhealthy" | "unknown";
      systemd: "active" | "inactive" | "failed" | "unknown";
      pid?: number;
      uptime?: string;
      agentCount?: number;
      pendingDevices?: number;
      telegram?: "connected" | "disconnected" | "not_configured";
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

export interface ConversationEntry {
  /** Unix timestamp in ms */
  timestamp: number;
  /** Display name of the sender (agent name or channel id) */
  from: string;
  /** Display name of the receiver (agent label or session key) */
  to: string;
  /** Task or message text */
  message: string;
  /** "agent-agent" for subagent dispatches, "agent-human" for channel replies */
  type: "agent-agent" | "agent-human";
  /** Current status of the dispatch */
  status?: "running" | "done" | "failed";
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
  role: string | null;
  tags: string | null;
  notes: string | null;
  synced_at: string | null;
  position_x: number | null;
  position_y: number | null;
  files: AgentFileSummary[];
}

export interface AgentMetaPatch {
  role?: string | null;
  tags?: string | null;
  notes?: string | null;
}

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
  tags?: string | null;  // JSON array string, ex: '["rh","legal"]'
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
    toolsProfile: string;
  };
  providers: ProviderEntry[];
  agentDefaults: {
    workspace: string;
    subagents: { maxConcurrent: number; archiveAfterMinutes: number };
    compaction: { mode: string; reserveTokensFloor?: number };
    contextPruning: { mode: string; ttl?: string };
    heartbeat: { every?: string; model?: string; target?: string };
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    workspace: string;
    identity: { name?: string; emoji?: string; avatar?: string } | null;
  }>;
  channels: {
    telegram: {
      enabled: boolean;
      botTokenMasked: string | null;
      dmPolicy: string;
      groupPolicy: string;
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
    bind: string;
    authMode: string;
    reloadMode: string;
    reloadDebounceMs: number;
  };
}

/** Result of PATCH /api/instances/:slug/config */
export interface ConfigPatchResult {
  ok: boolean;
  requiresRestart: boolean;
  hotReloaded: boolean;
  warnings: string[];
  restartReason?: string;
  pairingWarning?: boolean;
}

// Device pairing types

export interface PendingDevice {
  requestId: string;
  deviceId: string;
  publicKey: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  ts: number;
}

export interface PairedDevice {
  deviceId: string;
  publicKey: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  tokens: Record<string, { token: string; createdAtMs: number; lastUsedAtMs?: number }>;
  createdAtMs: number;
  approvedAtMs: number;
}

export interface DeviceList {
  pending: PendingDevice[];
  paired: PairedDevice[];
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
  systemdState: string | null;
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

/** Etat de la mise a jour OpenClaw — GET /api/openclaw/update-status */
export interface OpenClawUpdateStatus {
  // Versions
  currentVersion: string | null;
  latestVersion: string | null;
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
