// src/dashboard/routes/_helpers.ts
import type { AgentFileRecord } from "../../core/registry.js";
import { BUILTIN_AGENTS } from "../../runtime/agent/defaults.js";
import type { Agent } from "../../runtime/agent/agent.js";

// ---------------------------------------------------------------------------
// Built-in category lookup (computed once at import time)
// ---------------------------------------------------------------------------

const BUILTIN_CATEGORY_MAP = new Map<string, Agent.Info["category"]>(
  BUILTIN_AGENTS.map((a) => [a.name, a.category]),
);

/**
 * Resolve the category for an agent by its agent_id.
 * Built-in agents get their category from defaults.ts.
 * User-defined agents default to "user".
 */
export function resolveAgentCategory(agentId: string): Agent.Info["category"] {
  return BUILTIN_CATEGORY_MAP.get(agentId) ?? "user";
}

/**
 * Minimal agent shape required by buildAgentPayload.
 * Compatible with both AgentRecord and BlueprintAgentRecord.
 */
export interface AgentLike {
  id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: number;
  role: string | null;
  tags: string | null;
  notes: string | null;
  skills: string | null; // valeur brute DB — JSON string ou NULL
  synced_at: string | null;
  position_x: number | null;
  position_y: number | null;
}

export interface AgentPayloadItem {
  id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string | null;
  is_default: boolean;
  /** Agent category: "user" | "tool" | "system" */
  category: Agent.Info["category"];
  role: string | null;
  tags: string | null;
  notes: string | null;
  skills: string[] | null; // array parsé depuis JSON string DB, ou NULL
  synced_at: string | null;
  position_x: number | null;
  position_y: number | null;
  files: {
    filename: string;
    content_hash: string | null;
    size: number;
    updated_at: string | null;
  }[];
}

export function buildAgentPayload(agent: AgentLike, files: AgentFileRecord[]): AgentPayloadItem {
  // Parser skills depuis la JSON string stockée en DB
  let skills: string[] | null = null;
  if (agent.skills) {
    try {
      skills = JSON.parse(agent.skills) as string[];
    } catch {
      skills = null;
    }
  }

  return {
    id: agent.id,
    agent_id: agent.agent_id,
    name: agent.name,
    model: agent.model ?? null,
    workspace_path: agent.workspace_path ?? null,
    is_default: agent.is_default === 1,
    category: resolveAgentCategory(agent.agent_id),
    role: agent.role ?? null,
    tags: agent.tags ?? null,
    notes: agent.notes ?? null,
    skills,
    synced_at: agent.synced_at ?? null,
    position_x: agent.position_x ?? null,
    position_y: agent.position_y ?? null,
    files: files.map((f) => ({
      filename: f.filename,
      content_hash: f.content_hash ?? null,
      size: f.content ? f.content.length : 0,
      updated_at: f.updated_at ?? null,
    })),
  };
}
