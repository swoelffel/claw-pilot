import type { InstanceInfo, AgentInfo, CreateInstanceRequest, CreateAgentRequest, ProvidersResponse, ConversationEntry, SyncResult, BuilderData, AgentFileContent, AgentLink, Blueprint, BlueprintBuilderData, CreateBlueprintRequest } from "./types.js";
import { ApiError } from "./lib/api-error.js";

declare global {
  interface Window {
    __CP_TOKEN__?: string;
  }
}

function getToken(): string {
  return window.__CP_TOKEN__ ?? "";
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message = res.statusText;
    try {
      const body = await res.json() as { code?: string; error?: string };
      code = body.code ?? "INTERNAL_ERROR";
      message = body.error ?? res.statusText;
    } catch {
      // Body is not JSON — keep defaults
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

export async function fetchInstances(): Promise<InstanceInfo[]> {
  return apiFetch<InstanceInfo[]>("/instances");
}

export async function fetchInstance(
  slug: string,
): Promise<{ instance: InstanceInfo; status: unknown; gatewayToken: string | null }> {
  return apiFetch<{ instance: InstanceInfo; status: unknown; gatewayToken: string | null }>(
    `/instances/${slug}`,
  );
}

export async function fetchAgents(slug: string): Promise<AgentInfo[]> {
  return apiFetch<AgentInfo[]>(`/instances/${slug}/agents`);
}

export async function startInstance(slug: string): Promise<void> {
  await apiFetch(`/instances/${slug}/start`, { method: "POST" });
}

export async function stopInstance(slug: string): Promise<void> {
  await apiFetch(`/instances/${slug}/stop`, { method: "POST" });
}

export async function restartInstance(slug: string): Promise<void> {
  await apiFetch(`/instances/${slug}/restart`, { method: "POST" });
}

export async function fetchNextPort(): Promise<number> {
  const data = await apiFetch<{ port: number }>("/next-port");
  return data.port;
}

export async function fetchProviders(): Promise<ProvidersResponse> {
  return apiFetch<ProvidersResponse>("/providers");
}

export async function createInstance(data: CreateInstanceRequest): Promise<unknown> {
  return apiFetch("/instances", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteInstance(slug: string): Promise<void> {
  await apiFetch(`/instances/${slug}`, { method: "DELETE" });
}

export async function fetchConversations(
  slug: string,
  limit = 10,
): Promise<ConversationEntry[]> {
  const data = await apiFetch<{ entries: ConversationEntry[] }>(
    `/instances/${slug}/conversations?limit=${limit}`,
  );
  return data.entries;
}

export async function syncAgents(slug: string): Promise<SyncResult> {
  return apiFetch<SyncResult>(`/instances/${slug}/agents/sync`, { method: "POST" });
}

export async function fetchBuilderData(slug: string): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${slug}/agents/builder`);
}

export async function fetchAgentFile(slug: string, agentId: string, filename: string): Promise<AgentFileContent> {
  return apiFetch<AgentFileContent>(`/instances/${slug}/agents/${agentId}/files/${filename}`);
}

export async function updateAgentFile(
  instanceSlug: string,
  agentId: string,
  filename: string,
  content: string,
): Promise<AgentFileContent> {
  return apiFetch<AgentFileContent>(
    `/instances/${instanceSlug}/agents/${agentId}/files/${filename}`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
  );
}

export async function updateAgentPosition(
  slug: string,
  agentId: string,
  x: number,
  y: number,
): Promise<void> {
  await apiFetch(`/instances/${slug}/agents/${agentId}/position`, {
    method: "PATCH",
    body: JSON.stringify({ x, y }),
  });
}

export async function updateSpawnLinks(
  slug: string,
  agentId: string,
  targets: string[],
): Promise<{ ok: boolean; links: AgentLink[] }> {
  return apiFetch<{ ok: boolean; links: AgentLink[] }>(
    `/instances/${slug}/agents/${agentId}/spawn-links`,
    { method: "PATCH", body: JSON.stringify({ targets }) },
  );
}

export async function createAgent(
  slug: string,
  data: CreateAgentRequest,
): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${slug}/agents`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(
  instanceSlug: string,
  agentId: string,
): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${instanceSlug}/agents/${agentId}`, {
    method: "DELETE",
  });
}

// --- Blueprint API ---

export async function fetchBlueprints(): Promise<Blueprint[]> {
  return apiFetch<Blueprint[]>("/blueprints");
}

export async function createBlueprint(data: CreateBlueprintRequest): Promise<Blueprint> {
  return apiFetch<Blueprint>("/blueprints", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateBlueprint(
  id: number,
  data: Partial<CreateBlueprintRequest>,
): Promise<Blueprint> {
  return apiFetch<Blueprint>(`/blueprints/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteBlueprint(id: number): Promise<void> {
  await apiFetch(`/blueprints/${id}`, { method: "DELETE" });
}

export async function fetchBlueprintBuilder(id: number): Promise<BlueprintBuilderData> {
  return apiFetch<BlueprintBuilderData>(`/blueprints/${id}/builder`);
}

export async function createBlueprintAgent(
  blueprintId: number,
  data: { agent_id: string; name: string; model?: string },
): Promise<BlueprintBuilderData> {
  return apiFetch<BlueprintBuilderData>(`/blueprints/${blueprintId}/agents`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteBlueprintAgent(
  blueprintId: number,
  agentId: string,
): Promise<BlueprintBuilderData> {
  return apiFetch<BlueprintBuilderData>(`/blueprints/${blueprintId}/agents/${agentId}`, {
    method: "DELETE",
  });
}

export async function updateBlueprintAgentPosition(
  blueprintId: number,
  agentId: string,
  x: number,
  y: number,
): Promise<void> {
  await apiFetch(`/blueprints/${blueprintId}/agents/${agentId}/position`, {
    method: "PATCH",
    body: JSON.stringify({ x, y }),
  });
}

export async function fetchBlueprintAgentFile(
  blueprintId: number,
  agentId: string,
  filename: string,
): Promise<AgentFileContent> {
  return apiFetch<AgentFileContent>(`/blueprints/${blueprintId}/agents/${agentId}/files/${filename}`);
}

export async function updateBlueprintAgentFile(
  blueprintId: number,
  agentId: string,
  filename: string,
  content: string,
): Promise<AgentFileContent> {
  return apiFetch<AgentFileContent>(
    `/blueprints/${blueprintId}/agents/${agentId}/files/${filename}`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
  );
}

// --- Team export/import API ---

export interface TeamImportResult {
  ok: boolean;
  agents_imported?: number;
  links_imported?: number;
  files_written?: number;
  dry_run?: boolean;
  summary?: {
    agents_to_import: number;
    links_to_import: number;
    files_to_write: number;
    agents_to_remove: number;
    current_agent_count: number;
  };
}

export async function exportInstanceTeam(slug: string): Promise<Blob> {
  const res = await fetch(`/api/instances/${slug}/team/export`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError(res.status, "EXPORT_FAILED", "Export failed");
  return res.blob();
}

export async function importInstanceTeam(slug: string, yamlContent: string, dryRun = false): Promise<TeamImportResult> {
  const url = `/api/instances/${slug}/team/import${dryRun ? "?dry_run=true" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "text/yaml",
    },
    body: yamlContent,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
    throw new ApiError(res.status, body.code ?? "IMPORT_FAILED", body.error ?? "Import failed");
  }
  return res.json() as Promise<TeamImportResult>;
}

export async function exportBlueprintTeam(blueprintId: number): Promise<Blob> {
  const res = await fetch(`/api/blueprints/${blueprintId}/team/export`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError(res.status, "EXPORT_FAILED", "Export failed");
  return res.blob();
}

export async function importBlueprintTeam(blueprintId: number, yamlContent: string, dryRun = false): Promise<TeamImportResult> {
  const url = `/api/blueprints/${blueprintId}/team/import${dryRun ? "?dry_run=true" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "text/yaml",
    },
    body: yamlContent,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string };
    throw new ApiError(res.status, body.code ?? "IMPORT_FAILED", body.error ?? "Import failed");
  }
  return res.json() as Promise<TeamImportResult>;
}

export async function updateBlueprintSpawnLinks(
  blueprintId: number,
  agentId: string,
  targets: string[],
): Promise<{ ok: boolean; links: AgentLink[] }> {
  return apiFetch<{ ok: boolean; links: AgentLink[] }>(
    `/blueprints/${blueprintId}/agents/${agentId}/spawn-links`,
    { method: "PATCH", body: JSON.stringify({ targets }) },
  );
}
