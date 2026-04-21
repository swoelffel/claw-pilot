// src/dashboard/routes/_internal-api-client.ts
//
// HTTP client for dashboard→runtime daemon IPC.
// Calls the runtime's internal API server on its derived port.

import { resolveActualInternalApiPort, resolveInternalApiToken } from "../../lib/platform.js";
import { logger } from "../../lib/logger.js";

/** Default timeout for chat requests (5 minutes). */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Call the runtime daemon's internal API.
 * Throws on HTTP errors, timeouts, and connection failures.
 */
export async function callRuntimeApi<T>(
  slug: string,
  path: string,
  body: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const port = resolveActualInternalApiPort(slug);
  const token = await resolveInternalApiToken(slug);
  const url = `http://127.0.0.1:${port}${path}`;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    let errorBody: { error?: string; code?: string } = {};
    try {
      errorBody = (await response.json()) as { error?: string; code?: string };
    } catch (err) {
      logger.debug("internal_api_client_error_parse_failed", {
        error: String(err),
        slug,
        path,
        status: response.status,
      });
    }
    const msg = errorBody.error ?? `Runtime API returned ${response.status}`;
    const err = new Error(msg);
    (err as Error & { code?: string }).code = errorBody.code ?? "RUNTIME_ERROR";
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  return (await response.json()) as T;
}

/** Timeout for best-effort event publish (short — fire-and-forget). */
const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Publish an event on the runtime daemon's bus via HTTP.
 * Best-effort: errors are logged but never thrown.
 */
export async function publishRuntimeEvent(
  slug: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const port = resolveActualInternalApiPort(slug);
  const token = await resolveInternalApiToken(slug);
  const url = `http://127.0.0.1:${port}/internal/events/publish`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type, payload }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.debug("[publish-event] daemon rejected event", {
        slug,
        type,
        status: response.status,
      });
    }
  } catch (err) {
    // Best-effort — daemon may not be running
    logger.debug("[publish-event] failed to publish event to daemon", {
      slug,
      type,
      error: String(err),
    });
  }
}
