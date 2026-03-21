// src/core/registry-types.ts
//
// Pure type definitions shared between registry.ts and the sub-repositories.
// No imports from registry.ts — this file is the single source of truth for
// all record types, breaking the circular dependency:
//   registry.ts → repositories/*.ts → registry.ts (was circular)
//   registry.ts → repositories/*.ts → registry-types.ts (acyclic)

export interface ServerRecord {
  id: number;
  hostname: string;
  ip: string | null;
  /** Home directory for instance state dirs. DB column is still `openclaw_home` (additive-only schema). */
  home_dir: string;
}

export interface InstanceRecord {
  id: number;
  server_id: number;
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
}

export interface AgentRecord {
  id: number;
  instance_id: number | null;
  blueprint_id: number | null;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: number;
  role: string | null;
  tags: string | null;
  notes: string | null;
  skills: string | null; // JSON array string ou NULL (NULL = accès à toutes les skills)
  position_x: number | null;
  position_y: number | null;
  config_hash: string | null;
  synced_at: string | null;
}

export interface AgentFileRecord {
  id: number;
  agent_id: number;
  filename: string;
  content: string | null;
  content_hash: string | null;
  updated_at: string | null;
}

export interface AgentLinkRecord {
  id: number;
  instance_id: number | null;
  blueprint_id: number | null;
  source_agent_id: string;
  target_agent_id: string;
  link_type: "a2a" | "spawn";
}

export interface BlueprintRecord {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  tags: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  agent_count?: number;
}

export interface BlueprintAgentRecord {
  id: number;
  blueprint_id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: number;
  role: string | null;
  tags: string | null;
  notes: string | null;
  skills: string | null; // JSON array string ou NULL (NULL = accès à toutes les skills)
  position_x: number | null;
  position_y: number | null;
  config_hash: string | null;
  synced_at: string | null;
}

export interface BlueprintLinkRecord {
  id: number;
  blueprint_id: number;
  source_agent_id: string;
  target_agent_id: string;
  link_type: "a2a" | "spawn";
}

// ---------------------------------------------------------------------------
// Agent Blueprints (standalone reusable agent templates)
// ---------------------------------------------------------------------------

export interface AgentBlueprintRecord {
  id: string;
  name: string;
  description: string | null;
  category: "user" | "tool" | "system";
  /** Serialized RuntimeAgentConfig (JSON string) */
  config_json: string;
  icon: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  /** Virtual column — computed via COUNT in list queries */
  file_count?: number;
}

export interface AgentBlueprintFileRecord {
  id: number;
  agent_blueprint_id: string;
  filename: string;
  content: string;
  content_hash: string | null;
  updated_at: string | null;
}

// ---------------------------------------------------------------------------
// User Profiles
// ---------------------------------------------------------------------------

export interface UserProfileRecord {
  id: number;
  user_id: number;
  display_name: string | null;
  language: string;
  timezone: string | null;
  communication_style: "concise" | "detailed" | "technical";
  custom_instructions: string | null;
  default_model: string | null;
  avatar_url: string | null;
  /** JSON blob stored as TEXT in SQLite */
  ui_preferences: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProviderRecord {
  id: number;
  user_id: number;
  provider_id: string;
  api_key_env_var: string;
  base_url: string | null;
  priority: number;
  /** JSON blob stored as TEXT in SQLite */
  headers: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserModelAliasRecord {
  id: number;
  user_id: number;
  alias_id: string;
  provider: string;
  model: string;
  context_window: number | null;
}
