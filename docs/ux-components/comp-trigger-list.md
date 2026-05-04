# Component — Trigger List (`cp-trigger-list`)

> **Source**: `ui/src/components/triggers/cp-trigger-list.ts`
> **Used in**: `cp-triggers-view`

Compact row list of triggers attached to an instance. Each row exposes inline actions (toggle, fire, open detail, delete) and a status pill.

## Mockup

```
+-------+-----------------------------------------+-----+--------------------+
| [cron]| daily-summary                           |[ON ]| [Disable] [Fire]   |
|       | my-instance -> flow #12 . last 09:00    |     | [Detail]  [Delete] |
+-------+-----------------------------------------+-----+--------------------+
```

Empty state: `<p>No triggers yet.</p>` (i18n id `trigger-list-empty`).

## Props

| Property | Type | Description |
|---|---|---|
| `instanceSlug` | `string` | Used as fallback when row's `t.instanceSlug` is missing. |
| `triggers` | `FlowTrigger[]` | Source rows to render. |

## Row layout (CSS grid)

`grid-template-columns: auto 1fr auto auto auto` — kind pill, name + meta, enabled pill, actions cluster.

| Column | Element |
|---|---|
| Kind | Mono pill `[cron]` / `[webhook]` (small, bordered) |
| Name + meta | Click-to-open name (`color → --accent` on hover); meta line `<slug> -> flow #<id> · last fired <ts>` (mono, muted) |
| Enabled pill | `.on` (success-tinted) / `.off` (muted) |
| Actions | `[Enable / Disable]` (toggle), `[Fire]`, `[Detail]`, `[Delete]` |

## Events emitted

All emit with `bubbles: true, composed: true`.

| Event | Detail | When |
|---|---|---|
| `trigger-open` | `{ id }` | Click on name or "Detail" button |
| `trigger-updated` | `FlowTrigger` | After `updateTrigger` (toggle) resolves |
| `trigger-fired` | `{ id }` | After `fireTrigger` resolves |
| `trigger-deleted` | `{ id }` | After `deleteTrigger` resolves |

## API used

- `updateTrigger(slug, id, { enabled })` — toggle on/off.
- `fireTrigger(slug, id)` — manual fire (also exposed in detail drawer).
- `deleteTrigger(slug, id)` — hard delete (no confirmation here; parent decides whether to wrap one).

## Notes

- The toggle does an optimistic round-trip: it awaits the server before bubbling `trigger-updated`. No optimistic UI flip in this component.
- "Fire" does not show progress in the list — caller must inspect the detail drawer "Runs" tab afterwards.

## Related

- Parent: [comp-triggers-view.md](comp-triggers-view.md)
- Detail: [comp-trigger-detail.md](comp-trigger-detail.md)

---

*Since v0.81.0 (TRIGGER-001a)*
