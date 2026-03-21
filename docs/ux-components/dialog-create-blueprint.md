# Dialog: New Blueprint (`cp-create-blueprint-dialog`)

> **Source**: `ui/src/components/create-blueprint-dialog.ts`

Centered modal, width `480px`.

## Mockup

```
┌─ New Blueprint ──────────────────────────────────┐
│                                                  │
│  Name *                                          │
│  [e.g. HR Team, Dev Squad              ]         │
│                                                  │
│  Description                                     │
│  [What this team does...               ]         │
│  [                                     ]         │
│                                                  │
│  Icon                                            │
│  [Emoji or icon name                   ]         │
│                                                  │
│  Tags                                            │
│  [Comma-separated, e.g. hr, legal      ]         │
│                                                  │
│  Color                                           │
│  [✕] [●] [●] [●] [●] [●] [●] [●] [●]           │
│                                                  │
│                        [Cancel]  [Create]        │
└──────────────────────────────────────────────────┘
```

## Fields

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | Free text. Create button disabled if empty. |
| **Description** | No | Resizable textarea |
| **Icon** | No | Emoji or free text |
| **Tags** | No | CSV string (e.g., "hr, legal") |
| **Color** | No | Selector for 8 preset colors + "none" option (✕). Circular swatches 28px. |

## Preset Colors

`#4f6ef7` (blue), `#10b981` (green), `#f59e0b` (amber), `#ef4444` (red), `#8b5cf6` (violet), `#06b6d4` (cyan), `#f97316` (orange), `#ec4899` (pink).

Selected swatch: white border + scale 1.1.

## Related

- Screens: [Blueprints View](../ux-screens/screen-blueprints.md)
