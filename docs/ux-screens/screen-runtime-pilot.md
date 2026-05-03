# Screen 2c — Runtime Pilot (`cp-runtime-pilot`)

> **Source**: `ui/src/components/runtime-pilot.ts` (root) + `ui/src/components/pilot/` (sub-folder)
> **Route**: `#/instances/:slug/pilot`

> Replaces `cp-runtime-chat` since v0.37.0. The originally-monolithic pilot has been split (since v0.78+) into a thin root container that owns nav-bar + session detection + SSE wiring, plus a `pilot/` sub-folder of focused sub-components. See "Sub-architecture" below.

Advanced chat view with LLM context panel on side. Full-height flex column layout (no scroll on `<main>`).

## Mockup

```
┌─ cp-runtime-pilot ────────────────────────────────────────────────┐
│  ┌─ nav-bar ──────────────────────────────────────────────────┐   │
│  │  ← Back  /  cpteam  /  Pilot  Lead Marketing  Lead Tech   │   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌─ pilot-header ─────────────────────────────────────────────┐   │
│  │  ● pilot  ·  sonnet-4-5  ·  ● idle  12 msgs  45.2k  $0.12  [⊞]│   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌─ pilot-filter-bar ─────────────────────────────────────────┐   │
│  │  [tools] [reasoning] [subtasks]  · per-type visibility      │   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌─ Messages (pilot-messages) ─────────┐  ┌─ pilot-context-panel ─┐│
│  │                             │  │  ◈  ⚙  ⬡  ☰  ⚡          ││
│  │  ┌─ user message ────────┐ │  │                          ││
│  │  │  My message           │ │  │  ┌─ active section ────┐ ││
│  │  └───────────────────────┘ │  │  │  (gauge / tools /   │ ││
│  │  ┌─ assistant message ───┐ │  │  │   agents / system / │ ││
│  │  │  part-text            │ │  │  │   events)           │ ││
│  │  │  part-artifact (card) │ │  │  └─────────────────────┘ ││
│  │  │  part-tool (tool call)│ │  │                          ││
│  │  │  part-image           │ │  │                          ││
│  │  │  part-reasoning       │ │  │                          ││
│  │  │  part-subtask         │ │  │                          ││
│  │  │  part-question        │ │  │                          ││
│  │  │  part-compaction      │ │  └──────────────────────────┘│
│  │  │  part-suggestion      │ │                               │
│  │  └───────────────────────┘ │                               │
│  │  ┌─ pilot-input ─────────┐ │                               │
│  │  │ [📎] [textarea] [⏹/▶]│ │                               │
│  │  └───────────────────────┘ │                               │
│  └─────────────────────────────┘                               │
└───────────────────────────────────────────────────────────────────┘
```

## Nav Bar

Single line at the top of `cp-runtime-pilot`. CSS class `.nav-bar`, `min-height: 48px`, `background: --bg-surface`, bottom border. Structure:

```
← Back  /  cpteam  /  Pilot  Lead Marketing  Lead Tech  Lead Product
```

| Element | CSS class | Description |
|---|---|---|
| **← Back** | `.nav-back` | Ghost button, muted text → hover primary. Dispatches `back` custom event (`bubbles`, `composed`) captured by `app.ts` → return to cluster view. |
| **Separators** | `.nav-sep` | `/` in `--bg-border` color, non-selectable |
| **Slug** | `.nav-slug` | Monospace, `font-weight: 600`, max-width `160px` with ellipsis |
| **Agent tabs** | `.agent-tabs > .agent-tab` | Visible only if `_permanentSessions.length > 1`. Compact pills `font-size: 12px`, monospace. Active tab: `.active` → `--bg-hover` background + `--bg-border` border + `font-weight: 600`. Clicking a tab calls `_switchSession(sessionId)`. |

**Agent tab sort order**: default agent (`agentIsDefault = true`) first, then by `updatedAt` descending. This ensures the primary/pilot agent is always the first tab.

**Back navigation** in `app.ts`:
```typescript
<cp-runtime-pilot
  .slug=${pilotSlug}
  style="height:100%;"
  @back=${() => { this._route = { view: "cluster" }; }}
></cp-runtime-pilot>
```

## Sub-components

### Pilot Header (`cp-pilot-header`)

> **Source**: `ui/src/components/pilot/pilot-header.ts`

Below the nav bar. `min-height: 44px`, bottom border.

