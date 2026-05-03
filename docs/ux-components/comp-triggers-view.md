# Component — Triggers View (`cp-triggers-view`)

> **Source**: `ui/src/components/triggers/cp-triggers-view.ts`
> **Used in**: Triggers screen (`#/instances/:slug/triggers`)

Page-level container for the per-instance Triggers panel. Hosts the list, the create wizard, and the detail drawer; manages local state and re-fetches.

## Props

| Property | Type | Description |
|---|---|---|
| `instanceSlug` | `string` | Required. Drives all API calls. Reloads triggers on change. |

## State

| Field | Purpose |
|---|---|
| `_triggers: FlowTrigger[]` | Cached list rendered by `cp-trigger-list` |
| `_error: string` | User-friendly error banner content |
| `_showWizard: boolean` | Mount/unmount the wizard modal |
| `_detailId: number \| null` | Currently opened trigger detail (drawer) |

## Layout

```
section-header  (title "Triggers" + "New trigger" primary button)
[error-banner]  (conditional)
cp-trigger-list  (slot for rows)
cp-trigger-wizard (overlay if _showWizard)
cp-trigger-detail (drawer if _detailId !== null)
```

`:host { padding: 16px }`. Title `h1 { font-size: 22px }`. Section header is `display: flex; justify-content: space-between`.

## Events handled

| Source | Event | Effect |
|---|---|---|
| `cp-trigger-list` | `trigger-open` | `_detailId = e.detail.id` |
| `cp-trigger-list` | `trigger-updated` | Patch the matching row in `_triggers` |
| `cp-trigger-list` | `trigger-deleted` | Remove the row; close drawer if it was open |
| `cp-trigger-list` | `trigger-fired` | Re-fetch `listTriggers` (for `lastFiredAt`) |
| `cp-trigger-wizard` | `created` | Append the new trigger; close wizard |
| `cp-trigger-wizard` | `cancelled` | Close wizard without changes |

## API

`listTriggers(slug)` on mount and on `instanceSlug` update. Errors mapped via `userMessage(err)` from `lib/error-messages.js`.

## Lifecycle

- `connectedCallback` → `_load()`.
- `updated(changed)` → re-load if `instanceSlug` changed.

## Related

- Screen: [screen-triggers.md](../ux-screens/screen-triggers.md)
- Children: [comp-trigger-list.md](comp-trigger-list.md), [comp-trigger-wizard.md](comp-trigger-wizard.md), [comp-trigger-detail.md](comp-trigger-detail.md)

---

*Since v0.81.0 (TRIGGER-001a)*
