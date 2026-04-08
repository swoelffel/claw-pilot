// src/core/model-discovery/adapters/base.ts
//
// Shared utilities for provider adapters.

import type { DiscoveredModel } from "../types.js";
import type { ModelApi, ProviderId } from "../../../runtime/types.js";

/** Default fetch timeout for provider API calls (10 seconds). */
export const DISCOVERY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Helper to create a DiscoveredModel with sensible defaults.
 */
export function makeDiscoveredModel(
  providerId: ProviderId,
  id: string,
  opts: {
    name?: string;
    api: ModelApi;
    capabilities?: Partial<DiscoveredModel["capabilities"]>;
    cost?: Partial<DiscoveredModel["cost"]>;
  },
): DiscoveredModel {
  return {
    id,
    providerId,
    name: opts.name ?? id,
    api: opts.api,
    capabilities: opts.capabilities ?? {},
    cost: opts.cost ?? {},
    discoveredAt: new Date().toISOString(),
  };
}

/**
 * Fetch JSON from a URL with timeout and abort support.
 */
export async function fetchJson<T>(
  url: string,
  opts?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? DISCOVERY_FETCH_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
