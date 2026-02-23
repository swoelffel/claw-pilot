import type { InstanceInfo, AgentInfo, CreateInstanceRequest, ProvidersResponse } from "./types.js";

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
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchInstances(): Promise<InstanceInfo[]> {
  return apiFetch<InstanceInfo[]>("/instances");
}

export async function fetchInstance(
  slug: string,
): Promise<{ instance: InstanceInfo; status: unknown }> {
  return apiFetch<{ instance: InstanceInfo; status: unknown }>(
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
