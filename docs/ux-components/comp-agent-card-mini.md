# Agent Card Mini (`cp-agent-card-mini`)

> **Source**: `ui/src/components/agent-card-mini.ts`

Compact card positioned on canvas. Width 130-160px (180px for default agent).

## Mockup

```
┌─────────────────────────────┐
│  Bob - Scrum Master      ✕  │  ← row 1: name + delete button
│  sm              7 files    │  ← row 2: agent_id + file count
│  [A2A]  claude-haku-4-5     │  ← row 3: badge + model
└─────────────────────────────┘
```

## Badges (row 3)

| Badge | Color | Condition | Tooltip |
|---|---|---|---|
| **Default** | Blue accent | `is_default === true` | "Main entry point for conversations..." |
| **A2A** | Blue accent | Connected in A2A mode | "Connected in Agent-to-Agent mode..." |
| **SA** | Gray outline | Neither default nor A2A | "SubAgent: specialized agent..." |

## Visual States

| State | Style |
|---|---|
| **Normal** | `--bg-border` border |
| **A2A** | `--accent-border` border |
| **Selected** | `--accent` border + `--accent-border` glow |
| **New** (2s) | Thick green border + fading pulse animation |

## Delete Button (✕)

Visible only if `deletable === true` (non-default). Opacity 0.45 → 1 on hover, red color. `stopPropagation()` → emit `agent-delete-requested`.

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md)
