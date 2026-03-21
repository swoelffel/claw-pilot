# Agent File Editor (`cp-agent-file-editor`)

> **Source**: `ui/src/components/agent-file-editor.ts`

Renders all workspace files under a single "Files" tab in the Agent Detail Panel.

## View Mode

- `editable` (green) or `read-only` (gray) badge
- ✏ button if editable → switches to edit mode
- Content rendered as Markdown (marked + DOMPurify)

## Edit Mode

- `EDITING` accent badge
- `Edit` / `Preview` tabs
- Resizable monospace textarea
- `Save` / `Cancel` buttons
- If Cancel with unsaved edits → "Discard changes?" confirmation dialog
- Same behavior if switching tabs with edits in progress

## File Categories

**Editable files**: AGENTS.md, SOUL.md, TOOLS.md, BOOTSTRAP.md, USER.md, HEARTBEAT.md

**Read-only files**: all others (MEMORY.md, etc.)

## Related

- Components: [Agent Detail Panel](comp-agent-detail-panel.md)
- Screens: [Agent Template Detail](../ux-screens/screen-agent-template-detail.md)
