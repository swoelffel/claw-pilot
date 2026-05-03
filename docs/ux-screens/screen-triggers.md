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

### Step 1 — Pick kind

Webhook is intentionally disabled in v1 (TRIGGER-001b ships cron only end-to-end; webhook public path exists but secret/HMAC UX is deferred). Only **Cron** is selectable.

```
+-- Step 1: Pick kind --------------------------------+
|  o  o  o                                            |
|  +-----------+ +-----------------------+            |
|  | Cron      | | Webhook               |            |
|  | Periodic  | | HMAC HTTP             |            |
|  |           | | [coming soon]         |  (dimmed)  |
|  +-----------+ +-----------------------+            |
|  [Cancel]                            [Next]         |
+-----------------------------------------------------+
```

Webhook card: `aria-disabled="true"`, `pointer-events: none`, opacity 0.5, "Coming soon" pill (`--state-info` background, white text). Tooltip on hover: "Webhook triggers will land in a future release — use Cron for now."

### Step 2 — Flow + owner

Instance slug is dropped — the wizard is mounted with `instanceSlug` already known from the route. Flow becomes a dropdown populated from `GET /api/instances/:slug/flows`. Owner is auto-bound to the current session user when the instance has a single user; dropdown otherwise.

```
+-- Step 2: Flow + owner -----------------------------+
|  o  o  o                                            |
|  Flow             [ daily-summary (#12)      ▾ ]    |
|  Owner            [ admin (you)              ▾ ]    |
|                   (hidden when only 1 user exists)  |
|  [Cancel]              [Back]        [Next]         |
+-----------------------------------------------------+
```

Flow dropdown: shows `name (#id)`, sorted by name, disabled flows greyed with `(disabled)` suffix. Empty state: "This instance has no flows yet — create one first" with a link to `#/instances/:slug/flows`.

Owner dropdown:
- Single-user instance → field hidden, owner auto-bound to current user, shown as a read-only line "Owner: admin (you)".
- Multi-user instance → dropdown listing users; default selection is the current session user.

### Step 3 — Schedule + name + flags (cron kind)

Mode switcher at the top selects between **Set Interval** (visual, default) and **Cron Expression** (raw text).

```
+-- Step 3: Schedule ---------------------------------+
|  o  o  o                                            |
|  Trigger name      [ daily-summary           ]      |
|                                                     |
|  Schedule:  ( ) Set Interval   ( ) Cron Expression  |
|                                                     |
|  ... (body — see below per mode and per interval)   |
|                                                     |
|  Timezone          [ Europe/Paris            ▾ ]    |
|                                                     |
|  Preview:  Runs every day at 09:00 Europe/Paris     |
|            cron: 0 9 * * *                          |
|                                                     |
|  [x] Enabled         [ ] Allow concurrent           |
|  [Cancel]              [Back]        [Create]       |
+-----------------------------------------------------+
```

#### Step 3 — body — Set Interval mode

The body switches based on the selected interval unit. The "Repeat Every" line is always shown.

```
Repeat Every  [ 1 ▾ ]  [ Day(s) ▾ ]
                       Minute(s) | Hour(s) | Day(s) | Week(s) | Month(s)
```

##### Set Interval — Minute(s)

```
+-- body ---------------------------------------------+
|  Repeat Every  [ 5 ▾ ]  [ Minute(s) ▾ ]             |
|                                                     |
|  (no further input — runs every N minutes)          |
+-----------------------------------------------------+
```

##### Set Interval — Hour(s)

```
+-- body ---------------------------------------------+
|  Repeat Every  [ 2 ▾ ]  [ Hour(s) ▾ ]               |
|                                                     |
|  At minute     [ :00 ▾ ]   (0..59)                  |
+-----------------------------------------------------+
```

##### Set Interval — Day(s)

```
+-- body ---------------------------------------------+
|  Repeat Every  [ 1 ▾ ]  [ Day(s) ▾ ]                |
|                                                     |
|  Execute at    [ 09 ]:[ 00 ]                        |
+-----------------------------------------------------+
```

##### Set Interval — Week(s)

`Repeat Every N` is locked to **1** in v1 because standard cron cannot express "every N weeks" exactly (no week-of-year modulo). The field stays visible but disabled, with a tooltip explaining the limitation. Multi-day selection is supported via chips.

```
+-- body ---------------------------------------------+
|  Repeat Every  [ 1 ▴ ]  [ Week(s) ▾ ]   (locked)    |
|                                                     |
|  Execute every week on:                             |
|  [ Mon ] [ Tue ] [ Wed ] [ Thu ] [ Fri ] [ Sat ] [ Sun ] |
|     ^^^                                             |
|     selected (accent fill)                          |
|                                                     |
|  Execute at    [ 09 ]:[ 00 ]                        |
+-----------------------------------------------------+
```

