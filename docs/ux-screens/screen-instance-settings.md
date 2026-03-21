# Screen 2b — Instance Settings View (`cp-instance-settings`)

> **Source**: `ui/src/components/instance-settings.ts`
> **Route**: `#/instances/:slug/settings`

Full configuration view of an instance. Accessible via the **Settings** button on the card. Two-column layout: fixed sidebar + content zone per panel (one section at a time).

## Mockup

```
┌─ Header bar ──────────────────────────────────────────────────┐
│  ← Back   default — Settings          [Cancel]  [Save]        │
└───────────────────────────────────────────────────────────────┘
┌─ Layout ──────────────────────────────────────────────────────┐
│  ┌─ Sidebar ──┐  ┌─ Content (active panel) ───────────────┐  │
│  │  General   │  │  ┌─ GENERAL ──────────────────────────┐ │  │
│  │  Agents    │  │  │  Display name  Port (readonly)      │ │  │
│  │  Runtime   │  │  │  Default model (select grouped)     │ │  │
│  │  Channels  │  │  │  Tools profile (select)             │ │  │
│  │  MCP  [3]  │  │  │  PROVIDERS                          │ │  │
│  │  Permissions│ │  │  [Anthropic]  sk-ant-***  [Change]  │ │  │
│  │  Config    │  │  │  [+ Add provider]                   │ │  │
│  └────────────┘  │  └─────────────────────────────────────┘ │  │
│                  └──────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

## Panel Navigation Principle

Click on sidebar item → **replaces** content with corresponding panel (no scroll). Single section visible at a time. Default active section: **General** (or `initialSection` passed as prop).

## Header Bar

Always visible. Background `--bg-surface`, bottom border.

| Element | Description |
|---|---|
| **← Back** | Gray outline, accent hover. Emit `navigate { slug: null }` → return to Instances view. |
| **Title** | "**slug** — Settings" (`font-size: 16px`, `font-weight: 700` on slug). |
| **[Cancel]** | Visible if `_hasChanges`. Cancels all dirty modifications. |
| **[Save]** | Visible if `_hasChanges`. Disabled if validation error or `_saving`. Calls `PATCH /api/instances/:slug/config`. |

## Sidebar

Navigation through 7 panels: **General**, **Agents**, **Runtime**, **Channels**, **MCP**, **Permissions**, **Config**. Active item: `--accent-subtle` background, `--accent` color, `font-weight: 600`. Click → `_activeSection = section` (immediate content swap).

**Numeric badges** on sidebar items:

| Item | Badge | Condition |
|---|---|---|
| **MCP** | Accent numeric | Number of connected MCP servers (`_mcpConnectedCount > 0`) |
| **Permissions** | Accent numeric | Number of pending permission requests (`_pendingPermissionsCount > 0`) |

## Modified Fields

Modified fields display `--accent` border (class `changed`). Read-only fields have `--bg-surface` background.

## General Section

2-column grid.

| Field | Type | Behavior |
|---|---|---|
| **Display name** | Text input | Editable |
| **Port** | Read-only | Not modifiable (`:XXXXX`) |
| **Default model** | Select grouped by provider | Options grouped by configured provider. If current model not in list, added as isolated option. |
| **Tools profile** | Select | Options: `minimal`, `messaging`, `coding`, `full` |

**Providers subsection**: list of configured providers. Each provider: card with name, monospace ID, env var, masked key + **[Change]** button (inline edit) or **[Cancel]**. **[Remove]** button disabled if provider used by default model. **[+ Add provider]** button → select available providers (not yet configured).

## Agents Section

**Defaults** (2-column grid):

| Field | Type |
|---|---|
| Default workspace | Text input |
| Max concurrent subagents | Number input (1–20) |
| Archive after (min) | Number input |
| Compaction mode | Select: `auto`, `manual`, `off` |
| Heartbeat interval | Text input. Validation: format `30m`, `1h`, `1h30m`. Bare number auto-corrected → `Xm` on blur. Inline error if invalid format. |
| Heartbeat model | Select grouped by provider (+ "— none —" option) |

**Agents — List**: agent table (ID, Name, Model, Workspace, **Actions**). Displayed if `agents.length > 0`.

**Actions** column contains ✏ button (pencil icon SVG) per agent. Click → load agent data via API and open `cp-agent-detail-panel` in **side drawer**:

```
┌─ Semi-transparent backdrop ────────────────────────────────────┐
│                              ┌─ Drawer (420px fixed right) ──┐ │
│                              │  cp-agent-detail-panel        │ │
│                              │  (same component as canvas)   │ │
│                              └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Backdrop** | `position: fixed; inset: 0; background: rgba(0,0,0,0.35)`. Click → close drawer. |
| **Drawer** | `position: fixed; top: 0; right: 0; width: 420px; height: 100vh`. Changes to `width: 100vw` if panel in expanded mode. |
| **Panel** | `cp-agent-detail-panel` with context `{ kind: "instance", slug }`. Same behavior as on canvas (Info + files tabs, spawn links, editing). |
| **Closing** | Event `panel-close` from panel OR backdrop click. |
| **Expand** | Event `panel-expand-changed` → drawer goes fullscreen. |
| **Update** | Event `agent-meta-updated` → reload panel AND instance config. |

