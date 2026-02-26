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
  nginx_domain: string | null;
  default_model: string | null;
  discovered: number;
  created_at: string;
  updated_at: string;
  // health (from WS updates or /api/instances)
  gateway?: "healthy" | "unhealthy" | "unknown";
  systemd?: "active" | "inactive" | "failed" | "unknown";
  agentCount?: number;
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
