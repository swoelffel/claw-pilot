# Component — Trigger Detail (`cp-trigger-detail`)

> **Source**: `ui/src/components/triggers/cp-trigger-detail.ts`
> **Used in**: `cp-triggers-view` (mounted when a row is opened)

Right-side drawer (`width: min(560px, 100vw)`, full viewport height, `border-left`) with three tabs: **Settings**, **Runs**, **Test**. Loads the trigger detail (`getTrigger`) on mount.

## Mockup

```
+-- header --------------------------- [Close] +
| <name>                                       |
+-- tabs --------------------------------------+
| [Settings]  [Runs]  [Test]                    |
+-- body --------------------------------------+
| (per-tab content)                             |
+----------------------------------------------+
```

## Props

| Property | Type | Description |
|---|---|---|
| `instanceSlug` | `string` | Used in every API call below. |
| `triggerId` | `number` | Required. |

## Tabs

### Settings

Read-only key/value rows from `FlowTriggerDetail`:

- Name, Kind, Instance, Flow, Enabled (`yes/no`), Last fired.
- If cron: cron expression + timezone.
- If webhook: webhook slug.

### Runs

Table of recent fires (`fired_at`, `status` colored badge, `flow_run_id`, `error`).

| Status | Badge tint |
|---|---|
| `succeeded` | `--state-success` |
| `failed` | `--state-error` |
| `running` | `--accent` |

`[Refresh]` button calls `listTriggerRuns(slug, id, { limit: 50 })`. Empty list shows "No runs yet".

### Test

- **Fire now** — primary button, `fireTrigger(slug, id)`. Toast message "Fire requested" on success (lives in `_rotateMessage` field — same channel as rotate confirmation).
- **Webhook secret** (webhook only):
  - **Reveal once** — `revealTriggerSecret`; payload printed in a `pre`. Server-side enforces "one-shot" semantics.
  - **Rotate** — `rotateTriggerSecret`; replaces the displayed secret with the warning "Secret rotated. Copy it now — it will not be shown again."
  - Default placeholder: 32 `*` characters.
- **curl example** (webhook only): one-line `pre` block of the form
  ```
  curl -X POST -H 'X-ClawPilot-Signature: sha256=<hex>' \
       -H 'Content-Type: application/json' \
       --data-raw '{}' \
       <origin>/webhooks/triggers/<instanceSlug>/<webhookSlug>
  ```

## State

| Field | Purpose |
|---|---|
| `_detail` | `FlowTriggerDetail` from initial fetch |
| `_runs` | Hydrated from `_detail.runs`, replaced by Refresh |
| `_tab` | `"settings" \| "runs" \| "test"` (default `settings`) |
| `_revealedSecret` | Set by reveal/rotate; never persisted |
| `_rotateMessage` | Confirmation banner shown on Test tab |
| `_error`, `_busy` | UX guards |

## Events emitted

| Event | When |
|---|---|
| `close` | "Close" button — parent unmounts the drawer |

## API

`getTrigger`, `listTriggerRuns`, `fireTrigger`, `revealTriggerSecret`, `rotateTriggerSecret` (all from `ui/src/api.ts`).

## Accessibility

The drawer has no internal focus trap today — focus stays in the document. Future improvement candidate.

## Related

- Parent: [comp-triggers-view.md](comp-triggers-view.md)

---

*Since v0.81.0 (TRIGGER-001a)*
