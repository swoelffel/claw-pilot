# Audit Event Bus

> Hook H6 of the Enterprise Edition roadmap. Ships the taxonomy, the
> `emitAudit()` API, and two default Community sinks (file + DB). Enterprise
> plugs a SIEM sink (Splunk / Datadog / Elastic) via `registerAuditSink()`
> without patching a frozen path.

## Purpose

Emit structured, typed security events for audit trails and SIEM export.
Community used to log some events ad-hoc (via `registry.logEvent()` into
the legacy `events` table) with no unified taxonomy, no pluggable sink, and
no guarantee of capture for sensitive actions. H6 fixes all three.

Without H6 instrumented in Community, Enterprise would have to patch
`src/dashboard/middleware/permission.ts`, `src/core/auth/*`,
`src/core/secrets/*` and `src/dashboard/routes/named-keys.ts` to add emits —
four frozen-path violations per release. H6 ships the emits upfront so the
Enterprise merge stays byte-identical on those files.

## Module layout

```
src/core/audit/
  events.ts            — AuditEvent discriminated union, AuditEventEnvelope
  canonical.ts         — canonicalize() + hashArgs() (sorted-keys JSON + SHA-256)
  emitter.ts           — emitAudit, flushAudit, registerAuditSink, DEFAULT_SINK_BRAND
  sinks/file.ts        — FileAuditSink (JSONL, daily rotation in <stateDir>/audit/)
  sinks/db.ts          — DbAuditSink (writes to rt_audit_events, migration v39)
  bootstrap.ts         — bootstrapAuditBus(db, stateDir) — idempotent
  index.ts             — public surface
```

## Taxonomy

Seven event variants ship in H6. Adding a variant is a dedicated PR.

