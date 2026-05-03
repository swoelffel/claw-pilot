# Component — Trigger wizard (`cp-trigger-wizard`)

> **Source**: `ui/src/components/triggers/cp-trigger-wizard.ts`
> **Used by**: `cp-triggers-view`
> **Screen**: [screen-triggers.md](../ux-screens/screen-triggers.md)

3-step modal wizard to create a new trigger on an instance flow.

## Properties

| Property | Type | Description |
|---|---|---|
| `instanceSlug` | `string` | Instance the trigger belongs to (passed by parent, not user-editable) |
| `currentUsername` | `string` | Optional username to display in the read-only owner row |

## Events

| Event | Detail | When |
|---|---|---|
| `created` | `FlowTrigger` | Trigger successfully created |
| `cancelled` | `void` | User cancelled the wizard |

## Steps

### Step 1 — Pick kind
Two cards: **Cron** (selectable) and **Webhook** (disabled with a "Coming soon" pill,
`aria-disabled="true"`, `pointer-events: none`, opacity 0.5, tooltip
"Webhook triggers will land in a future release — use Cron for now.").
Webhook is intentionally deferred until secret/HMAC UX is ready.

### Step 2 — Flow + owner
- **Flow** — dropdown sourced from `GET /api/instances/:slug/flows`, sorted by name,
  showing `name (#id)`. Disabled flows are greyed with a `(disabled)` suffix and the
  `<option>` is not selectable. Empty state shows an inline link to `#/instances/:slug/flows`.
- **Owner** — auto-bound to the current session user (read-only line "Owner: {username} (you)").
  No multi-user picker in v1: the backend already falls back to the current user when
  `ownerUserId` is omitted from the create payload.

### Step 3 — Schedule + name + flags (cron)
- **Trigger name** — required, free text.
- **Schedule** — delegates to [`cp-cron-picker`](comp-cron-picker.md), which exposes a
  mode switcher between visual "Set Interval" and raw "Cron Expression".
- **Timezone** — IANA string, default `Europe/Paris`.
- **Live preview** — human-readable summary + compiled cron expression, recomputed on
  every `change` event from the picker.
- **Enabled** (default on) and **Allow concurrent** (default off) checkboxes.

The webhook branch in step 3 is unreachable while step 1 forces cron, but the markup is
preserved so it lights up automatically once webhook is re-enabled (the existing
`cp-input-mapping-editor` is still wired in).

## Validation

- Step 1 → Next: requires `_kind === "cron"`.
- Step 2 → Next: requires a flow selection.
- Step 3 → Create: requires non-empty `name` and a flow selection. Cron validation
  is delegated to the picker (croner paused dry-run).

## Submission

The wizard always posts the **compiled cron expression** to
`POST /api/instances/:slug/triggers` — never the structured "Set Interval" payload.
The backend stores a single canonical `cronExpr`, so both modes converge.
