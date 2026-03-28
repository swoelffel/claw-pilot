# Agent Card Mini (`cp-agent-card-mini`)

> **Source**: `ui/src/components/agent-card-mini.ts`

Compact card positioned on canvas. Fixed width 186px (200px for default agent).

## Mockup

### Permanent agent (default)
```
┌──────────────────────────────────┐  ← accent bg (--accent-subtle)
│  Pilot                      ✕   │  row 1: name + delete
│  pilot                 6 files  │  row 2: agent_id + file count
│  communicator    claude-opus-4-6 │  row 3: archetype badge + model
└──────────────────────────────────┘
   pink stripe left (communicator archetype)
```

### Permanent agent (with @archetype spawns)
```
┌──────────────────────────────────┐  ← --bg-surface (opaque)
│  Tech Manager              ✕    │
│  tech-mgr              4 files  │
│  planner       claude-opus-4-6  │
│  ─────────────────────────────  │  row 4 separator
│  → @evaluator  → @generator     │  row 4: inline @archetype spawns
└──────────────────────────────────┘
   purple stripe left (planner archetype)
```

### Ephemeral agent
```
┌──────────────────────────────────┐  ← --bg-base (darker)
│  Dev                       ✕    │
│  dev               4 files      │
│  generator    claude-sonnet-4-6 │
└──────────────────────────────────┘
   green stripe left (generator archetype)
```

### Ephemeral agent (no archetype)
```
┌──────────────────────────────────┐  ← --bg-base (darker)
│  Docs                      ✕    │
│  docs              4 files      │
│  AGENT       claude-haiku-4-5   │
└──────────────────────────────────┘
   no stripe (no archetype)
```

## Card dimensions

| Variant | Width | Height |
|---------|-------|--------|
| Standard | 186px | 80px |
| Default (pilot) | 200px | 80px |
| With @archetype spawns (row 4) | 186px | 104px |

## Background — persistence signal

| Persistence | Background | Signal |
|-------------|-----------|--------|
| **Permanent** | `--bg-surface` (#1a1d27) | Opaque, "solid" |
| **Ephemeral** | `--bg-base` (#0f1117) | Darker, "in background" |
| **Default** | `--accent-subtle` | Blue tint, entry point |

## Archetype stripe (left border, 3px)

| Archetype | Color |
|-----------|-------|
| planner | `--archetype-planner` (#8b5cf6 purple) |
| generator | `--archetype-generator` (#10b981 green) |
| evaluator | `--archetype-evaluator` (#f59e0b amber) |
| orchestrator | `--archetype-orchestrator` (#4f6ef7 blue) |
| analyst | `--archetype-analyst` (#0ea5e9 cyan) |
| communicator | `--archetype-communicator` (#ec4899 pink) |
| _(none)_ | transparent |

## Badges (row 3)

Priority: archetype > category.

| Badge | Style | Condition |
|-------|-------|-----------|
| **archetype** | Colored text + colored border (matches archetype) | `archetype !== null` |
| **System** | Muted, dashed border | `category === "system"` |
| **Tool** | Muted, solid border | `category === "tool"` |
| **Agent** | Muted, solid border | `category === "user"` (fallback) |

## Row 4 — @archetype spawn targets (optional)

Shown only when the agent has `spawn` links targeting `@archetype` identifiers. Displayed as colored capsules (`→ @evaluator`, `→ @generator`) below a thin separator line. Colors match the archetype color map.

## Visual states

| State | Style |
|-------|-------|
| **Normal** | `--bg-border` border |
| **Selected** | `--accent` border + `--accent-border` glow |
| **New** (2s) | Thick green border + fading pulse animation |

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `agent` | `AgentBuilderInfo` | Agent data (includes `persistence`, `archetype`) |
| `selected` | `boolean` | Selection highlight |
| `isNew` | `boolean` | New-agent pulse animation (2s) |
| `deletable` | `boolean` | Show ✕ delete button |
| `archetypeSpawns` | `string[]` | @archetype spawn targets (e.g. `["evaluator", "generator"]`) |

## Delete Button (✕)

Visible only if `deletable === true` (non-default). Opacity 0.45 → 1 on hover, red color. `stopPropagation()` → emit `agent-delete-requested`.

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md)
