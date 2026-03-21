# Dialog: New Instance (`cp-create-dialog`)

> **Source**: `ui/src/components/create-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `560px`.

## Mockup

```
┌─ New Instance ──────────────────────────── [✕] ┐
│                                                  │
│  ── Identity ──────────────────────────────────  │
│  Slug *          Display name                    │
│  [dev-team    ]  [Dev Team    ]                  │
│                                                  │
│  ── Configuration ─────────────────────────────  │
│  Gateway port *                                  │
│  [18790       ]  (Auto-suggested from free range)│
│                                                  │
│  ── Provider ──────────────────────────────────  │
│  AI Provider *   Default model *                 │
│  [Anthropic ▼]   [claude-sonnet ▼]               │
│  API Key *                                       │
│  [sk-ant-...  ]                                  │
│                                                  │
│  ── Team Blueprint ────────────────────────────  │
│  [None ▼]                                        │
│                                                  │
│  ── Agent team ────────────────────────────────  │
│  [Minimal (pilot only)]  [Custom agents]         │
│                                                  │
│                          [Cancel]  [Create Instance] │
└──────────────────────────────────────────────────┘
```

## Sections

| Section | Fields |
|---|---|
| **Identity** | Slug * (real-time validation), Display name (auto-filled from slug) |
| **Configuration** | Gateway port * (auto-suggested via API) |
| **Provider** | AI Provider (select), Default model (select), API Key * (if provider requiresKey) |
| **Team Blueprint** | Optional select from existing blueprints |
| **Agent team** | Toggle Minimal / Custom. In Custom mode: agent list (id + name) + "+ Add agent" button |

## Slug Validation

- Auto-lowercase, characters `[a-z0-9-]` only
- Inline error if empty / invalid format / length outside 2-30
- Auto-fills Display name (capitalized, dashes → spaces) while user hasn't manually edited it

## Submission State

During provisioning: form replaced by spinner + message "Provisioning instance **slug**..." (+ "Deploying blueprint agents..." if blueprint selected).

## Closing

- ✕ button (disabled during submission)
- Click on overlay
- Cancel button

## Related

- Screens: [Instances View](../ux-screens/screen-instances.md)
