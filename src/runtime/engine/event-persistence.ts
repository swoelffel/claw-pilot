// src/runtime/engine/event-persistence.ts
//
// Subscribes to the instance bus and persists events to the rt_events table.
// High-frequency event types (streaming deltas, heartbeat ticks) are excluded.

import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";
import { getBus } from "../bus/index.js";
import {
  isExcluded,
  deriveLevel,
  deriveSummary,
  extractIds,
  insertRtEvent,
} from "../../core/repositories/rt-event-repository.js";
import { logger } from "../../lib/logger.js";
import { recordObservabilityEvent } from "../../core/repositories/observability-repository.js";
import { appendExecutionEvent } from "../../core/repositories/execution-event-repository.js";

interface ExecutionContext {
  id: string;
  request_id: string | null;
  trace_id: string | null;
  correlation_id: string;
  parent_execution_id: string | null;
  attempt: number;
}

function findExecutionContext(
  db: Database.Database,
  sessionId: string | undefined,
): ExecutionContext | undefined {
  if (!sessionId) return undefined;
  return db
    .prepare(
      `SELECT id, request_id, trace_id, correlation_id, parent_execution_id, attempt
       FROM rt_executions WHERE session_id = ? ORDER BY accepted_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as ExecutionContext | undefined;
}

function activityKind(eventType: string, execution: ExecutionContext | undefined) {
  if (execution?.parent_execution_id) return "child_agent" as const;
  if (eventType.startsWith("flow.")) return "workflow" as const;
  if (eventType.startsWith("runtime.")) return "system" as const;
  return "human_request" as const;
}

function numericAttribute(payload: Record<string, unknown>, key: string): number | undefined {
  return typeof payload[key] === "number" ? payload[key] : undefined;
}

function persistObservability(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  eventType: string,
  payload: Record<string, unknown>,
  agentId: string | undefined,
  sessionId: string | undefined,
  level: string,
): void {
  const execution = findExecutionContext(db, sessionId);
  const permissionDenied = eventType === "permission.replied" && payload.action === "deny";
  const eventName = permissionDenied ? "permission.denied" : eventType;
  const isError =
    permissionDenied ||
    level === "error" ||
    eventType.endsWith(".failed") ||
    eventType.endsWith(".timeout");
  const completed = eventType.endsWith(".completed") || eventType.endsWith(".ended");
  recordObservabilityEvent(db, {
    instanceSlug,
    eventName,
    eventKind: isError ? "error" : "span",
    traceId:
      execution?.trace_id ??
      execution?.correlation_id ??
      String(payload.traceId ?? payload.requestId ?? sessionId ?? `${instanceSlug}:${Date.now()}`),
    requestId:
      execution?.request_id ??
      (typeof payload.requestId === "string" ? payload.requestId : undefined),
    executionId: execution?.id,
    sessionId,
    agentId,
    activityKind: activityKind(eventType, execution),
    phase: eventType.split(".")[0],
    toolName: typeof payload.toolName === "string" ? payload.toolName : undefined,
    resource: typeof payload.resource === "string" ? payload.resource : undefined,
    errorCode: isError
      ? String(payload.errorCode ?? eventName.toUpperCase().replaceAll(".", "_"))
      : undefined,
    attempt: execution?.attempt,
    retryable: isError ? Boolean(payload.retryable) : undefined,
    success: isError ? false : completed ? true : undefined,
    durationMs: numericAttribute(payload, "durationMs") ?? numericAttribute(payload, "elapsedMs"),
    costUsd: numericAttribute(payload, "costUsd"),
  });
}

/**
 * Wire bus event persistence for an instance.
 * Returns an unsubscribe function to call on stop().
 */
export function wireEventPersistence(
  db: Database.Database,
  instanceSlug: InstanceSlug,
): () => void {
  const bus = getBus(instanceSlug);

  return bus.subscribeAll((event) => {
    if (isExcluded(event.type)) return;

    const payload = event.payload as Record<string, unknown>;
    const { agentId, sessionId } = extractIds(payload);
    const level = deriveLevel(event.type);
    const summary = deriveSummary(event.type, payload);

    try {
      if (typeof payload.requestId === "string") {
        (event as typeof event & { eventId?: number }).eventId = appendExecutionEvent(db, {
          request_id: payload.requestId,
          execution_id: typeof payload.executionId === "string" ? payload.executionId : null,
          trace_id: typeof payload.traceId === "string" ? payload.traceId : payload.requestId,
          instance_slug: instanceSlug,
          session_id: sessionId ?? null,
          event_type: event.type,
          payload,
        });
      }
      insertRtEvent(db, {
        instanceSlug,
        eventType: event.type,
        ...(agentId !== undefined ? { agentId } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        level,
        summary,
        payload: JSON.stringify(payload),
      });
      persistObservability(db, instanceSlug, event.type, payload, agentId, sessionId, level);
    } catch (err) {
      logger.warn("[event-persistence] event insert failed", { error: String(err) });
      // Silently ignore persistence errors to avoid disrupting the runtime.
      // The bus handler must never throw.
    }
  });
}
