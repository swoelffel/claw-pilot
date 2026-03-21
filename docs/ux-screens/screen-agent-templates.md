# Screen — Agent Templates (`cp-agent-templates-view`)

> **Source**: `ui/src/components/agent-templates-view.ts`
> **Route**: `#/agent-templates`

Gallery view for standalone reusable agent blueprints (`agent_blueprints` table). Independent of team blueprints and instances.

## Mockup

```
┌─ Templates ──────────────────────────────────────────────────────┐
│  Agent Templates                    [Import YAML]  [+ New Template] │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ 🤖 My Agent      │  │ 🛠 Tool Agent     │                     │
│  │ [user]           │  │ [tool]            │                     │
│  │ Description...   │  │ Description...    │                     │
│  │ [View] [Clone]   │  │ [View] [Clone]    │                     │
│  │         [Delete] │  │         [Delete]  │                     │
│  └──────────────────┘  └──────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

## Elements

| Element | Description |
|---|---|
| **Header** | Title "Agent Templates" + action buttons |
| **[Import YAML]** | Opens file picker → imports agent blueprint from YAML file |
| **[+ New Template]** | Opens `cp-create-agent-template-dialog` modal |
| **Template cards** | Grid (min 280px per card). Each card: icon, name, category badge (user/tool/system), description truncated to 2 lines, [View], [Clone], [Delete] |
| **[View]** | Navigates to `#/agent-templates/:id` |
| **[Clone]** | Duplicates blueprint → navigates to clone detail |
| **[Delete]** | Confirmation → deletes blueprint |
| **Empty state** | Icon + "No templates yet" + hint |

## Related

- Screens: [Agent Template Detail](screen-agent-template-detail.md)
- Components: [Create Agent Template Dialog](../ux-components/dialog-create-agent-template.md)
