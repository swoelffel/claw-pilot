# Dialog: New Agent (`cp-create-agent-dialog`)

> **Source**: `ui/src/components/create-agent-dialog.ts`

Centered modal, max width `480px`. Same structure as instance creation dialog.

## Mockup

```
┌─ New agent ─────────────────────────── [✕] ┐
│                                              │
│  ── Identity ──────────────────────────────  │
│  Agent ID *        Display name *            │
│  [qa-engineer ]    [QA Engineer  ]           │
│  Role                                        │
│  [Quality Assurance                ]         │
│                                              │
│  ── Model ─────────────────────────────────  │
│  Provider          Model                     │
│  [Anthropic ▼]     [claude-sonnet ▼]         │
│                                              │
│                    [Cancel]  [Create agent]  │
└──────────────────────────────────────────────┘
```

## Validation

- Agent ID: auto-lowercase, `[a-z0-9-]`, 2-30 chars, not already used in instance
- Display name: auto-filled from ID (kebab-case → Title Case) while user hasn't manually edited
- Create button disabled if form invalid or providers loading

## Submission State

Spinner + "Creating agent **slug**..."

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md)
