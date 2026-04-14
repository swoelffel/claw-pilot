// src/dashboard/routes/instances/events.ts
// Routes: GET events (paginated), GET events/stream (SSE)

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RouteDeps } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  listRtEvents,
  isExcluded,
  deriveLevel,
  deriveSummary,
  type EventLevel,
} from "../../../core/repositories/rt-event-repository.js";
import { proxyRuntimeSSE } from "../_sse-proxy.js";

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
  const { db } = deps;

  // ---------------------------------------------------------------------------
  // GET /api/instances/:slug/events
  // Paginated historical events with filters.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/events", (c) => {
    const { slug } = getInstanceContext(c);

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
  // SSE stream proxied from the runtime daemon's bus.
  // ---------------------------------------------------------------------------
  app.get("/api/instances/:slug/events/stream", (c) => {
    const { slug } = getInstanceContext(c);

    // Optional filters
    const filterTypes = c.req.query("type") || undefined;
    const filterAgentId = c.req.query("agentId") || undefined;
    const filterLevel = parseLevel(c.req.query("level"));

    return streamSSE(c, async (stream) => {
      await proxyRuntimeSSE(stream, slug, {
        ...(filterTypes !== undefined ? { types: filterTypes } : {}),
        transform: (raw) => {
          const eventType = raw.type as string;
          if (isExcluded(eventType)) return null;

          const payload = raw.payload as Record<string, unknown>;
          const level = deriveLevel(eventType);

          if (filterLevel && level !== filterLevel) return null;

          if (filterAgentId) {
            const agentId = (payload.agentId ?? payload.fromAgentId) as string | undefined;
            if (agentId !== filterAgentId) return null;
          }

          return {
            type: eventType,
            level,
            summary: deriveSummary(eventType, payload),
            payload,
            timestamp: raw.timestamp,
          };
        },
      });
    });
  });
}
