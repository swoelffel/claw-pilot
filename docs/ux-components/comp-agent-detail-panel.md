# Agent Detail Panel (`cp-agent-detail-panel`)

> **Source**: `ui/src/components/agent-detail-panel.ts`

Right side panel, `width: 420px`, canvas height 100%. Expands to 100% in expanded mode.

## Mockup

```
┌─ Panel Header ──────────────────────────────────────┐
│  Pilot  pilot                  [🗑] [⊞] [✕]        │
│  (role if defined)                                  │
├─ Tabs ──────────────────────────────────────────────┤
│  [Info]  [Heartbeat]  [Config]  [Files]           │
├─ Body ──────────────────────────────────────────────┤
│  (content by active tab)                            │
├─ Save Bar (conditional) ────────────────────────────┤
│  [Save]  [Cancel]                                   │
└─────────────────────────────────────────────────────┘
```

## Header

- **Name**: `font-size: 16px`, `font-weight: 700`
- **agent_id**: monospace muted next to name
- **Category badge**: `.agent-category-badge.category-{category}` — values: `user`, `tool`, `system`
- **Role** *(optional)*: muted text on second line (below name row)
- **🗑 Delete**: visible if non-default. Red hover. Emit `agent-delete-requested`.
- **⊞/⊟ Expand**: toggle between 420px and 100% width
- **✕ Close**: emit `panel-close`

## Tabs

- **Info**: always present
- **Heartbeat**: instance context only (not in blueprint builder)
- **Config**: instance context only (not in blueprint builder)
- **Files**: shown if `agent.files.length > 0`. Single tab delegating to `cp-agent-file-editor`.

## Info Tab

All fields are always editable (save bar appears on first change):

| Field | Condition | Input type |
|---|---|---|
| **Name** | Always | text input |
| **Provider** | Instance context only | select (lazy-loaded) |
| **Model** | Instance context only | select (filtered by provider) |
| **Role** | Always | text input |
| **Tags** | Always | text input (CSV, e.g. `rh, legal`) |
| **Notes** | Always | textarea |
| **Skills** | Always | toggle All / Custom + comma-separated text if Custom |
| **Workspace** | Always | read-only |
| **Last sync** | If defined AND instance context | read-only |
| **Delegates to** | If outgoing spawn links OR available agents | editable spawn badges |
| **Delegated by** | If incoming spawn links | read-only badges |

## Spawn Link Management (inline)

- **Remove**: click ✕ on badge → pending-removal (strikethrough, red). Click ↩ → cancel.
- **Add**: click ＋ → dropdown of available agents → select → pending-add (green).
- **Save bar**: appears when any Info field or spawn link is dirty. [Save] / [Cancel].

## Heartbeat Tab *(instance only)*

- **Enable heartbeat** toggle. No further fields shown when disabled.
- When enabled:
  - **Scheduling**: Interval select (`5m` … `24h`)
  - **Active hours**: optional From/To time inputs. Empty = 24/7.
  - **Timezone**: text input (optional)
  - **Model override**: optional `provider/model` text input
  - **Max ack chars**: number input
  - **Custom prompt**: textarea (optional)
  - **History**: last 20 heartbeat ticks with timestamp + result excerpt
- [Save] / [Reset] buttons.

## Config Tab *(instance only)*

Full per-agent runtime config override. Sections:

| Section | Fields |
|---|---|
| **LLM** | Tool profile, Prompt mode, Max steps, Temperature, Extended thinking toggle + budget tokens |
| **Spawn** | Allow sub-agents toggle |
| **Timeouts** | Session timeout (ms), LLM inter-chunk timeout (ms) |
| **Instructions** | Remote instruction URLs (multi-entry) |
| **Workspace files** | Additional workspace file globs (multi-entry) |
| **Skills (expertIn)** | Skill names declared by this agent (multi-entry) |

[Save] / [Reset] buttons.

## File Tabs

`cp-agent-file-editor` renders all workspace files under a single "Files" tab.

**View mode:**
- `editable` (green) or `read-only` (gray) badge
- ✏ button if editable → switches to edit mode
- Content rendered as Markdown (marked + DOMPurify)

**Edit mode:**
- `EDITING` accent badge
- `Edit` / `Preview` tabs
- Resizable monospace textarea
- `Save` / `Cancel` buttons
- If Cancel with unsaved edits → "Discard changes?" confirmation dialog
- Same behavior if switching tabs with edits in progress

**Editable files**: AGENTS.md, SOUL.md, TOOLS.md, BOOTSTRAP.md, USER.md, HEARTBEAT.md
**Read-only files**: all others (MEMORY.md, etc.)

## Related

- Screens: [Agent Builder](../ux-screens/screen-agent-builder.md), [Blueprint Builder](../ux-screens/screen-blueprint-builder.md), [Instance Settings](../ux-screens/screen-instance-settings.md)
- Components: [Agent File Editor](comp-agent-file-editor.md)