Day chips: multi-select toggle, accent fill when active, default = Mon. At least one day must be selected (validation on Create).

##### Set Interval — Month(s)

```
+-- body ---------------------------------------------+
|  Repeat Every  [ 1 ▾ ]  [ Month(s) ▾ ]              |
|                                                     |
|  Execute every month on:                            |
|  [ 1] [ 2] [ 3] [ 4] [ 5] [ 6] [ 7]                 |
|  [ 8] [ 9] [10] [11] [12] [13] [14]                 |
|  [15] [16] [17] [18] [19] [20] [21]                 |
|  [22] [23] [24] [25] [26] [27] [28]                 |
|  [29] [30] [31]                                     |
|                                                     |
|  Execute at    [ 09 ]:[ 00 ]                        |
+-----------------------------------------------------+
```

Day-of-month grid: 7-column calendar-style chips, multi-select. Days 29/30/31 visually flagged "may skip in shorter months". At least one day must be selected.

#### Step 3 — body — Cron Expression mode

```
+-- body ---------------------------------------------+
|  Cron expression   [ 0 9 * * *              ]       |
|                                                     |
|  Status: valid                                      |
|  Next 3 runs:                                       |
|    2026-05-04 09:00:00 Europe/Paris                 |
|    2026-05-05 09:00:00 Europe/Paris                 |
|    2026-05-06 09:00:00 Europe/Paris                 |
+-----------------------------------------------------+
```

Validation via `croner` paused dry-run; invalid expressions surface a red banner under the input ("Invalid cron expression: <reason>"). Next-3-runs preview computed client-side using `croner`.

#### Step 3 — body — Webhook kind (deferred)

While webhook is disabled at Step 1, the wizard never reaches this branch. The component still ships the webhook fields so they light up automatically when the kind is re-enabled.

```
+-- body (webhook — currently unreachable) -----------+
|  Webhook slug      [ sentry-incoming        ]       |
|  Shared secret     [ ********               ]       |
|  Input mapping (cp-input-mapping-editor)            |
|     $.path.field  ->  flow_var                      |
|     [+ Add mapping]                                  |
+-----------------------------------------------------+
```

### Common to Step 3

- `Trigger name` — required, kebab-case suggestion, validated non-empty.
- `Timezone` — IANA list, default = user's profile timezone (fallback `Europe/Paris`).
- `Enabled` — defaults checked. Unchecked triggers are created but not scheduled.
- `Allow concurrent` — defaults unchecked. When unchecked, the scheduler skips a fire if the prior run is still in flight.
- `Preview` — auto-recomputed on every change. Shows human-readable string + compiled cron expression. Both modes converge to the same cron string before submission.

### Cron compilation rules (Set Interval → cron)

| Interval | Cron expression |
|---|---|
| Every N minute(s) | `*/N * * * *` |
| Every N hour(s) at minute :MM | `MM */N * * *` |
| Every N day(s) at HH:MM | `MM HH */N * *` (N=1 yields `MM HH * * *`) |
| Every week on `<chips>` at HH:MM | `MM HH * * <DOW-csv>` (DOW: 1=Mon..7=Sun, locked to N=1) |
| Every N month(s) on `<days>` at HH:MM | `MM HH <DOM-csv> */N *` |

The wizard always sends the compiled cron expression on POST — the backend receives a single canonical `cronExpr`, never the structured "set interval" payload.

### Skipped in v1 (flagged as TRIGGER-001c follow-up)

- **Once mode** (run a single time at a specific date+time) — requires backend support for one-shot triggers (no cron-friendly mapping).
- **End condition** ("Never / On <date> / After N occurrences") — requires migration to add `ends_at` / `max_runs` columns + scheduler enforcement.
- **Every N week** with N > 1 — standard cron cannot express it; would need a custom modulo guard in the scheduler.

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

- Step 1: only `cron` is selectable in v1 — Webhook card is `aria-disabled` and the "Next" button is enabled as soon as Cron is picked.
- Step 2: `flowId` must resolve in the instance's flow list; `ownerUserId` defaults to current user.
- Step 3 — common: `name` required; `timezone` required (defaults from profile or `Europe/Paris`).
- Step 3 — Set Interval: at least one day chip must be active for Week / Month modes; minute offset (Hour mode) bounded `0..59`; HH:MM bounded `00:00..23:59`; "Repeat Every" bounded `1..99`, locked to 1 for Week.
- Step 3 — Cron Expression: validated client-side via `croner` paused dry-run before "Create" enables.
- Step 3 — Webhook (currently unreachable): `slug` lower-kebab (`a-z 0-9 -`), `secret` shared with caller for HMAC. Mapping rows: JSONPath `from` ➜ flow variable name `to`.
- `Allow concurrent` defaults off — scheduler skips fires while a prior run is in flight.

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
