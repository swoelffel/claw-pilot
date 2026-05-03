# Screen — Triggers (`cp-triggers-view`)

> **Source**: `ui/src/components/triggers/cp-triggers-view.ts` (+ `cp-trigger-list`, `cp-trigger-wizard`, `cp-trigger-detail`, `cp-input-mapping-editor`)
> **Route**: `#/instances/:slug/triggers`
> **Entry point**: Instance card menu — "Triggers" item (`btn-triggers`)

Per-instance panel to list, create, run, and inspect cron and webhook triggers attached to the instance's flows. Wraps the instance with the budget alert banner like other instance routes. See [`docs/architecture/flow-triggers.md`](../architecture/flow-triggers.md) for backend depth.

## Mockup — list

```
+-- Header -------------------------------------------------------+
|  Triggers                                       [+ New trigger] |
+-----------------------------------------------------------------+

+-- Trigger list (cp-trigger-list) -------------------------------+
| [cron]    daily-summary                          [ON ]          |
|           my-instance -> flow #12 . last fired 2026-05-02 09:00 |
|                                  [Disable] [Fire] [Detail] [Delete] |
| ---                                                             |
| [webhook] sentry-incoming                        [OFF]          |
|           my-instance -> flow #18                               |
|                                  [Enable]  [Fire] [Detail] [Delete] |
+-----------------------------------------------------------------+
```

Empty state: `<p>No triggers yet.</p>` (i18n id `trigger-list-empty`).

## Mockup — wizard (3 steps)

```
+-- Step 1: Pick kind --------------------------------+
|  o  o  o                                            |
|  +-----------+ +------------+                       |
|  | Cron      | | Webhook    |                       |
|  | Periodic  | | HMAC HTTP  |                       |
|  +-----------+ +------------+                       |
|  [Cancel]                            [Next]         |
+-----------------------------------------------------+

+-- Step 2: Instance + flow + owner ------------------+
|  o  o  o                                            |
|  Instance slug   [my-instance              ]        |
|  Flow ID         [12                       ]        |
|  Owner user ID   [optional                 ]        |
|  [Cancel]              [Back]        [Next]         |
+-----------------------------------------------------+

+-- Step 3: Params + mapping + name + flags ----------+
|  o  o  o                                            |
|  Trigger name      [daily-summary           ]       |
|  -- if cron --                                       |
|  Cron expression   [0 9 * * *               ]       |
|  Timezone          [Europe/Paris            ]       |
|  -- if webhook --                                    |
|  Webhook slug      [sentry-incoming         ]       |
|  Shared secret     [...                     ]       |
|  Input mapping (cp-input-mapping-editor)            |
|     $.path.field  ->  flow_var                      |
|     [+ Add mapping]                                  |
|  [x] Enabled       [ ] Allow concurrent              |
|  [Cancel]              [Back]        [Create]       |
+-----------------------------------------------------+
```

## Mockup — detail drawer (right, 560px max)

```
+-- header -----------------------------------+
| daily-summary                       [Close] |
+--- tabs ------------------------------------+
| [Settings] [Runs] [Test]                    |
+---------------------------------------------+
| Settings: name / kind / instance / flow /   |
|           enabled / cron|webhook / lastFired|
| Runs    : table (fired_at, status, run, err)|
|           [Refresh]                          |
| Test    : [Fire now]                         |
|           Webhook only:                      |
|             Reveal secret / Rotate            |
|             curl example block               |
+---------------------------------------------+
```

## States

| State | Trigger | Display |
|---|---|---|
| **Loading** | Mount | List empty until `listTriggers` resolves |
| **Empty** | `_triggers.length === 0` | "No triggers yet." inside the list |
| **Populated** | API returned ≥ 1 row | Grid rows in `cp-trigger-list` |
| **Wizard open** | `_showWizard === true` | Modal overlay with 3 steps |
| **Detail open** | `_detailId !== null` | Right-side drawer over the page |
| **Error** | API rejection | Error banner above the list (resolved via `userMessage`) |

## Wizard validation rules

- Step 1: must pick `cron` or `webhook` before "Next" is enabled.
- Step 3 "Create": requires `_name` non-empty.
- Cron defaults: `0 9 * * *` / `Europe/Paris`. Free-form text — server validates and rejects bad expressions.
- Webhook: `slug` lower-kebab (`a-z 0-9 -`), `secret` shared with caller for HMAC.
- Mapping: optional. Each row is a JSONPath `from` ➜ flow variable name `to`.
- `Allow concurrent` defaults off — server queues subsequent fires while one run is in flight.

## Detail drawer behavior

- Loads `getTrigger(slug, id)` on mount; tabs share that one fetch (Runs hydrated from `_detail.runs`).
- "Fire now" calls `fireTrigger`; result toast lives in `_rotateMessage`.
- Webhook tab actions:
  - **Reveal once** — `revealTriggerSecret` (server allows a one-shot reveal window).
  - **Rotate** — `rotateTriggerSecret`; new value displayed once with the warning "Copy it now — it will not be shown again."
  - The `pre` block defaults to `********` (32 stars) when no secret revealed.
- curl example always uses `${origin}/webhooks/triggers/${instanceSlug}/${webhookSlug}` and an `X-ClawPilot-Signature: sha256=<hex>` header placeholder.

## API surface

| Endpoint | Used by |
|---|---|
| `GET /api/instances/:slug/triggers` | `cp-triggers-view` mount |
| `POST /api/instances/:slug/triggers` | Wizard "Create" |
| `PATCH /api/instances/:slug/triggers/:id` | Enable/disable toggle |
| `DELETE /api/instances/:slug/triggers/:id` | Delete row |
| `POST /api/instances/:slug/triggers/:id/fire` | "Fire" button + Detail "Fire now" |
| `GET /api/instances/:slug/triggers/:id` | Detail drawer mount |
| `GET /api/instances/:slug/triggers/:id/runs?limit=N` | Detail "Runs" refresh |
| `POST /api/instances/:slug/triggers/:id/secret/reveal` | Webhook "Reveal once" |
| `POST /api/instances/:slug/triggers/:id/secret/rotate` | Webhook "Rotate" |
| `POST /webhooks/triggers/:instanceSlug/:slug` | Public webhook endpoint (HMAC-signed) |

## Cross-references

- Instance card: "Triggers" menu item navigates here (added in PR #175).
- Instance Dashboard: "Flows" widget renders a `Triggers →` shortcut to this screen (added in PR #174).
- Component docs: [comp-triggers-view.md](../ux-components/comp-triggers-view.md), [comp-trigger-list.md](../ux-components/comp-trigger-list.md), [comp-trigger-wizard.md](../ux-components/comp-trigger-wizard.md), [comp-trigger-detail.md](../ux-components/comp-trigger-detail.md), [comp-input-mapping-editor.md](../ux-components/comp-input-mapping-editor.md).

---

*Since v0.81.0 (TRIGGER-001a/b)*
