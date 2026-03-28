# Canvas Legend (`cp-canvas-legend`)

> **Source**: `ui/src/components/canvas-legend.ts`

Collapsible legend in bottom-left corner of the builder canvas. Explains link visual styles.

## Layout

### Expanded
```
┌ ╌╌▸ Delegation  ─── Messaging  ✕ ┐
```
- 2 items with inline SVG line samples
- Delegation: dotted gray line with filled triangle arrow
- Messaging: dashed muted line (no arrow)
- ✕ button to collapse

### Collapsed
```
┌ ◧ ┐
```
- Single toggle button to expand

## State persistence

Collapse/expand state stored in `localStorage` key `cp-canvas-legend-collapsed`.

## Styling

- Background: `--bg-surface` at 92% opacity with `backdrop-filter: blur(4px)`
- Border: `--bg-border`
- Font size: 10px, color: `--text-muted`
- Position: `absolute; bottom: 12px; left: 12px; z-index: 10`

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md)
