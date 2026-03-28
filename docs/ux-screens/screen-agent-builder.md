# Screen 3 — Agent Builder (`cp-agents-builder`)

> **Source**: `ui/src/components/agents-builder.ts`
> **Route**: `#/instances/:slug/builder`

Free canvas with positioned agent cards, SVG links, and collapsible legend. Height = `100vh - 56px (nav) - 48px (subnav)`.

## Mockup

```
┌─ Header ──────────────────────────────────────────────────────────────┐
│  ← Back  Agents Builder  cpteam  ● running  [+ New agent]  [↓ Export]  [↑ Import]  [↻ Sync]  │
└───────────────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────────────┐
│                                                                       │
│   ┌─ Pilot (accent bg) ─┐                                            │
│   │ communicator opus-4-6│╌╌╌╌╌╌╌╌▸ [Dev (dark bg)]                  │
│   └──────────────────────┘         │generator sonnet-4-6│             │
│      ╎ ╎ ╎ messaging               └───────────────────┘             │
│   ┌──────────────────────┐                                            │
│   │ Tech Manager         │                                            │
│   │ planner opus-4-6     │   ┌─────────────────────────────────────┐  │
│   │ → @evaluator         │   │  Agent Detail Panel (if 1 selected) │  │
│   └──────────────────────┘   │  [Info] [Files] [Config]            │  │
│                               └─────────────────────────────────────┘  │
│  ┌ ╌╌╌ Delegation ╌╌╌ ─── Messaging ───  ✕ ┐  ← Legend               │
└───────────────────────────────────────────────────────────────────────┘
```

## Header

| Element | Description |
|---------|-------------|
| **← Back** | Return to Instances view. Gray outline, accent hover. |
| **Agents Builder** | Fixed title |
| **slug** | Instance name in monospace muted |
| **State badge** | Instance state (running/stopped/...) |
| **+ New agent** | Opens agent creation dialog. Green outline on hover. Pushed right (`margin-left: auto`). |
| **↓ Export** | Exports team as `.team.yaml` (direct download). Gray outline. |
| **↑ Import** | Opens team import dialog. Gray outline. |
| **↻ Sync** | Resynchronizes agents from disk. Accent outline. Disabled during sync. |

## Canvas

- Background `--bg-base`, position `absolute inset: 0`
- Cards positioned in `position: absolute`, centered on their point (`transform: translate(-50%, -50%)`)
- SVG links in overlay (`pointer-events: none`), clipped to card edges via ray-rectangle intersection
- Canvas legend in bottom-left corner (collapsible, state persisted in localStorage)

## Interactions

### Single card click
- Click on unselected card → selects it (detail panel appears)
- Click on selected card → deselects it (detail panel closes)

### Multi-select (rubber-band)
- Click + drag on empty canvas → draws a blue semi-transparent selection rectangle
- On release: all cards whose center is within the rectangle are selected
- Detail panel shown only when exactly 1 card is selected

### Group drag
- Drag on a selected card → moves all selected cards together
- All positions persisted to API on drag end (fire-and-forget)

### Deselection
- Click on selected card → removes it from selection
- Click on empty canvas (no drag) → clears entire selection

## Canvas states

| State | Rendering |
|-------|-----------|
| **Syncing** | Semi-transparent overlay + centered spinner |
| **Error** | Centered error banner at top |
| **Empty** | "No agents found" + "Click Sync to refresh from disk" centered |
| **Normal** | Cards + SVG links + legend |

## Visual hierarchy

Cards visually distinguish agent types:

| Agent type | Background | Border | Signal |
|------------|-----------|--------|--------|
| **Default** (pilot) | `--accent-subtle` | `--accent-border` | Blue tint = entry point |
| **Permanent** | `--bg-surface` | `--bg-border` | Opaque = always present |
| **Ephemeral** | `--bg-base` | `--bg-border` | Darker = spawned on demand |

Archetype is indicated by a 3px colored left stripe and a labeled badge in row 3.

## Sub-components

| Component | Role |
|-----------|------|
| `cp-agent-links-svg` | SVG link overlay (spawn dotted, a2a dashed) |
| `cp-canvas-legend` | Collapsible legend (bottom-left) |
| `cp-agent-card-mini` | Positioned agent cards |
| `cp-agent-detail-panel` | Right-side panel (when 1 selected) |

## Related

- Components: [Agent Card Mini](../ux-components/comp-agent-card-mini.md), [Agent Detail Panel](../ux-components/comp-agent-detail-panel.md), [Agent Links SVG](../ux-components/comp-agent-links-svg.md), [New Agent Dialog](../ux-components/dialog-create-agent.md), [Delete Agent Dialog](../ux-components/dialog-delete-agent.md), [Import Team Dialog](../ux-components/dialog-import-team.md)