## Runtime Section

Informational panel + link to the Pilot view. No editable fields (Save/Cancel not shown when active).

```
┌─ Runtime ─────────────────────────────────────────────────────┐
│  This instance runs on claw-runtime — the native claw-pilot   │
│  agent engine.                                                │
│                                                               │
│  Engine      claw-runtime                                     │
│  Config file runtime.json                                     │
│                                                               │
│  ── Pilot ─────────────────────────────────────────────────── │
│  [Open Pilot ↗]                                               │  ← navigates to #/instances/:slug/pilot
└───────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Engine** | Fixed value `claw-runtime`, monospace |
| **Config file** | Fixed value `runtime.json`, monospace muted |
| **Open Pilot** | `btn btn-primary` — navigates to `#/instances/:slug/pilot` (`cp-runtime-pilot`). Replaced the embedded `cp-runtime-chat` since v0.37.0. |

## Confirmation Toast

Appears bottom-right (`position: fixed`, `bottom: 80px`, `right: 24px`) for 4s after saving.

| Type | Color | Message |
|---|---|---|
| **success** | Green | "Configuration saved — hot-reload applied" |
| **warning** | Amber | "Configuration saved — instance restarted (reason)" |
| **error** | Red | Error message |

**Port changed warning**: if port changed, `⚠` banner displays under header: "Port changed — browser pairing will be lost after restart. Go to the Devices tab to approve the new request."

## Sub-components

### Channels Section (`cp-instance-channels`)

> **Source**: `ui/src/components/instance-channels.ts`

Standalone panel — no global Save/Cancel (inline save per channel). Displays one card per communication channel.

**Telegram State Machine (3 states):**

| State | Condition | Rendering |
|---|---|---|
| **A — unconfigured** | `channels.telegram === null` OR `enabled=false` without token | "Telegram is not configured" + **[Configure Telegram]** button |
| **B — init-form** | Click on [Configure Telegram] | Inline initialization form |
| **C — configured** | `enabled=true` OR token present | Full edit form |

**State A — Unconfigured:**

```
┌─ ✈ Telegram Bot ─────────────────────── ○ Inactive ─┐
│  Telegram is not configured for this instance.       │
│                              [Configure Telegram]    │
└──────────────────────────────────────────────────────┘
```

**State B — Initialization Form:**

```
┌─ ✈ Telegram Bot ─────────────────────────────────────┐
│  Bot token *  [_________________________]  [BotFather ↗] │
│  DM policy    [Pairing (code approval) ▼]            │
│  Group policy [Allowlist               ▼]            │
│                                  [Cancel]  [Add]     │
└──────────────────────────────────────────────────────┘
```

**State C — Configured:**

```
┌─ ✈ Telegram Bot [N] ─────────────── ● Configured ───┐
│  [toggle] Enabled                                    │
│  Bot token  [sk-***masked***]  [Change]  [×]         │
│  DM policy  [Pairing ▼]                              │
│  Group policy [Allowlist ▼]                          │
│                                                      │
│  ── Pairing requests ──────────────────── [Refresh] ─│
│  @username  Code: 1234-5678  2m ago  [Approve] [Reject]│
│  Approved senders: 3                                 │
│                                                      │
│  [Restart banner if requiresRestart]                 │
│                              [Cancel]  [Save]        │
└──────────────────────────────────────────────────────┘
```

| Field | Values |
|---|---|
| **DM policy** | `pairing` (code approval) / `open` (allow all) / `allowlist` / `disabled` |
| **Group policy** | `open` (allow all groups) / `allowlist` / `disabled` |

**Pending badge**: red number on "Telegram Bot" title if pairing requests pending.

**Status badge**: `● Configured` (green) if enabled + token present; `◎ No token` (amber) if enabled without token; `○ Inactive` (gray) if disabled.

**Restart banner**: amber background, message "Changes require a runtime restart to take effect." + **[Restart runtime]** button.

**Pairing requests**: visible only if `dmPolicy === "pairing"`. Polling every 10s if requests pending. **[Approve]** and **[Reject]** buttons per request.

