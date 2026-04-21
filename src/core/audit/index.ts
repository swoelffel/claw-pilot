// src/core/audit/index.ts
//
// Public surface of the audit event bus. Consumers import from here; the
// emitter/sink modules stay internal implementation details.
//
// See `docs/architecture/audit-event-bus.md` for the full contract.

export type { AuditEvent, AuditEventEnvelope } from "./events.js";
export {
  emitAudit,
  flushAudit,
  shutdownAuditBus,
  registerAuditSink,
  isAuditBusRegistered,
  resetAuditBus,
  DEFAULT_SINK_BRAND,
  type AuditSink,
} from "./emitter.js";
export { bootstrapAuditBus } from "./bootstrap.js";
export { canonicalize, hashArgs } from "./canonical.js";