| `kind` | Fields (beyond envelope) | Emitted by |
|--------|--------------------------|------------|
| `auth.login` | `userId`, `provider`, `success`, `ip?`, `userAgent?` | [auth.ts:74](../../src/dashboard/routes/auth.ts#L74) |
| `auth.logout` | `userId` | [auth.ts:84](../../src/dashboard/routes/auth.ts#L84) |
| `auth.failed` | `attemptedUsername`, `reason`, `ip?` | [auth.ts:50](../../src/dashboard/routes/auth.ts#L50) |
| `permission.denied` | `userId`, `action`, `resource`, `reason` | [permission.ts:145](../../src/dashboard/middleware/permission.ts#L145) |
| `secret.access` | `name`, `by` | opt-in — see below |
| `agent.tool_call` | `agentId`, `tool`, `argsHash`, `userId?` | [prompt-loop.ts:627](../../src/runtime/session/prompt-loop.ts#L627) |
| `named_key.mutation` | `action`, `keyId`, `by` | [named-keys.ts](../../src/dashboard/routes/named-keys.ts) |

Each envelope carries `timestamp` (ISO-8601 UTC), `serverId`
(`serverRegistry.getLocal().id`) and an Enterprise `orgId?` slot.

## API

### `emitAudit(event)`

Synchronous, non-blocking. Appends the envelope to an in-memory buffer.
Buffer is flushed when it reaches 100 events or after 1s, whichever comes
first. Emits that happen *before* a sink is registered are dropped with a
debug log (safe to call during early bootstrap).

### `flushAudit()`

Drains the buffer into every registered sink and awaits each sink's
`flush()`. Called automatically on threshold/timer. Explicit callers:
shutdown hooks (SIGTERM / SIGINT) — see [commands/runtime.ts](../../src/commands/runtime.ts)
and [dashboard/server.ts](../../src/dashboard/server.ts).

### `shutdownAuditBus()`

Stops the flush timer and drains the buffer a final time. Called from
every process-exit hook so the tail of events is not lost.

### `registerAuditSink(sink)`

Registers an additional sink. The two default sinks carry `DEFAULT_SINK_BRAND`
and bypass the capability gate. Any other sink requires
`capabilities.has("audit-siem")` and throws
`AUDIT_SIEM_CAPABILITY_REQUIRED` otherwise.

## Default sinks

`bootstrapAuditBus(db, stateDir)` registers both at startup:

### `FileAuditSink`

Appends one JSON-object-per-line into `<stateDir>/audit/YYYY-MM-DD.jsonl`.
Rotation is computed from the envelope's `timestamp`, not wall-clock, so
events near midnight land in the day they were emitted.

Intended ops interface: `tail -f <stateDir>/audit/*.jsonl`.

### `DbAuditSink`

Writes to the `rt_audit_events` table (migration v39). Schema:

```sql
CREATE TABLE rt_audit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  server_id  TEXT NOT NULL,
  org_id     TEXT NULL,        -- Enterprise multi-tenancy slot (R2)
  user_id    TEXT NULL,
  payload    TEXT NOT NULL,    -- full envelope JSON (source of truth)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Indices on `(kind, timestamp)`, `(org_id, timestamp)` and
`(user_id, timestamp)` power dashboard queries and Enterprise per-tenant
filters.

Separate from the legacy `events` table (free-form per-instance lifecycle
log) and from `rt_events` (runtime bus messages for the Activity Console).

## Canonical `argsHash`

`agent.tool_call` events carry a SHA-256 of the canonical JSON form of the
tool arguments. Canonical = keys sorted lexicographically at every level.
Two structurally-identical argument objects produce the same hash
regardless of property order — critical for SIEM deduplication and
audit-trail stability across model re-runs.

```typescript
hashArgs({ query: "x", limit: 10 }) === hashArgs({ limit: 10, query: "x" });
```

Hashing (not raw args) avoids PII / secret leakage when tool inputs
contain user data. Recovering the original arguments from the envelope is
intentionally impossible.

## <a id="secret.access-opt-in"></a>`secret.access` opt-in

`SecretProvider.get(name, { audit: true, by: userId })` emits `secret.access`
on successful read. The emit is the *proxy*'s responsibility — concrete
providers (EnvSecretProvider) don't implement it.

**Community instrumentation checklist: 0 active opt-ins.** All Community
reads happen at bootstrap or connection-setup (master encryption key,
Telegram bot tokens, web-chat tokens) — emitting there would spam the
audit log without adding security signal.

Enterprise opts in by wrapping the provider (e.g. `VaultSecretProvider`)
and forcing `{ audit: true }` on every read. The flag exists in the
Community contract so that wrapper is a drop-in, not a patch.

## R5 — no plaintext secrets

Event variants are Zod-schema-strict by virtue of the discriminated
union. Fields that would leak a secret (`apiKey`, `password`, raw bearer
tokens) are structurally absent from every variant. There is no runtime
sanitizer — the type system is the enforcement.

Reminder to future contributors: **never add a field to an `AuditEvent`
variant that could carry secret material**. If you need to audit a secret
read, emit `{ kind: "secret.access", name, by }` and do not include the
value.

## Bootstrap

Every process entry point calls `bootstrapAuditBus(db)` exactly once:

- [src/commands/_context.ts](../../src/commands/_context.ts) — CLI commands
- [src/commands/dashboard.ts](../../src/commands/dashboard.ts) — web dashboard
- [src/commands/runtime.ts](../../src/commands/runtime.ts) — per-instance runtime

The call is idempotent — a second invocation is a no-op — so Enterprise
can safely register its own sinks *before* the default bootstrap runs.

Shutdown is wired in every matching exit hook:

- `withContext`'s `finally` block (CLI commands)
- `SIGTERM` handler in `dashboard/server.ts`
- `SIGTERM` / `SIGINT` handler in `runtime.ts`

## Enterprise extension

```typescript
// packages/enterprise-audit/src/bootstrap.ts
import { registerAuditSink } from "claw-pilot/core/audit";
import { SplunkAuditSink } from "./splunk.js";
import { setCapabilityRegistry } from "claw-pilot/core/capabilities";
import { EnterpriseCapabilityRegistry } from "./capabilities.js";

// 1. Enable the capability BEFORE bootstrapAuditBus runs.
setCapabilityRegistry(new EnterpriseCapabilityRegistry(license));

// 2. Register the SIEM sink. Default file + db sinks stay in place —
//    Splunk receives a mirrored copy.
registerAuditSink(new SplunkAuditSink(license.splunkUrl, license.splunkToken));
```

## Discipline

- **R1** — no `if (isEnterprise)`. Sink gate is
  `capabilities.has("audit-siem")`.
- **R2** — `rt_audit_events` carries `org_id TEXT NULL` natively.
- **R3** — every frozen-path commit carries
  `Extension-Point: audit-event-bus`.
- **R4** — the hook is shipped in Community before any Enterprise sink
  code exists.
- **R5** — no plaintext secrets in any variant; type system enforces.

## Related

- [capability-registry.md](./capability-registry.md) — H5 gate
- [secret-provider.md](./secret-provider.md) — H4 provider (audit opt-in)
- `ai-docs/plan-enterprise-edition.md` §3 H6 — strategic plan
