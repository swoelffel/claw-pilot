# Screen 2c — Runtime Pilot (`cp-runtime-pilot`)

> **Source**: `ui/src/components/runtime-pilot.ts`
> **Route**: `#/instances/:slug/pilot`

> Replaces `cp-runtime-chat` since v0.37.0. 18 components total.

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
│  ┌─ Messages ──────────────────────────┐  ┌─ pilot-context-panel ─┐│
│  │                             │  │  ◈  ⚙  ⬡  ☰  ⚡          ││
│  │  ┌─ user message ────────┐ │  │                          ││
│  │  │  My message           │ │  │  ┌─ active section ────┐ ││
│  │  └───────────────────────┘ │  │  │  (gauge / tools /   │ ││
│  │  ┌─ assistant message ───┐ │  │  │   agents / system / │ ││
│  │  │  part-text            │ │  │  │   events)           │ ││
│  │  │  part-tool (tool call)│ │  │  └─────────────────────┘ ││
│  │  │  part-reasoning       │ │  │                          ││
│  │  │  part-subtask         │ │  │                          ││
│  │  │  part-compaction      │ │  └──────────────────────────┘│
│  │  └───────────────────────┘ │                               │
│  │  ┌─ pilot-input ─────────┐ │                               │
│  │  │  [textarea]   [Send]  │ │                               │
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

### Components (18)

| Component | File | Role |
|---|---|---|
| `cp-runtime-pilot` | `runtime-pilot.ts` | Main container — nav bar, session management, SSE, layout |
| `cp-pilot-header` | `pilot/pilot-header.ts` | Session header — active agent name + model, status pill, stats, panel toggle |
| `cp-pilot-messages` | `pilot/pilot-messages.ts` | Scrollable message list |
| `cp-pilot-message` | `pilot/pilot-message.ts` | Message rendering (dispatches to part renderers) |
| `cp-pilot-input` | `pilot/pilot-input.ts` | Textarea + Send button |
| `cp-pilot-context-panel` | `pilot/pilot-context-panel.ts` | Right side panel — icon tab bar + section switcher |
| `cp-pilot-context-gauge` | `pilot/context/context-gauge.ts` | Token usage donut gauge + embedded system prompt viewer |
| `cp-pilot-context-prompt` | `pilot/context/context-prompt.ts` | System prompt viewer — parses prompt into collapsible sections (embedded in gauge tab) |
| `cp-pilot-context-tools` | `pilot/context/context-tools.ts` | Available tools list (built-in + MCP) |
| `cp-pilot-context-agents` | `pilot/context/context-agents.ts` | Agent teammates + spawn links |
| `cp-pilot-context-system` | `pilot/context/context-system.ts` | System prompt source files (SOUL.md, IDENTITY.md, etc.) |
| `cp-pilot-context-events` | `pilot/context/context-events.ts` | Real-time bus event log |
| `cp-pilot-part-text` | `pilot/parts/part-text.ts` | Markdown text rendering (marked + DOMPurify) |
| `cp-pilot-part-tool` | `pilot/parts/part-tool.ts` | Tool-call + tool-result rendering (collapsible) |
| `cp-pilot-part-reasoning` | `pilot/parts/part-reasoning.ts` | Anthropic extended thinking rendering |
| `cp-pilot-part-subtask` | `pilot/parts/part-subtask.ts` | Subagent rendering (spawn info + result) |
| `cp-pilot-part-compaction` | `pilot/parts/part-compaction.ts` | Compaction summary |
| `cp-session-tree` | `session-tree.ts` | Session hierarchy (parent/child) |

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
| Infra | `ping` | Keep-alive |
