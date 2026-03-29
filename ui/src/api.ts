import type {
  InstanceInfo,
  CreateInstanceRequest,
  CreateAgentRequest,
  ProvidersResponse,
  SyncResult,
  BuilderData,
  AgentFileContent,
  AgentLink,
  Blueprint,
  BlueprintBuilderData,
  CreateBlueprintRequest,
  InstanceConfig,
  ConfigPatchResult,
  TelegramPairingList,
  AgentMetaPatch,
  DiscoverResult,
  AdoptResult,
  RuntimeSession,
  RuntimeChatResponse,
  PilotMessage,
  SessionContext,
  AgentBlueprintInfo,
  AgentBlueprintFileContent,
  UserProfile,
  UserProvider,
  DiscoveredModel,
  CostSummary,
  DailyCost,
  AgentCost,
  SkillsListResponse,
  ModelCost,
  RtEventsPage,
  MemoryAgentSummary,
  MemoryFileInfo,
  MemoryFileContent,
  MemorySearchResponse,
  HeartbeatScheduleAgent,
  HeartbeatHourBucket,
  HeartbeatAgentStats,
} from "./types.js";
import { ApiError } from "./lib/api-error.js";
import { getToken } from "./services/auth-state.js";

/**
 * Returns a stable device ID for this browser, stored in localStorage.
 * Used as a stable peerId for permanent agent sessions so the same browser
 * always maps to the same session (even across page reloads or reconnections).
 */
function getDeviceId(): string {
  const KEY = "cp:deviceId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    // Generate a random 16-char hex ID
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(KEY, id);
  }
  return id;
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
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Global 401 handler — session expired, redirect to login
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/me") {
      window.dispatchEvent(new CustomEvent("cp:session-expired"));
    }
    let code = "INTERNAL_ERROR";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { code?: string; error?: string };
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

export async function syncAgents(slug: string): Promise<SyncResult> {
  return apiFetch<SyncResult>(`/instances/${slug}/agents/sync`, { method: "POST" });
}

export async function fetchBuilderData(slug: string): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${slug}/agents/builder`);
}

export async function fetchAgentFile(
  slug: string,
  agentId: string,
  filename: string,
): Promise<AgentFileContent> {
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

export async function updateAgentMeta(
  slug: string,
  agentId: string,
  patch: AgentMetaPatch,
): Promise<void> {
  await apiFetch(`/instances/${slug}/agents/${agentId}/meta`, {
    method: "PATCH",
    body: JSON.stringify(patch),
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

export async function createAgent(slug: string, data: CreateAgentRequest): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${slug}/agents`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(instanceSlug: string, agentId: string): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${instanceSlug}/agents/${agentId}`, {
    method: "DELETE",
  });
}

// --- Skills API ---

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

export async function updateBlueprintAgentMeta(
  blueprintId: number,
  agentId: string,
  patch: AgentMetaPatch,
): Promise<BlueprintBuilderData> {
  return apiFetch<BlueprintBuilderData>(`/blueprints/${blueprintId}/agents/${agentId}/meta`, {
    method: "PATCH",
    body: JSON.stringify(patch),
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
  return apiFetch<AgentFileContent>(
    `/blueprints/${blueprintId}/agents/${agentId}/files/${filename}`,
  );
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

export async function importInstanceTeam(
  slug: string,
  yamlContent: string,
  dryRun = false,
): Promise<TeamImportResult> {
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
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      code?: string;
      message?: string;
    };
    throw new ApiError(
      res.status,
      body.error ?? body.code ?? "IMPORT_FAILED",
      body.message ?? body.error ?? "Import failed",
    );
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

export async function importBlueprintTeam(
  blueprintId: number,
  yamlContent: string,
  dryRun = false,
): Promise<TeamImportResult> {
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
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      code?: string;
      message?: string;
    };
    throw new ApiError(
      res.status,
      body.error ?? body.code ?? "IMPORT_FAILED",
      body.message ?? body.error ?? "Import failed",
    );
  }
  return res.json() as Promise<TeamImportResult>;
}

// --- Instance Settings API ---

export async function fetchInstanceConfig(slug: string): Promise<InstanceConfig> {
  return apiFetch<InstanceConfig>(`/instances/${slug}/config`);
}

export async function fetchToolProfiles(slug: string): Promise<{
  tools: readonly string[];
  profiles: Record<string, string[]>;
}> {
  return apiFetch(`/instances/${slug}/runtime/tools`);
}

export async function patchInstanceConfig(
  slug: string,
  patch: Record<string, unknown>,
): Promise<ConfigPatchResult> {
  return apiFetch<ConfigPatchResult>(`/instances/${slug}/config`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
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

// --- Telegram DM pairing API ---

export async function fetchTelegramPairing(slug: string): Promise<TelegramPairingList> {
  return apiFetch<TelegramPairingList>(`/instances/${slug}/telegram/pairing`);
}

export async function approveTelegramPairing(slug: string, code: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/instances/${slug}/telegram/pairing/approve`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function patchTelegramToken(
  slug: string,
  token: string | null,
): Promise<{ configured: boolean }> {
  return apiFetch<{ configured: boolean }>(`/instances/${slug}/config/telegram/token`, {
    method: "PATCH",
    body: JSON.stringify({ token }),
  });
}

