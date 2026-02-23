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
}
