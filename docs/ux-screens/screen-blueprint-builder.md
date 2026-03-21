# Screen 5 — Blueprint Builder (`cp-blueprint-builder`)

> **Source**: `ui/src/components/blueprint-builder.ts`
> **Route**: `#/blueprints/:id/builder`

Same visual structure as Agent Builder (canvas + panel), but for blueprints (no live instance).

## Mockup

```
┌─ Header ──────────────────────────────────────────────────────┐
│  ← Back to Blueprints   HR Team  🎯          [+ New agent]   │
└───────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────┐
│  (same canvas as agents-builder)                              │
│                              ┌─ Agent Detail Panel ─────────┐ │
│                              │  (same panel, BP context)    │ │
│                              └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

## Differences vs Agent Builder

| Aspect | Agent Builder | Blueprint Builder |
|---|---|---|
| Panel context | `{ kind: "instance", slug }` | `{ kind: "blueprint", blueprintId }` |
| Sync button | Present | Absent |
| Agent creation dialog | `cp-create-agent-dialog` (full) | Inline simplified dialog (ID + Name + Model) |
| Agent deletion | Via `cp-delete-agent-dialog` | Direct (no confirmation dialog) |
| Last sync in panel | Displayed | Hidden |
| Spawn links API | `/api/instances/:slug/agents/:id/spawn-links` | `/api/blueprints/:id/agents/:id/spawn-links` |

## Agent Creation Dialog (inline in blueprint-builder)

Simplified dialog without provider/API key:

```
┌─ New agent ─────────────────────────────────────┐
│  Agent ID *  [researcher              ]          │
│  Name *      [Research Agent          ]          │
│  Model       [claude-opus-4-5         ] (optional) │
│                          [Cancel]  [Create]      │
└──────────────────────────────────────────────────┘
```

## Related

- Components: [Agent Card Mini](../ux-components/comp-agent-card-mini.md), [Agent Detail Panel](../ux-components/comp-agent-detail-panel.md), [Import Team Dialog](../ux-components/dialog-import-team.md)
- Screens: [Agent Builder](screen-agent-builder.md)
