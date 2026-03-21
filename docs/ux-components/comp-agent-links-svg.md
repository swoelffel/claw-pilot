# Agent Links SVG (`cp-agent-links-svg`)

> **Source**: `ui/src/components/agent-links-svg.ts`

Full-canvas SVG, `pointer-events: none`. Draws `spawn` type links between agents.

## Link Types

| Link Type | Style |
|---|---|
| **Normal spawn** | Gray dashes `#666`, gray arrow |
| **Pending-remove spawn** | Red dashes `#ef4444`, red arrow |
| **Pending-add spawn** | Green dashes `#10b981`, green arrow |

A2A links are not drawn in SVG — indicated by accent border on cards.

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md)