export async function rejectTelegramPairing(slug: string, code: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/instances/${slug}/telegram/pairing/${code}`, {
    method: "DELETE",
  });
}

export async function patchChannelsConfig(
  slug: string,
  channels: {
    telegram?: {
      enabled?: boolean;
      botTokenEnvVar?: string;
      pollingIntervalMs?: number;
      allowedUserIds?: number[];
      dmPolicy?: "pairing" | "open" | "allowlist" | "disabled";
      groupPolicy?: "open" | "allowlist" | "disabled";
    };
  },
): Promise<ConfigPatchResult> {
  return apiFetch<ConfigPatchResult>(`/instances/${slug}/config`, {
    method: "PATCH",
    body: JSON.stringify({ channels }),
  });
}

// --- Discover instances API ---

export async function discoverInstances(): Promise<DiscoverResult> {
  return apiFetch<DiscoverResult>("/instances/discover", { method: "POST" });
}

export async function adoptInstances(slugs: string[]): Promise<AdoptResult> {
  return apiFetch<AdoptResult>("/instances/discover/adopt", {
    method: "POST",
    body: JSON.stringify({ slugs }),
  });
}

// --- Runtime chat API ---

export async function fetchRuntimeSessions(
  slug: string,
  opts?: { includeInternal?: boolean },
): Promise<RuntimeSession[]> {
  const params = new URLSearchParams();
  if (opts?.includeInternal) params.set("includeInternal", "true");
  const qs = params.toString();
  const data = await apiFetch<{ sessions: RuntimeSession[] }>(
    `/instances/${slug}/runtime/sessions${qs ? `?${qs}` : ""}`,
  );
  return data.sessions;
}

export async function postRuntimeChat(
  slug: string,
  body: {
    message: string;
    sessionId?: string;
    agentId?: string;
    model?: string;
    files?: Array<{ name: string; mimeType: string; data: string }>;
  },
): Promise<RuntimeChatResponse> {
  return apiFetch<RuntimeChatResponse>(`/instances/${slug}/runtime/chat`, {
    method: "POST",
    body: JSON.stringify(body),
    // X-Device-Id: stable browser identity for permanent session routing.
    // Ensures the same browser always maps to the same permanent session,
    // even across page reloads, reconnections, or channel changes.
    headers: { "X-Device-Id": getDeviceId() },
  });
}

/** Abort an active prompt loop for a session. */
export async function abortSession(slug: string, sessionId: string): Promise<{ aborted: boolean }> {
  return apiFetch<{ aborted: boolean }>(`/instances/${slug}/runtime/sessions/${sessionId}/abort`, {
    method: "POST",
  });
}

export function getRuntimeChatStreamUrl(slug: string, sessionId?: string): string {
  const base = `/api/instances/${slug}/runtime/chat/stream`;
  return sessionId ? `${base}?sessionId=${encodeURIComponent(sessionId)}` : base;
}

/**
 * Fetch messages for a session with cursor pagination.
 * Returns messages in chronological order + hasMore flag.
 */
export async function fetchSessionMessages(
  slug: string,
  sessionId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<{ messages: PilotMessage[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.before) params.set("before", opts.before);
  const qs = params.toString();
  return apiFetch<{ messages: PilotMessage[]; hasMore: boolean }>(
    `/instances/${slug}/runtime/sessions/${sessionId}/messages${qs ? `?${qs}` : ""}`,
  );
}

/**
 * Fetch the LLM context view for a session (agent config, model, tools, MCP, session tree).
 */
export async function fetchSessionContext(
  slug: string,
  sessionId: string,
): Promise<SessionContext> {
  return apiFetch<SessionContext>(`/instances/${slug}/runtime/sessions/${sessionId}/context`);
}

/**
 * Submit an answer to a pending question from the question tool.
 */
export async function answerQuestion(
  slug: string,
  questionId: string,
  answer: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/instances/${slug}/runtime/questions/${questionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
}

// ---------------------------------------------------------------------------
// Agent Blueprints (standalone reusable agent templates)
// ---------------------------------------------------------------------------

export async function fetchAgentBlueprints(): Promise<AgentBlueprintInfo[]> {
  return apiFetch<AgentBlueprintInfo[]>("/agent-blueprints");
}

export async function fetchAgentBlueprint(id: string): Promise<AgentBlueprintInfo> {
  return apiFetch<AgentBlueprintInfo>(`/agent-blueprints/${id}`);
}

export async function createAgentBlueprint(data: {
  name: string;
  description?: string;
  category?: "user" | "tool" | "system";
  seedFiles?: boolean;
}): Promise<AgentBlueprintInfo> {
  return apiFetch<AgentBlueprintInfo>("/agent-blueprints", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAgentBlueprint(id: string): Promise<void> {
  await apiFetch(`/agent-blueprints/${id}`, { method: "DELETE" });
}

export async function cloneAgentBlueprint(id: string, name?: string): Promise<AgentBlueprintInfo> {
  return apiFetch<AgentBlueprintInfo>(`/agent-blueprints/${id}/clone`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function fetchAgentBlueprintFile(
  blueprintId: string,
  filename: string,
): Promise<AgentBlueprintFileContent> {
  return apiFetch<AgentBlueprintFileContent>(
    `/agent-blueprints/${blueprintId}/files/${encodeURIComponent(filename)}`,
  );
}

export async function updateAgentBlueprintFile(
  blueprintId: string,
  filename: string,
  content: string,
): Promise<AgentBlueprintFileContent> {
  return apiFetch<AgentBlueprintFileContent>(
    `/agent-blueprints/${blueprintId}/files/${encodeURIComponent(filename)}`,
    { method: "PUT", body: JSON.stringify({ content }) },
  );
}

export async function saveAgentAsBlueprint(data: {
  instanceSlug: string;
  agentId: string;
  name: string;
  description?: string;
}): Promise<AgentBlueprintInfo> {
  return apiFetch<AgentBlueprintInfo>("/agent-blueprints/from-agent", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createAgentFromTemplate(
  slug: string,
  data: {
    blueprintId: string;
    agentSlug: string;
    name?: string;
    provider: string;
    model: string;
  },
): Promise<BuilderData> {
  return apiFetch<BuilderData>(`/instances/${slug}/agents/from-template`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Export an agent blueprint as a YAML file — triggers browser download. */
export async function exportAgentBlueprint(id: string): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/agent-blueprints/${id}/export`, { headers });
  if (!res.ok) throw new ApiError(res.status, "EXPORT_FAILED", `Export failed: ${res.statusText}`);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? "template.yaml";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import an agent blueprint from YAML content. */
