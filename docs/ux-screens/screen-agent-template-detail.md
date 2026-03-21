# Screen — Agent Template Detail (`cp-agent-template-detail`)

> **Source**: `ui/src/components/agent-template-detail.ts`
> **Route**: `#/agent-templates/:id`

Detail view for a single agent blueprint template with metadata display and file editing.

## Mockup

```
┌─ Agent Template Detail ──────────────────────────────────────────┐
│  [← Back]  🤖 My Agent  [user]              [Export YAML]       │
│                                                                  │
│  Description: ...                                                │
│  Category: user                                                  │
│                                                                  │
│  ┌─ Files ────────────────────────────────────────────────────┐  │
│  │ SOUL.md  [Edit]                                            │  │
│  │ IDENTITY.md  [Edit]                                        │  │
│  │ AGENTS.md  [Edit]                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [File editor: cp-agent-file-editor]                             │
└──────────────────────────────────────────────────────────────────┘
```

## Elements

| Element | Description |
|---|---|
| **[← Back]** | Navigates to `#/agent-templates` |
| **Title** | Icon + name + category badge |
| **[Export YAML]** | Downloads blueprint as YAML file |
| **Description** | Read-only metadata display |
| **Files list** | Lists workspace files for this blueprint; click [Edit] to open `cp-agent-file-editor` |
| **`cp-agent-file-editor`** | Inline textarea editor for workspace files (SOUL.md, IDENTITY.md, etc.) with [Save] and [Cancel] |

## Related

- Screens: [Agent Templates](screen-agent-templates.md)
- Components: [Agent File Editor](../ux-components/comp-agent-file-editor.md)