```
● pilot  ·  sonnet-4-5  ·  ● idle  ·  12 msgs  45.2k tok  $0.12  [⊞]
```

| Element | Description |
|---|---|
| **● dot** | Colored dot — `--accent` by default, overridable via `agentColor` prop |
| **Agent name** | `agentName` prop, monospace, `font-weight: 700` |
| **Model** | Short model name (after last `/`): `"anthropic/claude-sonnet-4-5"` → `"sonnet-4-5"`, monospace `--text-muted` |
| **Status pill** | `.status-pill.{status}` — states: `idle`, `loading`, `sending`, `streaming`, `error`. `sending`/`streaming`/`loading` have pulsing dot. |
| **Stats** | Cumulative counts (hidden if zero): `N msgs`, `N.Nk tok`, `$N.NN` |
| **⊞ panel toggle** | Ghost button, active when panel open. Emits `toggle-panel` custom event. |

### Permanent Session Detection

On mount, `_detectPermanentSession()` calls `GET /api/instances/:slug/runtime/sessions` and filters `persistent=true AND state="active"`. Results are sorted:
1. `agentIsDefault = true` first
2. Then by `updatedAt` descending

The first session in the sorted list becomes `_activeSessionId`. The full sorted list populates `_permanentSessions` (drives agent tabs visibility).

### Context Panel (`cp-pilot-context-panel`)

> **Source**: `ui/src/components/pilot/pilot-context-panel.ts`

Retractable right panel. Toggled by the `⊞` button in the pilot header. Five icon+label tabs:

| Tab id | Icon | Label | Content component |
|---|---|---|---|
| `gauge` | `◈` | Context | `cp-pilot-context-gauge` — token donut + system prompt viewer |
| `tools` | `⚙` | Tools | `cp-pilot-context-tools` — available tools list (built-in + MCP) |
| `agents` | `⬡` | Agents | `cp-pilot-context-agents` — teammates + spawn links |
| `system` | `☰` | System | `cp-pilot-context-system` — system prompt source files |
| `events` | `⚡` | Events | `cp-pilot-context-events` — real-time bus event log |

Default active section: `gauge`.

## Sub-architecture

The Runtime Pilot is composed of three layers:

1. **Root** — `runtime-pilot.ts` owns the nav-bar, permanent-session detection, SSE wiring, and the overall flex layout.
2. **Top-level sub-components** in `ui/src/components/pilot/` — header / filter bar / messages list / message bubble / input / context panel.
3. **Leaf renderers**:
   - `ui/src/components/pilot/parts/` — one file per part type (text, tool, reasoning, subtask, image, artifact, question, suggestion, compaction, file).
   - `ui/src/components/pilot/context/` — one file per context-panel tab (gauge, system, tools, agents, events, prompt).

`pilot/timeline-utils.ts` is a pure-function helper module (no element) used by `pilot-messages` to build/condense the rendered timeline.

### Top-level pilot files

| File | Role |
|---|---|
| `runtime-pilot.ts` | Root container — nav bar, session management, SSE, layout |
| `pilot/pilot-header.ts` | Session header — agent name + model, status pill, stats, panel toggle |
| `pilot/pilot-filter-bar.ts` | Above-messages filter chips (e.g. hide tool calls, hide reasoning) |
| `pilot/pilot-messages.ts` | Scrollable message list — virtualization + auto-scroll |
| `pilot/pilot-message.ts` | Single message bubble — dispatches per-part rendering |
| `pilot/pilot-input.ts` | Textarea + 📎 attach + Send/Stop toggle |
| `pilot/pilot-context-panel.ts` | Right panel — icon tab bar + section switcher |
| `pilot/timeline-utils.ts` | Pure helpers used by `pilot-messages` |

### Part renderers (`pilot/parts/`)

