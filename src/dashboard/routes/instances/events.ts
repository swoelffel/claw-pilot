// src/dashboard/routes/instances/events.ts
// Routes: GET events (paginated), GET events/stream (SSE)

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import {
  listRtEvents,
  isExcluded,
  deriveLevel,
  deriveSummary,
  type EventLevel,
} from "../../../core/repositories/rt-event-repository.js";
import { getBus, hasBus } from "../../../runtime/bus/index.js";

const VALID_LEVELS = new Set<EventLevel>(["info", "warn", "error"]);

function parseLevel(raw: string | undefined): EventLevel | undefined {
  if (raw && VALID_LEVELS.has(raw as EventLevel)) return raw as EventLevel;
  return undefined;
}

function parseTypes(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const types = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return types.length > 0 ? types : undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function registerEventsRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/events
  // Paginated historical events with filters.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/events", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const cursor = parseNumber(c.req.query("cursor"));
    const limit = parseNumber(c.req.query("limit"));
    const types = parseTypes(c.req.query("type"));
    const agentId = c.req.query("agentId") || undefined;
    const level = parseLevel(c.req.query("level"));
    const since = c.req.query("since") || undefined;
    const until = c.req.query("until") || undefined;

    const page = listRtEvents(db, {
      instanceSlug: slug,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(types !== undefined ? { types } : {}),
      ...(agentId !== undefined ? { agentId } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
    });

    return c.json({
      events: page.events.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        agentId: e.agent_id,
        sessionId: e.session_id,
        level: e.level,
        summary: e.summary,
        payload: e.payload ? JSON.parse(e.payload) : null,
        createdAt: e.created_at,
      })),
      nextCursor: page.nextCursor,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/events/stream
  // SSE stream of real-time bus events (all types except excluded ones).
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/events/stream", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    // Optional filters
    const filterTypes = parseTypes(c.req.query("type"));
    const filterTypesSet = filterTypes ? new Set(filterTypes) : null;
    const filterAgentId = c.req.query("agentId") || undefined;
    const filterLevel = parseLevel(c.req.query("level"));

    // If the runtime bus isn't active, still open the SSE (it will just receive pings)
    const bus = hasBus(slug) ? getBus(slug) : null;

    return streamSSE(c, async (stream) => {
      const unsub = bus?.subscribeAll((event) => {
        if (isExcluded(event.type)) return;

        // Apply optional server-side filters
        if (filterTypesSet && !filterTypesSet.has(event.type)) return;

        const payload = event.payload as Record<string, unknown>;
        const level = deriveLevel(event.type);

        if (filterLevel && level !== filterLevel) return;

        if (filterAgentId) {
          const agentId = (payload.agentId ?? payload.fromAgentId) as string | undefined;
          if (agentId !== filterAgentId) return;
        }

        const summary = deriveSummary(event.type, payload);

        void stream.writeSSE({
          data: JSON.stringify({
            type: event.type,
            level,
            summary,
            payload,
            timestamp: new Date().toISOString(),
          }),
        });
      });

      // Ping every 15s to keep the connection alive
      const pingInterval = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" });
      }, 15_000);

      // Cleanup on client disconnect
      stream.onAbort(() => {
        clearInterval(pingInterval);
        unsub?.();
      });

      // Keep the stream open until the client disconnects
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });
}
