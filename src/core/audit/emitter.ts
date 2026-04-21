// src/core/audit/emitter.ts
//
// Structured audit bus (H6). Community ships two default sinks at bootstrap
// — `FileAuditSink` (JSONL) and `DbAuditSink` (rt_audit_events) — and gates
// every additional sink on `capabilities.has("audit-siem")`.
//
// Extension point: Enterprise calls `registerAuditSink(new SplunkSink(...))`
// after setting `audit-siem` on the CapabilityRegistry. No core modification
// required.

import { ClawPilotError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { capabilities } from "../capabilities.js";
import { serverRegistry } from "../../server/registry.js";
import type { AuditEvent, AuditEventEnvelope } from "./events.js";

export interface AuditSink {
  /** Short identifier, e.g. `"file"`, `"db"`, `"splunk"`. */
  readonly kind: string;
  /** Persist a single envelope. MUST NOT throw — errors are logged and swallowed. */
  write(envelope: AuditEventEnvelope): Promise<void>;
  /** Optional flush-to-durable-storage hook, called by `flushAudit()`. */
  flush?(): Promise<void>;
}

const BUFFER_FLUSH_THRESHOLD = 100;
const BUFFER_FLUSH_INTERVAL_MS = 1000;

const sinks: AuditSink[] = [];
let buffer: AuditEventEnvelope[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

/** Brand tag for the default-shipped sinks that bypass the audit-siem gate. */
export const DEFAULT_SINK_BRAND: unique symbol = Symbol("default-audit-sink");

function isDefaultSink(sink: AuditSink): boolean {
  return (sink as unknown as Record<symbol, unknown>)[DEFAULT_SINK_BRAND] === true;
}

/**
 * Register an audit sink. The two default sinks (file + db) carry the
 * `DEFAULT_SINK_BRAND` and are always accepted. Any other sink requires the
 * `audit-siem` capability; absence throws `AUDIT_SIEM_CAPABILITY_REQUIRED`.
 */
export function registerAuditSink(sink: AuditSink): void {
  if (!isDefaultSink(sink) && !capabilities.has("audit-siem")) {
    throw new ClawPilotError(
      `Registering AuditSink "${sink.kind}" requires the 'audit-siem' capability`,
      "AUDIT_SIEM_CAPABILITY_REQUIRED",
    );
  }
  sinks.push(sink);
}

/** Test helper — clear sinks + buffer between tests. */
export function resetAuditBus(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  sinks.length = 0;
  buffer = [];
  shuttingDown = false;
}

/** Returns `true` iff at least one sink is registered. */
export function isAuditBusRegistered(): boolean {
  return sinks.length > 0;
}

function resolveServerId(): string {
  try {
    return serverRegistry.getLocal().id;
  } catch {
    // serverRegistry not bootstrapped yet (early logging, tests without ctx)
    return "unknown";
  }
}

/**
 * Emit an audit event. Sync, non-blocking: the envelope is appended to an
 * in-memory buffer and flushed asynchronously. Safe to call before the bus
 * is bootstrapped — events are dropped (with a debug log) in that case so
 * early-boot emits never crash the process.
 */
export function emitAudit(event: AuditEvent): void {
  if (sinks.length === 0) {
    logger.debug("[audit] emit before bootstrap — dropped", { kind: event.kind });
    return;
  }
  const envelope: AuditEventEnvelope = {
    ...event,
    timestamp: new Date().toISOString(),
    serverId: resolveServerId(),
  };
  buffer.push(envelope);
  if (buffer.length >= BUFFER_FLUSH_THRESHOLD) {
    void flushAudit();
    return;
  }
  ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer !== null || shuttingDown) return;
  flushTimer = setInterval(() => {
    void flushAudit();
  }, BUFFER_FLUSH_INTERVAL_MS);
  // Don't keep the event loop alive just for the flush timer.
  flushTimer.unref?.();
}

/**
 * Drain the buffer into every registered sink and await each sink's
 * `flush()`. Called automatically on threshold/timer, and explicitly from
 * SIGTERM/SIGINT shutdown hooks to ship the tail of events.
 */
export async function flushAudit(): Promise<void> {
  if (buffer.length === 0 && !anySinkHasFlush()) return;
  const batch = buffer;
  buffer = [];

  for (const envelope of batch) {
    for (const sink of sinks) {
      try {
        await sink.write(envelope);
      } catch (err) {
        logger.error("[audit] sink.write failed — event dropped", {
          sink: sink.kind,
          kind: envelope.kind,
          error: String(err),
        });
      }
    }
  }

  for (const sink of sinks) {
    if (!sink.flush) continue;
    try {
      await sink.flush();
    } catch (err) {
      logger.error("[audit] sink.flush failed", { sink: sink.kind, error: String(err) });
    }
  }
}

function anySinkHasFlush(): boolean {
  return sinks.some((s) => s.flush !== undefined);
}

/**
 * Stop the flush timer and drain the buffer one last time. Called from
 * shutdown hooks (SIGTERM/SIGINT) to avoid losing the tail of events on
 * graceful stop. After calling this, `emitAudit()` keeps buffering but
 * the timer will not restart.
 */
export async function shutdownAuditBus(): Promise<void> {
  shuttingDown = true;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushAudit();
}