| File | Part type | Notes |
|---|---|---|
| `part-text.ts` | `text` | Markdown via `marked` + DOMPurify |
| `part-tool.ts` | `tool_call` | Generic tool call/result, collapsible |
| `part-reasoning.ts` | `reasoning` | Anthropic extended thinking ([doc](../ux-components/comp-pilot-part-reasoning.md)) |
| `part-subtask.ts` | `subtask` | Subagent spawn + result |
| `part-image.ts` | `image` | Thumbnail + zoom overlay ([doc](../ux-components/comp-pilot-part-image.md)) |
| `part-artifact.ts` | `artifact` (routed from `tool_call`) | Rich card with copy button ([doc](../ux-components/comp-pilot-part-artifact.md)) |
| `part-question.ts` | `question` (routed from `tool_call`) | Interactive question ([doc](../ux-components/comp-pilot-part-question.md)) |
| `part-suggestion.ts` | `suggestion` | Follow-up chips ([doc](../ux-components/comp-pilot-part-suggestion.md)) |
| `part-compaction.ts` | `compaction` | Compaction marker |
| `part-file.ts` | file attachment | Inline file pill (download / preview) |
| `part-delegation-expand.ts` | delegation drill-down | Inline expand of nested sub-sessions ([doc](../ux-components/comp-pilot-part-delegation-expand.md)) |

### Context tabs (`pilot/context/`)

| File | Tab id | Content |
|---|---|---|
| `context-gauge.ts` | `gauge` | Token usage donut + system prompt viewer |
| `context-prompt.ts` | (embedded) | System prompt parser — collapsible sections |
| `context-tools.ts` | `tools` | Built-in + MCP tools list |
| `context-agents.ts` | `agents` | Teammates + spawn graph |
| `context-system.ts` | `system` | System prompt source files (SOUL.md, IDENTITY.md, etc.) |
| `context-events.ts` | `events` | Real-time bus event log |

The session tree (`cp-session-tree`, top-level) is reused by `pilot/parts/part-subtask` to show nested delegation.

## Extended SSE Stream (17+ event types)

SSE opened via `GET /api/instances/:slug/runtime/chat/stream`. Events:

| Category | SSE Events | Behavior |
|---|---|---|
| Messages | `message.created`, `message.updated`, `message.part.delta` | Text streaming, part accumulation |
| Session | `session.created`, `session.updated`, `session.ended`, `session.status` | Manage idle/busy/retry state |
| Permission | `permission.asked`, `permission.replied` | Permission overlay |
| Provider | `provider.auth_failed`, `provider.failover` | Bus alerts |
| Subagent | `subagent.completed`, `agent.timeout` | part-subtask update |
| Heartbeat | `heartbeat.tick`, `heartbeat.alert` | Bus alerts |
| Tool | `tool.doom_loop`, `llm.chunk_timeout` | Bus alerts |
| Suggestions | `suggestions.generated` | Refresh messages to show suggestion chips |
| Infra | `ping` | Keep-alive |

## Input Features (v0.51.0+)

### File Upload

The input bar includes a 📎 attach button (left of textarea). Clicking opens a file picker (`accept="image/*"`). Drag & drop is also supported on the textarea area.

Selected files appear as `56×56px` thumbnail previews above the input with a remove (✕) button per preview. Max file size: 20 MB. Files are sent as base64-encoded attachments in the `send-message` event detail (`files: [{ name, mimeType, data }]`).

### Send / Stop Toggle

| State | Button | Behavior |
|---|---|---|
| `idle` | **Send** (primary blue) | Sends message + files |
| `sending` / `streaming` | **Stop** (danger red ■) | Dispatches `abort-request` → POST abort → optimistic idle restore |
| `error` | **Send** (primary) | Textarea re-enabled, error banner shown |

The `streaming` property is set by `cp-runtime-pilot` based on `_status === "sending" \|\| _status === "streaming"`.

## Message Part Types (9)

| Part Type | Component | Description |
|---|---|---|
| `text` | `cp-pilot-part-text` | Markdown text rendering |
| `artifact` | `cp-pilot-part-artifact` | Rich card for `create_artifact` tool (header + content + copy) |
| `tool_call` | `cp-pilot-part-tool` | Generic tool call/result (collapsible) |
| `image` | `cp-pilot-part-image` | Image thumbnail + zoom |
| `reasoning` | `cp-pilot-part-reasoning` | Extended thinking (collapsible) |
| `subtask` | `cp-pilot-part-subtask` | Sub-agent delegation info |
| `question` | `cp-pilot-part-question` | Interactive question (routed from `tool_call` when `toolName === "question"`) |
| `compaction` | `cp-pilot-part-compaction` | Context compaction marker |
| `suggestion` | `cp-pilot-part-suggestion` | Follow-up suggestion chips (clickable) |

Note: `artifact` and `question` parts are actually stored as `tool_call` parts in the database. The `_renderPart()` method in `cp-pilot-message` checks `toolName` in the metadata and dispatches to the specialized component instead of the generic `cp-pilot-part-tool`.
