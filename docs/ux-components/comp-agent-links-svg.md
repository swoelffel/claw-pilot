# Agent Links SVG (`cp-agent-links-svg`)

> **Source**: `ui/src/components/agent-links-svg.ts`

Full-canvas SVG overlay, `pointer-events: none`. Draws links between agent cards.

## Link types

| Type | Style | Width | Dash | Marker | Color |
|------|-------|-------|------|--------|-------|
| **Spawn** (delegation) | Dotted | 1px | `2 3` | Filled triangle | `#666` |
| **A2A** (messaging, bidirectional) | Dashed | 1.5px | `6 4` | _(none)_ | `#64748b` |
| **A2A** (messaging, unidirectional) | Dashed | 1.5px | `6 4` | Open chevron | `#64748b` |
| **Pending-remove** | Dotted | 1px | `2 3` | Red triangle | `#ef4444` |
| **Pending-add** | Dashed | 1.5px | `6 4` | Green triangle | `#10b981` |

## Line clipping

Lines are clipped using **ray-rectangle intersection** so they start and end at the card edge (not the center). The `rectEdgePoint()` function computes where the line from center→target exits the card bounding box.

Constants (half-dimensions + padding):
- `CARD_HW = 95` (half-width)
- `CARD_HH = 42` (half-height)
- `EDGE_PAD = 4`

## A2A bidirectional deduplication

When both `A→B` and `B→A` links exist, they are merged into a single line rendered without markers (plain dashed line). A pair key `sort(A,B).join("↔")` tracks rendered pairs.

## @archetype links

Links with `target_agent_id` starting with `@` (e.g. `@evaluator`) are **not drawn** in the SVG. They are rendered inline in the source agent's card as colored capsules (row 4). See [comp-agent-card-mini.md](comp-agent-card-mini.md).

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md)
- Components: [Agent Card Mini](comp-agent-card-mini.md), [Canvas Legend](comp-canvas-legend.md)
