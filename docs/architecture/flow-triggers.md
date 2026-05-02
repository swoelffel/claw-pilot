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
+---------------------------+       +-----------------------+
|  CRUD routes              |       |  Webhook route        |
|  /api/triggers/*          |       |  /webhooks/triggers/  |
|  (Hono, dashboard auth)   |       |  (HMAC + IP allowlist)|
+---------------------------+       +-----------------------+
                       ^                          ^
                       |                          |
            +-----------------------+   +-----------------------+
            |  cp-triggers-view UI  |   |  External system       |
            |  (Lit web components) |   |  (GitHub, Stripe, …)  |
            +-----------------------+   +-----------------------+
```

## Tables

Both tables ship with the v40 migration (PR 1/3) and carry an `org_id NULL`
slot in line with R2.

- `rt_flow_triggers` — one row per trigger (cron or webhook), holds the
  schedule expression, webhook slug, optional input mapping and ip allowlist.
- `rt_flow_trigger_runs` — execution history; doubles as the concurrency lock
  via the `(trigger_id, status)` partial index over `('pending','running')`.

See [`docs/registry-db.md`](../registry-db.md) for column-level details.

## Routes

### Public webhook
| Method | Path                            | Auth     |
|--------|---------------------------------|----------|
| POST   | `/webhooks/triggers/:slug`      | HMAC-SHA256 + optional IP allowlist |

### Dashboard CRUD (under `/api/triggers/*`)
| Method | Path                                       | Permission action          |
|--------|--------------------------------------------|----------------------------|
| GET    | `/api/triggers`                            | `trigger.list`             |
| POST   | `/api/triggers`                            | `trigger.create`           |
| GET    | `/api/triggers/:id`                        | `trigger.read`             |
| PUT    | `/api/triggers/:id`                        | `trigger.update`           |
| DELETE | `/api/triggers/:id`                        | `trigger.delete`           |
| POST   | `/api/triggers/:id/fire`                   | `trigger.fire`             |
| POST   | `/api/triggers/:id/rotate-secret`          | `trigger.rotate-secret`    |
| GET    | `/api/triggers/:id/secret-reveal`          | `trigger.reveal-secret`    |
| GET    | `/api/triggers/:id/runs`                   | `trigger.runs-list`        |

The CRUD routes call `deps.triggerScheduler.reload(id)` after every mutation
so the running scheduler picks up new/changed/disabled cron rows in place.
The webhook endpoint never modifies the schedule — it just fires a flow.

## Secret handling (R5)

Webhook HMAC secrets are stored exclusively through the `SecretProvider`
contract under the key `TRIGGER_WEBHOOK_SECRET:<webhook_slug>`. Three flows
touch the plaintext:

1. **Create** — the user supplies the plaintext on `POST /api/triggers`; the
   route persists it via `secretProvider.set()` and the row keeps only the
   `webhook_secret_ref` key, never the plaintext.
2. **Rotate** — `POST /api/triggers/:id/rotate-secret` generates 32 random
   bytes, persists, and returns the plaintext **once**.
3. **Reveal** — `GET /api/triggers/:id/secret-reveal` re-reads the secret from
   the provider, emits a `secret.access` audit event, and returns the
   plaintext. Rate-limited to 3 reveals per minute per IP (in-memory).

No code path stores the plaintext anywhere outside the provider.

## Scheduler

`TriggerScheduler` (`src/runtime/triggers/scheduler.ts`) is owned by the
dashboard server. It loads every `kind='cron' AND enabled=1` row at boot,
creates a `croner.Cron` per row, and on each tick:

1. Re-reads the row defensively (handles stale references after `reload`).
2. Honours the per-trigger concurrency lock unless `allow_concurrent`.
3. Inserts a `rt_flow_trigger_runs` row in `pending`.
4. Awaits `runtimeStarter()` and updates the run status to `succeeded` or
   `failed` accordingly.

Hot reload is invoked from the CRUD routes through the optional
`triggerScheduler` field on `RouteDeps`.

## Discipline gates

| Rule | Status |
|------|--------|
| R1   | No enterprise flag — Community uses `NullPermissionChecker`; route handlers pass `action` strings only. |
| R2   | New tables already present at schema v40 with `org_id NULL`. |
| R3   | Frozen path touches: `src/dashboard/server.ts`, `src/dashboard/route-deps.ts`, `src/dashboard/middleware/permission-actions.ts`. Each carries an `Extension-Point:` trailer in the commit message. |
| R5   | Plaintext only on the input boundary (`POST /api/triggers` body), the rotate endpoint output, and the reveal endpoint output. Storage exclusively via `secretProvider.set/get`. |

## UI

The Lit page lives at `ui/src/components/triggers/cp-triggers-view.ts` and
groups four supporting components:

- `cp-trigger-list` — row cards with kind badge, enabled toggle, fire/edit/delete actions.
- `cp-trigger-wizard` — 3-step modal (kind → flow + owner → params + mapping + name).
- `cp-trigger-detail` — drawer with three tabs (Settings, Runs, Test).
- `cp-input-mapping-editor` — array editor for `{ from: <JSONPath>, to: <flowVar> }` rows.

Hash route is `#/triggers`. The page is registered in
`ui/src/services/router.ts` and reachable via the main nav.