**"Coming soon" channels**: WhatsApp and Slack displayed in gray cards `opacity: 0.55` with "COMING SOON" badge.

### MCP Section (`cp-instance-mcp`)

> **Source**: `ui/src/components/instance-mcp.ts`

Standalone panel — no Save/Cancel. Displays MCP servers connected to the claw-runtime instance.

```
┌─ MCP ─────────────────────────────────────────────────┐
│                                                       │
│  CONNECTED [3] ────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────┐ │
│  │  ● my-server    stdio   5 tools  [Tools ▾]       │ │
│  │  ● web-search   http    3 tools  [Tools ▾]       │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  DISCONNECTED [1] ─────────────────────────────────── │
│  ┌──────────────────────────────────────────────────┐ │
│  │  ○ old-server   stdio   0 tools                  │ │
│  │    ⚠ Connection refused                          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  [↻ Refresh]                                          │
└───────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **CONNECTED group** | Green title + green count badge. Servers with `connected: true`. |
| **DISCONNECTED group** | Gray title + gray count badge. Servers with `connected: false`. |
| **Server line** | Green/gray dot + name + type badge (`stdio`/`http`) + tool count + **[Tools ▾]** button if tools available |
| **Expand tools** | 2-column grid, `--bg-hover` background, monospace names |
| **Server error** | Red `⚠ message` below line if `lastError` defined |
| **[↻ Refresh]** | Manual reload |

**Polling**: every 30s when panel is active.

**Sidebar badge**: number of connected servers (`mcp-connected-count-changed` event).

### Permissions Section (`cp-instance-permissions`)

> **Source**: `ui/src/components/instance-permissions.ts`

Standalone panel — no Save/Cancel. Displays persisted permission rules and pending requests.

```
┌─ PERMISSIONS ─────────────────────────────────────────┐
│                                                       │
│  ┌─ PENDING REQUESTS (2) ────────────────────────────┐│
│  │  Bash  /tmp/**  2m ago  [Handle]                  ││
│  │  Read  ~/docs/* 5m ago  [Handle]                  ││
│  └───────────────────────────────────────────────────┘│
│                                                       │
│  PERSISTENT RULES (3)                                 │
│  Approved by user — survive restarts                  │
│  ┌──────────────────────────────────────────────────┐ │
│  │  [allow]  Bash  /tmp/**   global  2h ago  [✕]   │ │
│  │  [deny]   Read  ~/secret  agent1  1d ago  [✕]   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  [↻ Refresh]                                          │
└───────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Pending requests** | Transparent amber background, amber border. Visible if `action === "ask"`. **[Handle]** button → emit `open-permission-overlay` to open global overlay. |
| **Persistent rules** | `allow`/`deny` rules. Colored action badge (green/red). Columns: action, permission, pattern, scope, relative age, **[✕]** button (revoke). |
| **Revoke** | Call `DELETE /api/instances/:slug/runtime/permissions/:id`. Inline spinner during operation. |
| **[↻ Refresh]** | Manual reload |

**Sidebar badge**: number of pending requests (`_pendingPermissionsCount`).

### Config Section (`cp-instance-config`)

> **Source**: `ui/src/components/instance-config.ts`

Advanced runtime configuration panel. Sub-navigation via tabs. Save/Cancel specific to panel (independent of global Save).

```
┌─ CONFIG ──────────────────────────────────────────────┐
│  [Models]  [Compaction]  [Sub-agents]                 │
│  ─────────────────────────────────────────────────── │
│  (content by active tab)                              │
│                                                       │
│  [Save]  [Cancel]  ← visible if dirty                 │
└───────────────────────────────────────────────────────┘
```

**Models Tab:**

| Field | Description |
|---|---|
| **Internal model** | Text input. Model used for compaction and summaries (e.g., `anthropic/claude-haiku-3-5`). |
| **Model aliases** | Alias list (id → provider + model). Each alias: 3 inline inputs (alias, provider, model) + **[✕]** button. **[+ Add alias]** button at bottom. |

**Compaction Tab:**

| Field | Description |
|---|---|
| **Threshold** | Slider 50–99%. Context window percentage before triggering. |
| **Reserved tokens** | Number input 1000–32000. Tokens reserved for summary. |

**Sub-agents Tab:**

| Field | Description |
|---|---|
| **Max spawn depth** | Slider 0–10. Maximum subagent nesting depth. |
| **Max active children per session** | Slider 1–20. Maximum subagents active simultaneously per session. |

## Related

- Components: [Agent Detail Panel](../ux-components/comp-agent-detail-panel.md)
- Screens: [Runtime Pilot](screen-runtime-pilot.md)
