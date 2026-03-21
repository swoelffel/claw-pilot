# Dialog: Delete Agent (`cp-delete-agent-dialog`)

> **Source**: `ui/src/components/delete-agent-dialog.ts`

Centered modal, max width `440px`. Destructive confirmation.

## Mockup

```
┌─ Delete agent ──────────────────────── [✕] ┐
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will permanently delete all...  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Bob - Scrum Master — sm                     │
│                                              │
│  Type the agent ID to confirm                │
│  [sm                                    ]    │
│                                              │
│                    [Cancel]  [Delete]        │
└──────────────────────────────────────────────┘
```

## Behavior

- **Delete** button solid red, disabled while input ≠ `agent.agent_id`
- `Enter` in input → confirms
- During deletion: spinner + "Deleting agent... **slug**"

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md)
