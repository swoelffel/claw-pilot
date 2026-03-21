# Dialog: Team Import (`cp-import-team-dialog`)

> **Source**: `ui/src/components/import-team-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `500px`. Accessible from **↑ Import** button in Agent Builder and Blueprint Builder headers.

## Mockup

```
┌─ Import Agent Team ─────────────────── [✕] ┐
│                                              │
│  ┌─ Drop zone ────────────────────────────┐  │
│  │  Drop .team.yaml file here             │  │
│  │  or click to browse                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  (after selecting valid file)                │
│  File     my-team.team.yaml                  │
│  Agents   8 (current: 3)                     │
│  Links    12                                 │
│  Files    48                                 │
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will replace all existing        │  │
│  │  agents, files, and links.             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│                    [Cancel]  [Import]        │
└──────────────────────────────────────────────┘
```

## Behavior

| Step | Description |
|---|---|
| **Drop / Browse** | Drag & drop zone or click to open file selector (`.yaml`, `.yml`). Accent border + light background on hover/dragover. |
| **Auto dry-run** | Once file selected, automatic API call in dry-run mode → display summary (agents, links, files to import). |
| **Summary** | Number of agents to import, current count, links, workspace files. |
| **Warning** | Amber banner: "This will replace all existing agents, files, and links. This action cannot be undone." |
| **Import** | Button disabled until dry-run succeeds. During import: inline spinner. |
| **Success** | Emit `team-imported` → parent reloads canvas data. |

**Polymorphic context**: works for instance (`kind: "instance"`) or blueprint (`kind: "blueprint"`). Called API routes differ by context.

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md)
