# Dialog: Create Agent Template (`cp-create-agent-template-dialog`)

> **Source**: `ui/src/components/create-agent-template-dialog.ts`

Modal for creating a new standalone agent blueprint.

## Mockup

```
┌─ New Agent Template ─────────────────────────────────────────────┐
│                                                                  │
│  Name *                                                          │
│  [Agent name                                          ]          │
│                                                                  │
│  Description                                                     │
│  [What this agent does...                             ]          │
│                                                                  │
│  Category                                                        │
│  ( user  ) ( tool  ) ( system )                                  │
│                                                                  │
│  Seed default workspace files                                    │
│  [☑] Create SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md           │
│                                                                  │
│                              [Cancel]  [Create Template]         │
└──────────────────────────────────────────────────────────────────┘
```

## Fields

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | Free text, 1–100 chars. Create button disabled if empty. |
| **Description** | No | Textarea, up to 500 chars |
| **Category** | No | Radio: `user` (default) · `tool` · `system` |
| **Seed files** | No | If checked, creates default workspace files (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md) |

## Related

- Screens: [Agent Templates](../ux-screens/screen-agent-templates.md)
