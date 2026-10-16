# Flow Triggers (TRIGGER-001)

Flow Triggers turn ClawPilot from a reactive orchestrator into a programmable
automation platform. A trigger fires a flow run on a schedule (cron) or upon a
signed external HTTP call (webhook).

## Architecture

```
            +-----------------------+
  cron tick |  TriggerScheduler     |       +----------------+
  --------> |  (croner, in-process) |  ---> |  flow runtime  |
            +-----------------------+       +----------------+
                       ^                          ^
                       | reload(id)               | runtime starter (HTTP)
                       |                          |
+-----------------------------------+   +-----------------------------------+
|  CRUD routes                      |   |  Webhook route                    |
|  /api/instances/:slug/triggers/*  |   |  /webhooks/triggers/:slug/:hook   |
|  (Hono, dashboard auth)           |   |  (HMAC + IP allowlist)            |
+-----------------------------------+   +-----------------------------------+
                       ^                          ^
                       |                          |
            +-----------------------+   +-----------------------+
            |  cp-triggers-view UI  |   |  External system       |
            |  (Lit web components) |   |  (GitHub, Stripe, …)  |
            +-----------------------+   +-----------------------+
```

## Scoping

Triggers are **instance-scoped resources** — every CRUD route is mounted under
`/api/instances/:slug/triggers/*` and the public webhook URL carries the
owning instance as its first path segment
(`POST /webhooks/triggers/:instanceSlug/:webhookSlug`). This brings triggers
in line with every other workspace resource (agents, flows, tasks, …) and
unlocks per-instance permissions, per-instance quotas, and clean multi-tenant
URLs without leaking cross-tenant existence (a trigger fetched from a foreign
instance scope returns 404, not 200 nor 403).

Uniqueness on `webhook_slug` is consequently scoped to `instance_slug`: two
different instances may register the same `webhook_slug` (`gh-pr-opened`,
`stripe-payment-succeeded`, …) without collision. The DB-level guarantee is
the partial UNIQUE INDEX
`(instance_slug, webhook_slug) WHERE webhook_slug IS NOT NULL` shipped by
migration v41.

## Tables

The base tables ship with the v40 migration; v41 rebuilds `rt_flow_triggers`
to scope `webhook_slug` uniqueness to `(instance_slug, webhook_slug)`. Both
tables carry an `org_id NULL` slot in line with R2.

- `rt_flow_triggers` — one row per trigger (cron or webhook), holds the
  schedule expression, webhook slug, optional input mapping and ip allowlist.
- `rt_flow_trigger_runs` — execution history; doubles as the concurrency lock
  via the `(trigger_id, status)` partial index over `('pending','running')`.

See [`docs/registry-db.md`](../registry-db.md) for column-level details.

## Routes

### Public webhook
| Method | Path                                            | Auth     |
|--------|-------------------------------------------------|----------|
| POST   | `/webhooks/triggers/:instanceSlug/:slug`        | HMAC-SHA256 + optional IP allowlist |

### Dashboard CRUD (under `/api/instances/:slug/triggers/*`)
| Method | Path                                                     | Permission action          |
|--------|----------------------------------------------------------|----------------------------|
| GET    | `/api/instances/:slug/triggers`                          | `trigger.list`             |
| POST   | `/api/instances/:slug/triggers`                          | `trigger.create`           |
| GET    | `/api/instances/:slug/triggers/:id`                      | `trigger.read`             |
| PUT    | `/api/instances/:slug/triggers/:id`                      | `trigger.update`           |
| DELETE | `/api/instances/:slug/triggers/:id`                      | `trigger.delete`           |
| POST   | `/api/instances/:slug/triggers/:id/fire`                 | `trigger.fire`             |
| POST   | `/api/instances/:slug/triggers/:id/rotate-secret`        | `trigger.rotate-secret`    |
| POST   | `/api/instances/:slug/triggers/:id/revoke-secret`          | `trigger.revoke-secret`    |
| GET    | `/api/instances/:slug/triggers/:id/secret-reveal`        | `trigger.reveal-secret`    |
| GET    | `/api/instances/:slug/triggers/:id/runs`                 | `trigger.runs-list`        |

The CRUD routes call `deps.triggerScheduler.reload(id)` after every mutation
so the running scheduler picks up new/changed/disabled cron rows in place.
The webhook endpoint never modifies the schedule — it just fires a flow.

Cross-instance access on any of the `:id` routes returns 404 (existence is
not exposed across scopes).

## Webhook protocol

New dashboard-created webhooks use signature version 2. Existing rows retain version 1, preserving their `X-ClawPilot-Signature: sha256=<hex>` over the raw body.

For version 2, POST a UTF-8 JSON body of at most 64 KiB with:

- `X-ClawPilot-Timestamp`: Unix seconds, at most five minutes from server time.
- `Idempotency-Key`: 1–128 visible ASCII characters, identifying the event.
- `X-ClawPilot-Signature: v2=<hex>`: HMAC-SHA256 of `<timestamp>.<idempotency-key>.<raw body>` with the shared secret.

