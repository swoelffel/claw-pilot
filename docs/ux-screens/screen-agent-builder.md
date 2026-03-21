# Screen 3 — Agent Builder (`cp-agents-builder`)

> **Source**: `ui/src/components/agents-builder.ts`
> **Route**: `#/instances/:slug/builder`
> **Reference screenshot**: `screen1.png`

Free canvas with positioned agent cards and SVG links. Height = `100vh - 56px (nav) - 48px (subnav)`.

## Mockup

```
┌─ Header ──────────────────────────────────────────────────────┐
│  ← Back  Agents Builder  default  ● running  [+ New agent]  [↓ Export]  [↑ Import]  [↻ Sync]  │
└───────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────┐
│                                                               │
│   [Main]──────────────────────────────────────────────────    │
│      ↘                                                        │
│        [Bob - Scrum Master]   [Amelia - Developer]            │
│      ↙                                                        │
│   [Mary - Business A...]    [Oscar - DevSecOps]               │
│                                                               │
│                              ┌─ Agent Detail Panel ─────────┐ │
│                              │  Pilot  pilot                │ │
│                              │  [Info] [AGENTS.md] [SOUL.md]│ │
│                              │  ...                         │ │
│                              └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

## Header

| Element | Description |
|---|---|
| **← Back** | Return to Instances view. Gray outline, accent hover. |
| **Agents Builder** | Fixed title |
| **slug** | Instance name in monospace muted |
| **State badge** | Instance state (running/stopped/...) |
| **+ New agent** | Opens agent creation dialog (`cp-create-agent-dialog`). Green outline on hover. Pushed right (`margin-left: auto`). |
| **↓ Export** | Exports team as `.team.yaml` (direct download). Gray outline. |
| **↑ Import** | Opens team import dialog (`cp-import-team-dialog`). Gray outline. |
| **↻ Sync** | Resynchronizes agents from disk. Accent outline. Disabled during sync. |

## Canvas

- Background `--bg-base`, position `absolute inset: 0`
- Cards positioned in `position: absolute`, centered on their point (`transform: translate(-50%, -50%)`)
- SVG links in overlay (`pointer-events: none`)
- **Drag & drop**: `pointerdown/move/up` on canvas. 5px threshold to distinguish click (selection) from drag (movement). Position persisted in DB after drag.
- **Short click**: select/deselect agent → open/close detail panel

## Canvas States

| State | Rendering |
|---|---|
| **Syncing** | Semi-transparent overlay + centered spinner |
| **Error** | Centered error banner at top |
| **Empty** | "No agents found" + "Click Sync to refresh from disk" centered |
| **Normal** | Cards + SVG links |

## Sub-components

### SVG Links (`cp-agent-links-svg`)

> **Source**: `ui/src/components/agent-links-svg.ts`

Full-canvas SVG, `pointer-events: none`. Draws `spawn` type links between agents.

| Link Type | Style |
|---|---|
| **Normal spawn** | Gray dashes `#666`, gray arrow |
| **Pending-remove spawn** | Red dashes `#ef4444`, red arrow |
| **Pending-add spawn** | Green dashes `#10b981`, green arrow |

A2A links are not drawn in SVG — indicated by accent border on cards.

## Related

- Components: [Agent Card Mini](../ux-components/comp-agent-card-mini.md), [Agent Detail Panel](../ux-components/comp-agent-detail-panel.md), [New Agent Dialog](../ux-components/dialog-create-agent.md), [Delete Agent Dialog](../ux-components/dialog-delete-agent.md), [Import Team Dialog](../ux-components/dialog-import-team.md)
