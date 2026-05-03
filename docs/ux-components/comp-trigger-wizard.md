# Component — Trigger Wizard (`cp-trigger-wizard`)

> **Source**: `ui/src/components/triggers/cp-trigger-wizard.ts`
> **Used in**: `cp-triggers-view` (mounted when "New trigger" is clicked)

Modal 3-step wizard to create a new trigger. Renders as a fixed-position overlay (`rgba(0,0,0,0.4)` backdrop) with a centered panel (`max-width: 560px`).

## Mockup

```
+-- panel ----------------------------------+
| New trigger                                |
| [==] [  ] [  ]                             |  <- step indicator
| (current step body)                        |
| [Cancel]            [Back] [Next | Create] |
+--------------------------------------------+
```

## Props

| Property | Type | Description |
|---|---|---|
| `instanceSlug` | `string` | Pre-fills the step-2 instance slug field on mount. |

## Internal state

| Field | Default | Notes |
|---|---|---|
| `_step` | `1` | 1, 2, or 3 |
| `_kind` | `""` | `"cron" \| "webhook" \| ""` (empty = not chosen) |
| `_instanceSlug` | from prop | Editable in step 2 |
| `_flowId` | `""` | Number entered as text |
| `_ownerUserId` | `""` | Optional, falls back to current user server-side |
| `_name` | `""` | Required for "Create" |
| `_enabled` | `true` | Step 3 checkbox |
| `_allowConcurrent` | `false` | Step 3 checkbox |
| `_cronExpr` | `"0 9 * * *"` | Step 3 (cron) |
| `_cronTz` | `"Europe/Paris"` | Step 3 (cron) |
| `_webhookSlug` | `""` | Step 3 (webhook) |
| `_webhookSecret` | `""` | Step 3 (webhook) |
| `_mapping` | `[]` | Edited via `cp-input-mapping-editor` |
| `_saving`, `_error` | — | UX guards |

## Steps

### Step 1 — Pick kind

Two `.kind-card` tiles in a 2-col grid:

- **Cron** — "Periodic schedule (e.g. 09:00 every day)".
- **Webhook** — "HMAC-signed external HTTP call".

Selected card gets `--accent` border. "Next" is disabled while `_kind === ""`.

### Step 2 — Target

Three text inputs: instance slug, flow id (number), owner user id (optional).

### Step 3 — Params + flags

- Trigger name (required for the final "Create" button).
- If cron: cron expression + timezone (free-text).
- If webhook: webhook slug (`a-z 0-9 -`) + shared secret.
- Input mapping editor (`cp-input-mapping-editor`).
- Two checkboxes: Enabled (default on), Allow concurrent runs (default off).

## Validation

| Step | Rule |
|---|---|
| 1 | Must pick a kind before "Next". |
| 2 | No client-side validation — server returns 4xx if invalid. |
| 3 | "Create" disabled while `_saving` or `!_name`. |

Server errors bubble up into the `.error-banner` slot.

## Events emitted

| Event | Detail | When |
|---|---|---|
| `created` | `FlowTrigger` | After `createTrigger(slug, input)` resolves |
| `cancelled` | — | "Cancel" button or backdrop close |

## API

`createTrigger(instanceSlug, CreateTriggerInput)` from `ui/src/api.ts`.

## Notes

- The panel has `@click stopPropagation` so backdrop clicks bubble through `_close()`.
- Step indicator: 3 small horizontal pills, active ones tinted `--accent`.
- The wizard does not currently fetch the flow list — flow id is typed manually. Future improvement candidate.

## Related

- Mapping sub-editor: [comp-input-mapping-editor.md](comp-input-mapping-editor.md)
- Parent: [comp-triggers-view.md](comp-triggers-view.md)

---

*Since v0.81.0 (TRIGGER-001a)*