Sign the exact transmitted JSON text. Re-sign delivery retries with a fresh timestamp and the same event key and body. A valid duplicate within 24 hours returns HTTP 200 with the original admission; a conflicting body under the same key returns 409. Legacy requests without an event key deduplicate identical bodies over five minutes. HTTP 202 means admitted, not completed; inspect the linked flow run. Invalid signature or stale timestamp returns 401; a revoked webhook, disallowed IP or unapproved workflow returns 403; concurrency conflict returns 409; oversized input returns 413; rate limit returns 429. A disabled webhook returns 503.

Admission rechecks current configuration after secret reads, then reserves under a SQLite writer transaction. Flow/instance association and unattended workflow governance apply to both cron and webhooks. No automatic delivery retry is performed by ClawPilot.

## Secret handling (R5)

The creator supplies the initial secret. Storage uses SecretProvider with a random reference independent of instance and mutable slug. Creation returns metadata only. A failed duplicate creation cannot change the original secret. Schema v58 adds the signature version and revocation timestamp without rewriting existing secrets.

Administrators with dedicated permissions can reveal, rotate or revoke. `trigger.create` and other management actions do not grant these permissions. Rotation creates a new reference and random secret, returns its value, and clears revocation. Existing shared legacy references are never erased while another trigger uses them.

Revocation persists an admission gate immediately. Re-enabling does not undo it; rotation is required to restore access. Already-admitted runs continue. Concurrent reads and rotations detect revocation before returning or publishing a new value. Reveal is rate-limited and audited as `secret.access`; rotation and revocation emit `trigger.secret_mutation` with actor identity, never plaintext. The default environment provider serializes writes within the dashboard process and atomically replaces its file; operate one management writer per state directory.

## Runtime and recovery

The daemon links the trigger admission to its flow run transactionally before building the first briefing. Repeated internal admission returns the existing flow run. The runtime registers its own trigger context provider, exposing `{{trigger.payload.field}}` and `{{trigger.mapped.variable}}` independently of dashboard memory.

Concurrency remains locked while the flow is pending/running. Terminal status updates release the lock. IPC errors preserve unconfirmed reservations because the daemon may already have accepted them. Unlinked pending admissions expire after five minutes; inspect history before resending with a new event key. On daemon startup, interrupted linked trigger flows are marked failed without replay, releasing their locks. This assumes one daemon per instance.

## Reverse proxy and IP restrictions

Forwarding headers are ignored by default. Set `CLAW_PILOT_TRUSTED_PROXY_IPS` to the comma-separated transport peer addresses explicitly trusted to sanitize forwarding headers (for example the local reverse proxy). The address chain is evaluated from the trusted end. Restrict direct dashboard-port access; configuring a trusted proxy does not establish the network boundary by itself. Invalid allowlist configuration is rejected or fails closed. The application limits known endpoints to 60 requests per minute per instance/slug; apply proxy-level traffic controls for broader ingress protection.

## Scheduler

`TriggerScheduler` (`src/runtime/triggers/scheduler.ts`) is owned by the
dashboard server. It loads every `kind='cron' AND enabled=1` row at boot,
creates a `croner.Cron` per row, and on each tick:

1. Re-reads the row defensively (handles stale references after `reload`).
2. Honours the per-trigger concurrency lock unless `allow_concurrent`.
3. Inserts a `rt_flow_trigger_runs` row in `pending`.
4. Awaits `runtimeStarter()`; admission remains `running` until the linked flow terminates.

Hot reload is invoked from the CRUD routes through the optional
`triggerScheduler` field on `RouteDeps`.

## Discipline gates

| Rule | Status |
|------|--------|
| R1   | No enterprise flag — Community uses `NullPermissionChecker`; route handlers pass `action` strings only. |
| R2   | New tables already present at schema v40 with `org_id NULL`; v41 preserves the slot. |
| R3   | Frozen path touches: `src/dashboard/server.ts`, `src/dashboard/route-deps.ts`, `src/dashboard/middleware/permission-actions.ts`, `src/db/schema.ts`. Each carries an `Extension-Point:` trailer in the commit message. |
| R5   | Plaintext only on the input boundary (`POST /api/instances/:slug/triggers` body), the rotate endpoint output, and the reveal endpoint output. Storage exclusively via `secretProvider.set/get`. |

## UI

The Lit page lives at `ui/src/components/triggers/cp-triggers-view.ts` and
groups four supporting components:

- `cp-trigger-list` — row cards with kind badge, enabled toggle, fire/edit/delete actions.
- `cp-trigger-wizard` — 3-step modal (kind → flow + creator attribution → params + mapping + name).
- `cp-trigger-detail` — drawer with three tabs (Settings, Runs, Test).
- `cp-input-mapping-editor` — array editor for `{ from: <JSONPath>, to: <flowVar> }` rows.

Hash route is `#/instances/:slug/triggers`. The page is registered in
`ui/src/services/router.ts` and reachable from the instance dashboard.
