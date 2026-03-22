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
      insertRtEvent(db, {
        instanceSlug,
        eventType: event.type,
        ...(agentId !== undefined ? { agentId } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        level,
        summary,
        payload: JSON.stringify(payload),
      });
    } catch {
      // Silently ignore persistence errors to avoid disrupting the runtime.
      // The bus handler must never throw.
    }
  });
}