export async function importAgentBlueprint(yamlContent: string): Promise<AgentBlueprintInfo> {
  const token = getToken();
  const res = await fetch("/api/agent-blueprints/import", {
    method: "POST",
    headers: {
      "Content-Type": "text/yaml",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: yamlContent,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === "object" && "message" in body
        ? (body as { message: string }).message
        : res.statusText;
    throw new ApiError(res.status, "IMPORT_FAILED", msg);
  }
  return (await res.json()) as AgentBlueprintInfo;
}

// ---------------------------------------------------------------------------
// User Profile API
// ---------------------------------------------------------------------------

export async function fetchProfile(): Promise<{ profile: UserProfile | null }> {
  return apiFetch<{ profile: UserProfile | null }>("/profile");
}

export async function patchProfile(
  data: Partial<{
    displayName: string | null;
    language: string;
    timezone: string | null;
    communicationStyle: string;
    customInstructions: string | null;
    defaultModel: string | null;
    avatarUrl: string | null;
    uiPreferences: Record<string, unknown> | null;
  }>,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function fetchProfileProviders(): Promise<{ providers: UserProvider[] }> {
  return apiFetch<{ providers: UserProvider[] }>("/profile/providers");
}

export async function upsertProfileProvider(
  providerId: string,
  data: {
    apiKeyEnvVar: string;
    baseUrl?: string | null;
    priority?: number;
    headers?: Record<string, string> | null;
  },
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/profile/providers/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteProfileProvider(providerId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/profile/providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
  });
}

export async function patchProfileProviderKey(
  providerId: string,
  apiKey: string,
): Promise<{ ok: boolean; masked: string }> {
  return apiFetch<{ ok: boolean; masked: string }>(
    `/profile/providers/${encodeURIComponent(providerId)}/key`,
    { method: "PATCH", body: JSON.stringify({ apiKey }) },
  );
}

export async function discoverProviderModels(
  providerId: string,
): Promise<{ models: DiscoveredModel[]; error?: string }> {
  return apiFetch<{ models: DiscoveredModel[]; error?: string }>(
    `/profile/providers/${encodeURIComponent(providerId)}/models`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Cost Dashboard
// ---------------------------------------------------------------------------

export async function fetchCostSummary(slug: string, period = "7d"): Promise<CostSummary> {
  return apiFetch<CostSummary>(`/instances/${slug}/costs/summary?period=${period}`);
}

export async function fetchDailyCosts(slug: string, period = "7d"): Promise<DailyCost[]> {
  return apiFetch<DailyCost[]>(`/instances/${slug}/costs/daily?period=${period}`);
}

export async function fetchCostsByAgent(slug: string, period = "7d"): Promise<AgentCost[]> {
  return apiFetch<AgentCost[]>(`/instances/${slug}/costs/by-agent?period=${period}`);
}

export async function fetchCostsByModel(slug: string, period = "7d"): Promise<ModelCost[]> {
  return apiFetch<ModelCost[]>(`/instances/${slug}/costs/by-model?period=${period}`);
}

// ---------------------------------------------------------------------------
// Activity Console / Events
// ---------------------------------------------------------------------------

export async function fetchRtEvents(
  slug: string,
  params?: {
    cursor?: number;
    limit?: number;
    type?: string[];
    agentId?: string;
    level?: string;
    since?: string;
    until?: string;
  },
): Promise<RtEventsPage> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set("cursor", String(params.cursor));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.type?.length) qs.set("type", params.type.join(","));
  if (params?.agentId) qs.set("agentId", params.agentId);
  if (params?.level) qs.set("level", params.level);
  if (params?.since) qs.set("since", params.since);
  if (params?.until) qs.set("until", params.until);
  const q = qs.toString();
  return apiFetch<RtEventsPage>(`/instances/${slug}/events${q ? `?${q}` : ""}`);
}

/** Build the SSE URL for the events stream endpoint. */
export function getEventsStreamUrl(
  slug: string,
  filters?: { type?: string[]; agentId?: string; level?: string },
): string {
  const qs = new URLSearchParams();
  if (filters?.type?.length) qs.set("type", filters.type.join(","));
  if (filters?.agentId) qs.set("agentId", filters.agentId);
  if (filters?.level) qs.set("level", filters.level);
  const q = qs.toString();
  return `/api/instances/${slug}/events/stream${q ? `?${q}` : ""}`;
}

// ---------------------------------------------------------------------------
// Memory Browser
// ---------------------------------------------------------------------------

export async function fetchMemoryAgents(slug: string): Promise<{ agents: MemoryAgentSummary[] }> {
  return apiFetch<{ agents: MemoryAgentSummary[] }>(`/instances/${slug}/memory/agents`);
}

export async function fetchMemoryFiles(
  slug: string,
  agentId: string,
): Promise<{ agentId: string; files: MemoryFileInfo[] }> {
  return apiFetch<{ agentId: string; files: MemoryFileInfo[] }>(
    `/instances/${slug}/memory/agents/${encodeURIComponent(agentId)}/files`,
  );
}

export async function fetchMemoryFile(
  slug: string,
  agentId: string,
  filePath: string,
): Promise<MemoryFileContent> {
  return apiFetch<MemoryFileContent>(
    `/instances/${slug}/memory/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(filePath)}`,
  );
}

export async function searchMemoryFiles(
  slug: string,
  query: string,
  opts?: { agentId?: string; limit?: number },
): Promise<MemorySearchResponse> {
  const qs = new URLSearchParams({ q: query });
  if (opts?.agentId) qs.set("agentId", opts.agentId);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  return apiFetch<MemorySearchResponse>(`/instances/${slug}/memory/search?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Heartbeat Heatmap
// ---------------------------------------------------------------------------

export async function fetchHeartbeatSchedule(
  slug: string,
): Promise<{ agents: HeartbeatScheduleAgent[] }> {
  return apiFetch<{ agents: HeartbeatScheduleAgent[] }>(`/instances/${slug}/heartbeat/schedule`);
}

export async function fetchHeartbeatHeatmap(
  slug: string,
  days: 7 | 14 | 30 = 7,
): Promise<{ period: string; buckets: HeartbeatHourBucket[]; stats: HeartbeatAgentStats[] }> {
  return apiFetch<{ period: string; buckets: HeartbeatHourBucket[]; stats: HeartbeatAgentStats[] }>(
    `/instances/${slug}/heartbeat/heatmap?days=${days}`,
  );
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function fetchInstanceSkills(slug: string): Promise<SkillsListResponse> {
  return apiFetch<SkillsListResponse>(`/instances/${slug}/skills`);
}

/** Upload a ZIP archive containing a skill folder. */
export async function uploadSkillZip(
  slug: string,
  file: File,
): Promise<{ ok: boolean; name: string }> {
  const form = new FormData();
  form.append("file", file);
  // Do not use apiFetch — FormData needs the browser to set Content-Type with boundary
  const res = await fetch(`/api/instances/${slug}/skills/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    throw new ApiError(res.status, body.code ?? "UPLOAD_ERROR", body.error ?? res.statusText);
  }
  return res.json() as Promise<{ ok: boolean; name: string }>;
}

/** Install a skill from a GitHub directory URL. */
export async function installSkillFromGitHub(
  slug: string,
  url: string,
): Promise<{ ok: boolean; name: string; filesCount: number }> {
  return apiFetch<{ ok: boolean; name: string; filesCount: number }>(
    `/instances/${slug}/skills/install`,
    { method: "POST", body: JSON.stringify({ url }) },
  );
}

/** Delete a workspace skill by name. */
export async function deleteSkill(slug: string, name: string): Promise<void> {
  await apiFetch(`/instances/${slug}/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
}
