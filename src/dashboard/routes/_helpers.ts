// src/dashboard/routes/_helpers.ts
import type { AgentFileRecord } from "../../core/registry.js";

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
  role: string | null;
  tags: string | null;
  notes: string | null;
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
  return {
    id: agent.id,
    agent_id: agent.agent_id,
    name: agent.name,
    model: agent.model ?? null,
    workspace_path: agent.workspace_path ?? null,
    is_default: agent.is_default === 1,
    role: agent.role ?? null,
    tags: agent.tags ?? null,
    notes: agent.notes ?? null,
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
