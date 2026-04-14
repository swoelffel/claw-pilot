// src/dashboard/routes/_sse-proxy.ts
//
// Proxy SSE events from a runtime daemon to a browser client.
// The daemon exposes GET /internal/events/stream (raw node:http SSE).
// This helper connects to it via fetch() and pipes parsed events through
// Hono's SSEStreamingApi so the browser receives them transparently.

import type { SSEStreamingApi } from "hono/streaming";
import { deriveInternalApiPort, resolveInternalApiToken } from "../../lib/platform.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxySSEParams {
  /** Filter events by session ID (daemon-side). */
  sessionId?: string;
  /** Comma-separated event types to subscribe to (daemon-side filter). */
  types?: string;
  /**
   * Optional dashboard-side transform applied to each parsed event.
   * Return the (possibly reshaped) event object, or `null` to skip it.
   */
  transform?: (raw: Record<string, unknown>) => Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// SSE line parser
// ---------------------------------------------------------------------------

/**
 * Parse raw SSE text chunks into discrete events.
 * Yields the `data` field content for each event block (delimited by blank lines).
 * Comment-only blocks (`:ping`) are skipped.
 */
function* parseSSEChunks(buffer: string): Generator<string, string> {
  let rest = buffer;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const idx = rest.indexOf("\n\n");
    if (idx === -1) return rest; // return unconsumed remainder
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);

    // Extract data lines (ignore event/id/retry/comments)
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length > 0) {
      yield dataLines.join("\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Pipe logic (extracted to reduce cognitive complexity of proxyRuntimeSSE)
// ---------------------------------------------------------------------------

/** Read from the upstream SSE body and forward parsed events to the browser stream. */
async function _pipeUpstream(
  body: ReadableStream<Uint8Array>,
  stream: SSEStreamingApi,
  transform?: (raw: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });

    const gen = parseSSEChunks(sseBuffer);
    let result = gen.next();
    while (!result.done) {
      const dataStr = result.value as string;
      try {
        const parsed = JSON.parse(dataStr) as Record<string, unknown>;
        const output = transform ? transform(parsed) : parsed;
        if (output !== null) {
          await stream.writeSSE({ data: JSON.stringify(output) });
        }
      } catch (err) {
        logger.debug("[sse-proxy] failed to parse SSE data", { error: String(err) });
      }
      result = gen.next();
    }
    // Unconsumed remainder is the generator return value
    sseBuffer = result.value as string;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const PING_INTERVAL_MS = 15_000;

/** Build the upstream daemon URL for the SSE endpoint. */
function _buildUpstreamUrl(slug: string, params?: ProxySSEParams): string {
  const port = deriveInternalApiPort(slug);
  const qs = new URLSearchParams();
  if (params?.sessionId) qs.set("sessionId", params.sessionId);
  if (params?.types) qs.set("types", params.types);
  const qsStr = qs.toString();
  return `http://127.0.0.1:${port}/internal/events/stream${qsStr ? `?${qsStr}` : ""}`;
}

/**
 * Connect to the runtime daemon's SSE endpoint and pipe events to the browser.
 *
 * This function does NOT return until the browser disconnects or the upstream
 * connection ends. Call it inside `streamSSE(c, async (stream) => { ... })`.
 */
export async function proxyRuntimeSSE(
  stream: SSEStreamingApi,
  slug: string,
  params?: ProxySSEParams,
): Promise<void> {
  const url = _buildUpstreamUrl(slug, params);
  const token = resolveInternalApiToken(slug);

  // AbortController wired to browser disconnect
  const ac = new AbortController();
  stream.onAbort(() => ac.abort());

  // Fallback ping in case upstream is silent
  const pingInterval = setInterval(() => {
    void stream.writeSSE({ event: "ping", data: "" });
  }, PING_INTERVAL_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });

    if (!response.ok || !response.body) {
      logger.warn("[sse-proxy] daemon returned non-200 or no body", {
        slug,
        status: response.status,
      });
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ code: "RUNTIME_ERROR", status: response.status }),
      });
      await _waitForAbort(stream);
      return;
    }

    await _pipeUpstream(response.body, stream, params?.transform);

    // Upstream ended (daemon stopped or restarted) — notify browser
    await stream.writeSSE({
      event: "disconnect",
      data: JSON.stringify({ code: "RUNTIME_DISCONNECTED" }),
    });
  } catch (err) {
    if (ac.signal.aborted) return; // Browser disconnected — normal
    await _handleUpstreamError(err, stream, slug);
  } finally {
    clearInterval(pingInterval);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Block until the browser disconnects (stream aborted). */
function _waitForAbort(stream: SSEStreamingApi): Promise<void> {
  return new Promise<void>((resolve) => {
    stream.onAbort(resolve);
  });
}

/** Log and forward an upstream connection error to the browser. */
async function _handleUpstreamError(
  err: unknown,
  stream: SSEStreamingApi,
  slug: string,
): Promise<void> {
  const code =
    err instanceof TypeError && String(err).includes("fetch")
      ? "RUNTIME_UNREACHABLE"
      : "SSE_PROXY_ERROR";

  logger.warn("[sse-proxy] upstream connection failed", { slug, error: String(err) });
  try {
    await stream.writeSSE({ event: "error", data: JSON.stringify({ code }) });
  } catch (writeErr) {
    logger.debug("[sse-proxy] failed to write error event (stream closed)", {
      error: String(writeErr),
    });
  }

  // Keep stream alive so browser EventSource retries after a delay
  await _waitForAbort(stream);
}
