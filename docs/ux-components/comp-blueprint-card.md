# Blueprint Card (`cp-blueprint-card`)

> **Source**: `ui/src/components/blueprint-card.ts`

## Mockup

```
┌─────────────────────────────────────┐
│ ▌ 🎯 HR Team              [Delete] │  ← header (color bar + icon + name)
│                                     │
│  Description du blueprint...        │  ← description (2 lines max)
│                                     │
│  3 agents   [hr]  [legal]           │  ← meta (count + tags)
│                                     │
│  ┌─ Delete blueprint "HR Team"? ──┐ │  ← inline confirmation (conditional)
│  │  [Delete]  [Cancel]            │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Elements

| Element | Description |
|---|---|
| **Color bar** | Left 3px vertical band with blueprint color (if defined) |
| **Icon** | Emoji or text, `font-size: 20px` (if defined) |
| **Name** | `font-size: 16px`, `font-weight: 700` |
| **Delete button** | Transparent outline → red on hover. `stopPropagation()`. |
| **Description** | 2 lines max with ellipsis |
| **Agent count** | "N agents" or "No agents" |
| **Tags** | Accent pills rounded (`border-radius: 20px`) |

## Deletion Confirmation

Appears inline below meta when Delete clicked. Transparent red background.
**Delete** button solid red → emit `blueprint-delete`. **Cancel** button → hide confirmation.
Card click ignored if delete/confirm area clicked.

## Hover

`--accent-border` border + glow `0 0 0 1px --accent-border`.

## Related

- Screens: [Blueprints View](../ux-screens/screen-blueprints.md)
