# Component — Cron picker (`cp-cron-picker`)

> **Source**: `ui/src/components/triggers/cp-cron-picker.ts`
> **Used by**: `cp-trigger-wizard`
> **Screen**: [screen-triggers.md](../ux-screens/screen-triggers.md)

Visual cron expression builder with two modes: **Set Interval** (visual, default)
and **Cron Expression** (raw text with live validation).

## Properties

| Property | Type | Description |
|---|---|---|
| `value` | `string` | Current cron expression (5-field). Two-way bound via `change` event. |
| `timezone` | `string` | IANA timezone, used for the "Next 3 runs" preview. |

## Events

| Event | Detail | When |
|---|---|---|
| `change` | `{ cron: string, humanReadable: string }` | Underlying cron expression changes |

## Modes

### Set Interval (visual)
Mode switcher at the top, then a "Repeat Every N [unit]" row, then a unit-specific body:

| Unit | Body | Cron compilation |
|---|---|---|
| Minute(s) | (none — runs every N minutes) | `*/N * * * *` |
| Hour(s) | At minute :MM (0..59) | `MM */N * * *` (N=1 → `MM * * * *`) |
| Day(s) | Execute at HH:MM | `MM HH */N * *` (N=1 → `MM HH * * *`) |
| Week(s) | Day chips Mon..Sun (multi-select, default Mon) + HH:MM. `every` locked to 1 with tooltip. | `MM HH * * <DOW-csv>` (1=Mon..7=Sun) |
| Month(s) | 7-column DOM grid 1..31 (multi-select, default 1) + HH:MM. Days 29/30/31 flagged with `*` and tooltip. | `MM HH <DOM-csv> */N *` |

### Cron Expression (raw)
- Free-text input.
- Live validation via `croner` paused dry-run — invalid expressions surface a red
  banner under the input with the reason.
- "Next 3 runs:" preview — `new Cron(expr, { timezone, paused: true }).nextRuns(3)`.

## Pure compilation function

The compilation logic is exposed as a pure function for testing:

```ts
export function compileCron(state: CronIntervalState): { cron: string; humanReadable: string };
export function defaultIntervalState(): CronIntervalState;

export interface CronIntervalState {
  unit: "minute" | "hour" | "day" | "week" | "month";
  every: number;        // 1..99, locked to 1 for "week"
  minute: number;       // 0..59
  hour: number;         // 0..23
  days: DayOfWeek[];    // 1=Mon..7=Sun
  daysOfMonth: number[]; // 1..31
}
```

Tested in `ui/src/components/triggers/__tests__/cp-cron-picker.test.ts` — covers every
permutation of the compilation table above, plus clamping and sort behaviour.

## Validation rules

- `every`: 1..99 (clamped server-side too); locked to 1 in Week mode (cron cannot
  express "every N weeks" without a custom modulo guard).
- `minute`: 0..59 (clamped).
- `hour`: 0..23 (clamped).
- Week: at least one day chip must remain selected; falls back to Monday if cleared.
- Month: at least one day-of-month must remain selected; falls back to day 1 if cleared.
- Expression mode: validated by croner before the picker emits a usable `change`.
