# Screen 4 — Blueprints View (`cp-blueprints-view`)

> **Source**: `ui/src/components/blueprints-view.ts`
> **Route**: `#/blueprints`

Structure identical to Instances view: early return during loading, header with dynamic count + button, card grid.

## Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│  2 blueprints                         [+ New Blueprint]         │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Blueprint Card  │  │  Blueprint Card  │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## States

| State | Rendering |
|---|---|
| **Loading** | "Loading blueprints..." centered (early return — header not shown) |
| **Error** | Red error banner before header |
| **Empty** | Header "0 blueprints" + 📋 icon + "No blueprints yet" + hint |
| **Normal** | Header "N blueprints" + grid `auto-fill minmax(300px, 1fr)`, gap 16px |

## Interactions

- **Click on a card** → navigate to Blueprint Builder
- **"+ New Blueprint" button** → open blueprint creation dialog
- **Deletion**: handled inline in card (confirmation)

## Related

- Components: [Blueprint Card](../ux-components/comp-blueprint-card.md), [New Blueprint Dialog](../ux-components/dialog-create-blueprint.md)
