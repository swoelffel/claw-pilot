# UX Design — claw-pilot

Visual and behavioral reference for all screens and components of the application.
Serves as the foundation for interface evolution discussions.

> **Source components**: `ui/src/components/`  
> **Shared styles**: `ui/src/styles/tokens.ts` + `ui/src/styles/shared.ts`  
> **Stack**: Lit web components, dark theme, CSS custom properties  
> **Reference screenshots**: `screen1.png` (Agent Builder), `screen2.png` (Instances View)

---

## Global style tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0f1117` | Page background |
| `--bg-surface` | `#1a1d27` | Cards, panels, dialogs |
| `--bg-hover` | `#1e2130` | Hover on items |
| `--bg-border` | `#2a2d3a` | Borders |
| `--text-primary` | `#e2e8f0` | Headings, important values |
| `--text-secondary` | `#94a3b8` | Body text |
| `--text-muted` | `#64748b` | Labels, metadata |
| `--font-ui` | `Geist`, `-apple-system`, `sans-serif` | Primary font |
| `--font-mono` | `Geist Mono`, `monospace` | Technical values |
| `--accent` | `#4f6ef7` | Primary blue (CTA, selection) |
| `--accent-hover` | `#6b85f8` | Blue hover |
| `--accent-subtle` | `rgba(79,110,247,0.08)` | Light accent background |
| `--accent-border` | `rgba(79,110,247,0.25)` | Accent border |
| `--state-running` | `#10b981` | Running, success |
| `--state-stopped` | `#64748b` | Stopped |
| `--state-error` | `#ef4444` | Error, danger |
| `--state-warning` | `#f59e0b` | Amber — warning |
| `--state-info` | `#0ea5e9` | Cyan — info |
| `--focus-ring` | `0 0 0 2px rgba(79,110,247,0.5)` | Focus outline |
| `--radius-sm` | `4px` | Badges, small elements |
| `--radius-md` | `8px` | Buttons, inputs |
| `--radius-lg` | `12px` | Cards, dialogs |

---

## Screen 0 — Login (`cp-login-view`)

**Source file**: `ui/src/components/login-view.ts`

Displayed instead of the entire application if the user is not authenticated (or session expired). Centered vertically and horizontally on `min-height: 100vh`.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              ┌─ Card (max-width 360px) ──────────────────┐     │
│              │                                           │     │
│              │           Claw Pilot                      │     │
│              │                                           │     │
│              │  [Bandeau session expirée — ambre]        │     │
│              │  (conditionnel)                           │     │
│              │                                           │     │
│              │  Username                                 │     │
│              │  [admin                          ]        │     │
│              │                                           │     │
│              │  Password                                 │     │
│              │  [                               ]        │     │
│              │                                           │     │
│              │  [Sign in]                                │     │
│              │                                           │     │
│              │  (message d'erreur si échec)              │     │
│              │                                           │     │
│              │  v0.41.24                                 │     │
│              └───────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Elements

| Element | Description |
|---|---|
| **Title** | "Claw**Pilot**" — accent span on "Pilot", `font-size: --text-xl`, `font-weight: 700`, centered |
| **Session expired banner** | Amber background `rgba(245,158,11,0.1)`, amber border. Visible if prop `sessionExpired = true`. Message: "Your session has expired. Please sign in again." |
| **Username** | Text input, pre-filled with `"admin"` |
| **Password** | Password input, autofocus on open |
| **[Sign in]** | Full button `--accent`, width 100%, `min-height: 44px`. Shows "…" during submission. |
| **Error** | Red text centered below button. Messages: "Invalid credentials" (401), "Too many attempts. Please wait a moment." (429), "An error occurred. Please try again." (others). |
| **Version** | `v{APP_VERSION}` monospace muted, centered, `font-size: 11px` |

### Behaviors

- `Enter` in any field → submit form
- During submission: button disabled
- Success: emits `authenticated { token }` → `cp-app` stores token and initializes app
- Card has `background: --bg-surface`, `border: 1px solid --bg-border`, `border-radius: 8px`, `padding: 32px`

---

## Hash-based routing

Since v0.7.1, navigation uses hash URLs (`#/...`). Browser back/forward and page refresh work correctly.

| Hash URL | Rendered view | Component |
|---|---|---|
| `#/` or `#/instances` | Instances view (home) | `cp-cluster-view` |
| `#/instances/:slug/builder` | Agent builder | `cp-agents-builder` |
| `#/instances/:slug/settings` | Instance settings | `cp-instance-settings` |
| `#/instances/:slug/pilot` | Interactive chat + LLM context panel | `cp-runtime-pilot` |
| `#/blueprints` | Blueprints view | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | Blueprint builder | `cp-blueprint-builder` |
| `#/agent-templates` | Agent templates (reusable agent blueprints) | `cp-agent-templates-view` |
| `#/agent-templates/:id` | Agent template detail + file editing | `cp-agent-template-detail` |

Navigation between views emits `navigate { view, slug?, blueprintId?, templateId? }` events captured by `app.ts`, which updates the hash URL and renders the corresponding component.

---

## Global navigation (`app.ts`)

Fixed navigation bar at top of page (`height: 56px`, `background: --bg-surface`).

```
┌─────────────────────────────────────────────────────────────────────┐
│  ClawPilot   Instances [2]   Blueprints [3]   Templates [5]  ● Live  [Sign out]│
└─────────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Logo** | "Claw**Pilot**" (accent span on "Pilot") — click → Instances view |
| **Instances** | Active tab if cluster view, agents-builder, or instance-settings. Numeric badge if `instanceCount > 0`. |
| **Blueprints** | Active tab if blueprints or blueprint-builder view. Numeric badge if `blueprintCount !== null && blueprintCount > 0`. |
| **Templates** | Active tab if agent-templates or agent-template-detail view. Numeric badge if `agentTemplateCount !== null && agentTemplateCount > 0`. Links to `#/agent-templates`. |
| **WS indicator** | Green dot (`--state-running`) + "Live" if connected; red dot (`--state-error`) + "Offline" if disconnected. |
| **Sign out** | Gray outline button, red hover (`--state-error`). Calls `POST /api/auth/logout` then resets local state. |

**Footer** (`height: 48px`, `background: --bg-surface`):

```
┌─────────────────────────────────────────────────────────────────┐
│  ClawPilot  [v0.41.24]  ·  GitHub  ·  Issues    🌐 EN ▾  ·  © 2026 SWO — MIT License │
└─────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **ClawPilot** | Brand with accent span, `font-weight: 600` |
| **[vX.Y.Z]** | Accent monospace version badge (`--accent-subtle`, `--accent-border`) |
| **GitHub** | Link `https://github.com/swoelffel/claw-pilot`, `target="_blank"` |
| **Issues** | Link `https://github.com/swoelffel/claw-pilot/issues`, `target="_blank"` |
| **Language selector** | Button `🌐 XX ▾` — opens dropdown above with 6 available languages. Outside click closes dropdown. |
| **© year SWO** | Muted text with "MIT License" |

### claw-pilot update banner (`cp-self-update-banner`)

Component `<cp-self-update-banner>` displayed **at top of `<main>`**, above all views (cluster, blueprints, settings…). Light wrapper around `<cp-update-banner-base>`.

```
┌─────────────────────────────────────────────────────────────────┐
│  [nav header]                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─ claw-pilot update banner (conditional) ──────────────────┐ │
│  │  ↑ claw-pilot update available  v0.12.0   [Update claw-pilot]│ │
│  └─────────────────────────────────────────────────────────────┘ │
│  [active view content]                                          │
└─────────────────────────────────────────────────────────────────┘
```

| State | Style | Content |
|---|---|---|
| **idle + updateAvailable** | Amber (`--state-warning`) | "claw-pilot update available vX.Y.Z" + current version + **[Update claw-pilot]** button |
| **running** | Cyan (`--state-info`) | Spinner + "Updating claw-pilot…" + "This may take several minutes (git + build)" |
| **done** | Green (`--state-running`) | "claw-pilot updated → vX.Y.Z" + "Dashboard service restarted" + **[×]** button (dismiss) |
| **error** | Red (`--state-error`) | "claw-pilot update failed" + error message + **[Retry]** button |

**Polling**: immediate check on startup + every 60s. Accelerated to 3s during `status === "running"`.

**Post-done**: automatic `location.reload()` after 2s (loads new JS bundle). If reload doesn't happen (slow restart, network issue), **×** button allows manual banner close.

**Event**: Update/Retry button emits `cp-update-action` (bubbles + composed) → captured by `cp-app` via `@cp-update-action` on `<main>`.

**Version source**: GitHub Releases API (`/repos/swoelffel/claw-pilot/releases/latest`). Standard semver comparison.

---

## Shared Component: Update Banner (`cp-update-banner-base`)

**Source file**: `ui/src/components/update-banner-base.ts`

Base Lit component factoring CSS and HTML structure for the claw-pilot update banner. Not used directly — instantiated via the `cp-self-update-banner` wrapper.

### Props

| Prop | Type | Description |
|---|---|---|
| `status` | `SelfUpdateStatus \| null` | Update status passed by the wrapper |
| `productName` | `string` | Product name displayed in messages (e.g., `"claw-pilot"`) |
| `buttonLabel` | `string` | Action button label (idle+updateAvailable state) |
| `runningSubtitle` | `string` | Subtitle displayed during running state |
| `doneSubtitle` | `string` | Subtitle displayed after success (done state) |
| `dismissable` | `boolean` | If `true`, displays × button on done state |

### Emitted Events

| Event | Condition | Description |
|---|---|---|
| `cp-update-action` | Update or Retry click | Bubbles + composed. Captured by wrapper which re-emits. |
| `cp-update-dismiss` | × click (if dismissable) | Bubbles + composed. Local dismiss (state `_dismissed`). |

### Dismiss Behavior

- The `_dismissed` state is local to the component (property `@state`).
- It automatically resets if `status` changes (new update cycle).
- Dismiss is purely visual — no API calls.

### Design System

Same tokens as the rest of the application:

| State | Color | Token |
|---|---|---|
| warning (update available) | Amber | `--state-warning` (#f59e0b) |
| info (in progress) | Cyan | `--state-info` (#0ea5e9) |
| success (done) | Green | `--state-running` (#10b981) |
| error | Red | `--state-error` (#ef4444) |

Spinner: `border: 2px solid currentColor`, `border-top-color: transparent`, `animation: spin 0.7s linear infinite`.  
Version tags: `font-family: var(--font-mono)`, `font-size: 12px`, `font-weight: 600`.

---

## Screen 1 — Instances View (`cp-cluster-view`)

**Source file**: `ui/src/components/cluster-view.ts`

Home page. Grid of instance cards. `padding: 24px`.

```
┌─────────────────────────────────────────────────────────────────┐
│  2 instances                          [+ New Instance]          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Instance Card   │  │  Instance Card   │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### States

| State | Rendering |
|---|---|
| **Loading** | Centered text "Loading instances..." (early return — header not shown) |
| **Error** | Red error banner at top, empty grid |
| **Empty** | Icon + "No instances found" centered + **[Discover instances]** button |
| **Normal** | Header "N instances" + grid `auto-fill minmax(300px, 1fr)`, gap 16px |

**Empty state — detail:**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    ▪                                            │
│              No instances found                                 │
│                                                                 │
│              [Discover instances]                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The **[Discover instances]** button (`btn btn-secondary`) opens the `cp-discover-dialog` which scans the system for existing claw-runtime instances and offers to adopt them.

### Interactions

- **Click on a card** → navigate to Instance Detail view
- **"+ New Instance" button** → open creation dialog (`cp-create-dialog`)
- After creation: close dialog + reload list

---

## Component: Instance Card (`cp-instance-card`)

**Source file**: `ui/src/components/instance-card.ts`

```
┌────────────────────────────────────────────┐
│  My instance    ⚡ runtime  ● running  [···]  │  ← header
│  default                                       │
├────────────────────────────────────────────┤
│  ◉ Gateway  ✈ @my_bot  ⬡ 11 agents  ⚠ PERM   │  ← status bar
├────────────────────────────────────────────┤
│  anthropic/claude-sonnet-4-5                   │  ← model
│  :18789                                        │  ← port
│                                                │
│  (error message if failure)                    │  ← conditional error
└────────────────────────────────────────────┘
```

### Typography Hierarchy

| Element | Size | Weight | Color |
|---|---|---|---|
| `display_name` (or slug if absent) | 16px | 700 | `--text-primary` |
| `slug` (if display_name defined) | 11px | 400 | `--text-muted`, monospace |
| Model | 13px | 400 | `--text-secondary`, monospace |
| Port | 11px | 400 | `--text-muted`, monospace |

### Zone 1 — Header

Flex row `justify-content: space-between`, `gap: 10px`.

**Left side:**

| Element | Description |
|---|---|
| **display_name** | `font-size: 16px`, `font-weight: 700`, `--text-primary`. If `display_name` is null, displays slug instead. |
| **slug** *(conditional)* | `font-size: 11px`, `--text-muted`, monospace, `margin-top: 2px`. Displayed only if `display_name` is defined. |

**Right side** (`card-header-right`, flex row `gap: 8px`):

| Element | Description |
|---|---|
| **`⚡ runtime` badge** | Pill indigo violet `rgba(99,102,241,0.12)` / `#818cf8`. Always displayed. Indicates claw-runtime engine. |
| **State badge** | Colored pill with glowing dot + state text label. |
| **`···` button** | 28×28px menu button. Opens action popover on click. `open` class when active. |

**Badge states:**

| State | Color |
|---|---|
| `running` | Green `--state-running` |
| `stopped` | Gray `--state-stopped` |
| `error` | Red `--state-error` |
| `unknown` | Gray |

### Zone 2 — Status bar

Flex row, `gap: 10px`, `flex-wrap: wrap`, separated from header and meta by `--bg-border` borders. Hidden if no indicators to display (`items.length === 0`).

| Indicator | Condition | Style |
|---|---|---|
| `◉ Gateway` | `state === "running"` AND `gateway === "healthy"` | Green `--state-running` |
| `◎ Gateway Error` | `state === "running"` AND `gateway === "unhealthy"` | Red `--state-error` |
| `✈ @bot` | `telegram_bot` defined AND `telegram !== "disconnected"` | Pill blue `#0088cc` |
| `✈ @bot ⚠` | `telegram_bot` defined AND `telegram === "disconnected"` | Pill amber `--state-warning` |
| `⬡ N agent(s)` | `agentCount > 0` | Text `--text-muted` |
| ~~`⚠ N device(s)`~~ | *(removed in v0.34.0 — device pairing no longer supported)* | — |
| `⚠ PERM` | `pendingPermissions > 0` | Clickable red pill → `navigate { view: "instance-settings", section: "runtime" }`. `font-weight: 700`. |

### Zone 3 — Meta

Flex column, `gap: 4px`.

| Field | Condition | Style |
|---|---|---|
| **Model** | If `default_model` defined. Smart resolution: if JSON `{"primary":"..."}`, extracts `primary` key. | `font-size: 13px`, `--text-secondary`, monospace |
| **Port** | Always. | `font-size: 11px`, `--text-muted`, monospace |

### Zone 4 — Error *(conditional)*

`font-size: 11px`, `--state-error`, `margin-top: 8px`. Displayed if a start/stop/restart action fails. Message resolved via `userMessage()`.

### Menu popover `···`

Opened on `···` button click. Closed on outside click (listener `document click`). Position `absolute`, `top: calc(100% + 4px)`, `right: 0`, `z-index: 100`, `min-width: 164px`, `box-shadow: 0 4px 20px rgba(0,0,0,0.45)`.

```
┌─────────────────────┐
│  ■  Stop            │  ← red if running / ▶ Start green if stopped
│  ─────────────────  │
│  ⬡  Agents          │  ← visible if running OR agentCount > 0
│  ⚙  Settings        │  ← always
│  ↺  Restart         │  ← visible if state === "running"
│  ─────────────────  │
│  ✕  Delete          │  ← danger, separated
└─────────────────────┘
```

| Item | Condition | Style | Behavior |
|---|---|---|---|
| **■ Stop / ▶ Start** | Always | Red `.stop` if running, green `.start` if stopped | Call `stopInstance` / `startInstance` API. Disabled during `_loading`. |
| **⬡ Agents** | `state === "running"` OR `agentCount > 0` | Normal | Emit `navigate { view: "agents-builder", slug }` |
| **⚙ Settings** | Always | Normal | Emit `navigate { view: "instance-settings", slug }` |
| **↺ Restart** | `state === "running"` | Normal | Call `restartInstance(slug)` API |
| **✕ Delete** | Always | Red `.danger` | Emit `request-delete { slug }` (confirmation handled by parent) |

All items: `stopPropagation()` + `_menuOpen = false` before action.

### Behaviors

- **`···` click**: `stopPropagation()` + toggle `_menuOpen`
- **Outside click**: close popover via `document click` listener (added in `connectedCallback`, removed in `disconnectedCallback`)
- **Devices pill click**: `stopPropagation()` + `navigate { view: "instance-settings", section: "devices" }`
- **PERM pill click**: `stopPropagation()` + `navigate { view: "instance-settings", section: "runtime" }`

### Real-time Data (WebSocket)

The `health_update` handler in `app.ts` broadcasts the following fields to `InstanceInfo` on each tick:

| Field | Type |
|---|---|
| `gateway` | `"healthy" \| "unhealthy" \| "unknown"` |
| `state` | `"running" \| "stopped" \| "error" \| "unknown"` |
| `agentCount` | `number` |
| `pendingDevices` | `number` |
| `pendingPermissions` | `number` |
| `telegram` | `"connected" \| "disconnected" \| "not_configured"` |

---

## Screen 2 — Instance Detail View (`cp-instance-detail`)

**Source file**: `ui/src/components/instance-detail.ts`

Full view of an instance. Max width `1100px`, centered.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                                                         │
│                                                                 │
│  default                                    ● RUNNING          │
│                                                                 │
│  [Stop]  [Restart]  [⎋ Open UI]  [Delete]                     │
│                                                                 │
│  ┌─ Instance Info ──────────────────────────────────────────┐  │
│  │  PORT  SYSTEMD UNIT  TELEGRAM  MODEL  CONFIG  STATE DIR  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ Agents (11) ────────────────────────────────────────────┐  │
│  │  ID | Name | Model | Workspace                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ Recent Conversations ───────────────────────────────────┐  │
│  │  HH:MM:SS  from → to  message                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Back Button ← 

Gray outline, violet hover `#6c63ff`. Emit `navigate { slug: null }` → return to Instances view.

### Detail Header

- **Title**: slug at `font-size: 28px`, `font-weight: 700`
- **Subtitle**: display_name if defined, `font-size: 14px`, `--text-secondary`
- **State badge**: pill with dot, same logic as card but larger (`border-radius: 20px`)

### Action Bar

Buttons displayed based on instance state:

| Button | Visible if | Style |
|---|---|---|
| **Start** | `stopped`, `error`, `unknown` | Green outline |
| **Stop** | `running` | Red outline |
| **Restart** | `running`, `error`, `unknown` | Violet outline `#6c63ff` |
| **⎋ Open UI** | `running` | Amber outline. URL = nginx_domain if defined, else `localhost:port` |
| **Delete** | Always | Subtle red, `margin-left: auto` (pushed right) |

All disabled during `_actionLoading` or `_deleting`.

### Deletion Confirmation (inline)

Appears below action bar when "Delete" is clicked.

```
┌─ Permanently destroy "default"? ─────────────────────────────┐
│  This will stop the service, remove all files...              │
│  [input: type the slug]  [Destroy]  [Cancel]                 │
└───────────────────────────────────────────────────────────────┘
```

- Very transparent red background, red border
- Input monospace, red focus
- **Destroy** button disabled while input ≠ exact slug
- **Destroy** button shows "Deleting…" during operation
- `Enter` in input → confirms | `Escape` → cancels

### Instance Info Section

Grid `auto-fill minmax(200px, 1fr)`. Each item: uppercase muted label + monospace value.

Fields: Port, Systemd Unit, Telegram Bot *(if defined)*, Default Model *(if defined)*, Config Path, State Dir, Created.

### Agents Section

Table with columns: ID | Name | Model | Workspace.  
`default` badge violet on default agent.  
If empty: centered text "No agents registered".

### Recent Conversations Section

List of last 10 conversations. Each entry on one line:

```
HH:MM:SS   ● from-agent → to-agent   truncated message
```

- **Time**: monospace, `--text-muted`
- **Status dot**: amber (`running`), green (`done`), red (`failed`)
- **from**: violet `#6c63ff`, monospace
- **to**: green `#10b981`, monospace
- **Message**: truncated with ellipsis

---

## Dialog: New Instance (`cp-create-dialog`)

**Source file**: `ui/src/components/create-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `560px`.

```
┌─ New Instance ──────────────────────────── [✕] ┐
│                                                  │
│  ── Identity ──────────────────────────────────  │
│  Slug *          Display name                    │
│  [dev-team    ]  [Dev Team    ]                  │
│                                                  │
│  ── Configuration ─────────────────────────────  │
│  Gateway port *                                  │
│  [18790       ]  (Auto-suggested from free range)│
│                                                  │
│  ── Provider ──────────────────────────────────  │
│  AI Provider *   Default model *                 │
│  [Anthropic ▼]   [claude-sonnet ▼]               │
│  API Key *                                       │
│  [sk-ant-...  ]                                  │
│                                                  │
│  ── Team Blueprint ────────────────────────────  │
│  [None ▼]                                        │
│                                                  │
│  ── Agent team ────────────────────────────────  │
 │  [Minimal (pilot only)]  [Custom agents]         │
│                                                  │
│                          [Cancel]  [Create Instance] │
└──────────────────────────────────────────────────┘
```

### Sections

| Section | Fields |
|---|---|
| **Identity** | Slug * (real-time validation), Display name (auto-filled from slug) |
| **Configuration** | Gateway port * (auto-suggested via API) |
| **Provider** | AI Provider (select), Default model (select), API Key * (if provider requiresKey) |
| **Team Blueprint** | Optional select from existing blueprints |
| **Agent team** | Toggle Minimal / Custom. In Custom mode: agent list (id + name) + "+ Add agent" button |

### Slug Validation

- Auto-lowercase, characters `[a-z0-9-]` only
- Inline error if empty / invalid format / length outside 2-30
- Auto-fills Display name (capitalized, dashes → spaces) while user hasn't manually edited it

### Submission State

During provisioning: form replaced by spinner + message "Provisioning instance **slug**..." (+ "Deploying blueprint agents..." if blueprint selected).

### Closing

- ✕ button (disabled during submission)
- Click on overlay
- Cancel button

---

## Component: Runtime Chat (`cp-runtime-chat`)

**Source file**: `ui/src/components/runtime-chat.ts`

Real-time chat component with a claw-runtime agent via SSE. Integrated in **Runtime** section of Instance Settings. Flex column layout, 100% height of container. Background `--bg-surface`.

```
┌─ cp-runtime-chat ─────────────────────────────────────────────┐
│  [Agent ▼]  🔒 Permanent                     [···]            │  ← header (permanent agent)
│  — or —                                                       │
│  [Agent ▼]  [Session selector ▼]  [+ New]                     │  ← header (ephemeral agent)
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  (message zone — flex: 1, overflow-y: auto)                   │  ← messages
│                                                               │
│  ┌─ user message ──────────────────────────────────────────┐  │
│  │  My message                                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─ assistant message ─────────────────────────────────────┐  │
│  │  Agent response                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│  [spinner]  Agent is thinking…                                │  ← sending/streaming state
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  [textarea…]                                    [Send]        │  ← input
├───────────────────────────────────────────────────────────────┤
│  (error banner if connection lost)                            │  ← conditional error
└───────────────────────────────────────────────────────────────┘
```

### Header

Flex row, `padding: 10px 12px`, `border-bottom: 1px solid --bg-border`, `gap: 8px`.

| Element | Description |
|---|---|
| **Agent selector** | `<select>` displayed if instance has multiple agents. Selects current agent. |
| **🔒 Permanent badge** | Displayed if current agent is permanent (`persistent === true`). Muted text. |
| **Session selector** | `<select>` flex:1. "New session" option + existing sessions. **Hidden for permanent agents** (single session). |
| **[+ New]** | `btn btn-ghost`, `font-size: 12px`. Creates new session. **Hidden for permanent agents**. |
| **[···]** | Dropdown menu with actions. "New session" option is **hidden for permanent agents**. |

### Message Zone

- Transparent background, `padding: 16px`, `gap: 12px`
- **Empty state**: "Start a conversation with the agent" centered, `--text-muted`. Displayed if `messages.length === 0` AND no streaming AND `status === "idle"`.
- **User message**: `background: --bg-hover`, right-aligned (`align-self: flex-end`), `max-width: 85%`, `border-radius: --radius-md`
- **Assistant message**: transparent background, `border: 1px solid --bg-border`, left-aligned (`align-self: flex-start`)
- **Streaming message**: same assistant style + blinking `▋` cursor + `opacity: 0.85`
- **"Thinking" spinner**: displayed if `status === "sending"` or `status === "streaming"` without accumulated text. 16px spinner + "Agent is thinking…"

### Input

- `<textarea>` flex:1, `rows="2"`, `resize: none`, `background: --bg-hover`
- Placeholder: "Message… (Enter to send, Shift+Enter for newline)"
- `Enter` (without Shift) → send message
- `Shift+Enter` → newline
- Disabled if `status !== "idle"`
- **[Send]**: `btn btn-primary`, disabled if textarea empty or status ≠ idle

### SSE Stream

Opened via `EventSource` on `GET /api/instances/:slug/runtime/sessions/:id/stream` (URL built by `getRuntimeChatStreamUrl()`).

| SSE Event | Behavior |
|---|---|
| `message.part.delta` | Accumulate `_streamingText` += `payload.delta`, status → streaming |
| `message.created` (assistant) | Reset `_streamingText = ""`, status → streaming |
| `message.updated` | Clear `_streamingText = ""`, status → idle |
| `session.status` (`busy`) | status → streaming |
| `session.status` (`idle`) | status → idle **only if** streaming without accumulated text (avoids cutting current stream) |
| `session.ended` | status → idle, clear `_streamingText` |
| `ping` | Ignored (keep-alive) |
| SSE error | status → error, message "Connection to runtime lost. Please refresh.", close stream |

### First Message (new session)

First message of new session sent via `POST /api/instances/:slug/runtime/chat`. HTTP response (`RuntimeChatResponse`) contains: `sessionId`, `messageId`, `text`, `tokens` (`{ input, output }`), `costUsd`, `steps`. SSE stream opened **after** response received. Sessions list reloaded to include new session in dropdown.

### Initial Loading

On `connectedCallback`, component loads in parallel:
- Active sessions via `fetchRuntimeSessions(slug)`
- Archived sessions via `GET /api/instances/:slug/runtime/sessions?state=archived&limit=20`

Both lists merged into `_sessions`. First active session auto-selected.

### Props

| Prop | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |

### Internal State

| State | Type | Description |
|---|---|---|
| `_sessions` | `RuntimeSession[]` | Active + archived sessions merged |
| `_sessionId` | `string \| null` | Selected session ID (`null` = new session) |
| `_messages` | `ChatMessage[]` | Displayed messages (`{ role, text, id? }`) |
| `_streamingText` | `string` | Text being accumulated from SSE |
| `_status` | `"idle" \| "loading" \| "sending" \| "streaming" \| "error"` | Component state |
| `_error` | `string` | Error message displayed in banner |
| `_inputText` | `string` | Textarea content |
| `_sessionsLoading` | `boolean` | Initial session loading |
| `_dropdownOpen` | `boolean` | Session dropdown open/closed |
| `_archivedExpanded` | `boolean` | Archived group expanded in dropdown |

---

## Screen 2c — Runtime Pilot (`cp-runtime-pilot`)

**Source file**: `ui/src/components/runtime-pilot.ts`

> Replaces `cp-runtime-chat` since v0.37.0. 17 components total.

Advanced chat view with LLM context panel on side. Accessible via hash `#/instances/:slug/pilot`. Flex two-column layout.

```
┌─ cp-runtime-pilot ────────────────────────────────────────────────┐
│  ┌─ pilot-header ─────────────────────────────────────────────┐   │
│  │  [Agent ▼]  Session title  $0.12  [🔒 Permanent] [Context]│   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌─ Messages ──────────────────────────┐  ┌─ pilot-context-panel ────┐   │
│  │                             │  │  [Agents] [Tools]        │   │
│  │  ┌─ user message ────────┐ │  │  [System] [Events]       │   │
│  │  │  My message           │ │  │                          │   │
│  │  └───────────────────────┘ │  │  ┌─ context-gauge ─────┐ │   │
│  │  ┌─ assistant message ───┐ │  │  │  Token usage donut  │ │   │
│  │  │  part-text            │ │  │  │  input / output     │ │   │
│  │  │  part-tool (tool call)│ │  │  └─────────────────────┘ │   │
│  │  │  part-reasoning       │ │  │                          │   │
│  │  │  part-subtask         │ │  │  ┌─ context-tools ─────┐ │   │
│  │  │  part-compaction      │ │  │  │  12 built-in tools  │ │   │
│  │  └───────────────────────┘ │  │  │  3 MCP tools        │ │   │
│  │                             │  │  └─────────────────────┘ │   │
│  │  ┌─ pilot-input ─────────┐ │  │                          │   │
│  │  │  [textarea]   [Send]  │ │  │  ┌─ context-agents ───┐ │   │
│  │  └───────────────────────┘ │  │  │  Agent teammates    │ │   │
│  └─────────────────────────────┘  │  └─────────────────────┘ │   │
│                                    └──────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### Components (17)

| Component | File | Role |
|---|---|---|
| `cp-runtime-pilot` | `runtime-pilot.ts` | Main container — layout, session management, SSE |
| `cp-pilot-header` | `pilot/pilot-header.ts` | Header — agent selector, session info, cost, context button |
| `cp-pilot-messages` | `pilot/pilot-messages.ts` | Scrollable message list |
| `cp-pilot-message` | `pilot/pilot-message.ts` | Message rendering (dispatches to part renderers) |
| `cp-pilot-input` | `pilot/pilot-input.ts` | Textarea + Send button |
| `cp-pilot-context-panel` | `pilot/pilot-context-panel.ts` | Right side panel — context tabs |
| `cp-context-gauge` | `pilot/context/context-gauge.ts` | Donut gauge for tokens (input/output/cache) |
| `cp-context-tools` | `pilot/context/context-tools.ts` | Available tools list (built-in + MCP) |
| `cp-context-agents` | `pilot/context/context-agents.ts` | Agent teammates + spawn links |
| `cp-context-system` | `pilot/context/context-system.ts` | System prompt files (SOUL.md, IDENTITY.md, etc.) |
| `cp-context-events` | `pilot/context/context-events.ts` | Real-time bus event log |
| `cp-part-text` | `pilot/parts/part-text.ts` | Markdown text rendering (marked + DOMPurify) |
| `cp-part-tool` | `pilot/parts/part-tool.ts` | Tool-call + tool-result rendering (collapsible) |
| `cp-part-reasoning` | `pilot/parts/part-reasoning.ts` | Anthropic extended thinking rendering |
| `cp-part-subtask` | `pilot/parts/part-subtask.ts` | Subagent rendering (spawn info + result) |
| `cp-part-compaction` | `pilot/parts/part-compaction.ts` | Compaction summary |
| `cp-session-tree` | `session-tree.ts` | Session hierarchy (parent/child) |

### Extended SSE Stream (17+ event types)

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

---

## Screen 2b — Instance Settings View (`cp-instance-settings`)

**Source file**: `ui/src/components/instance-settings.ts`

Full configuration view of an instance. Accessible via the **Settings** button on the card. Two-column layout: fixed sidebar + content zone per panel (one section at a time).

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

### Panel Navigation Principle

Click on sidebar item → **replaces** content with corresponding panel (no scroll). Single section visible at a time. Default active section: **General** (or `initialSection` passed as prop).

### Header Bar

Always visible. Background `--bg-surface`, bottom border.

| Element | Description |
|---|---|
| **← Back** | Gray outline, accent hover. Emit `navigate { slug: null }` → return to Instances view. |
| **Title** | "**slug** — Settings" (`font-size: 16px`, `font-weight: 700` on slug). |
| **[Cancel]** | Visible if `_hasChanges`. Cancels all dirty modifications. |
| **[Save]** | Visible if `_hasChanges`. Disabled if validation error or `_saving`. Calls `PATCH /api/instances/:slug/config`. |

### Sidebar

Navigation through 7 panels: **General**, **Agents**, **Runtime**, **Channels**, **MCP**, **Permissions**, **Config**. *(Devices panel removed in v0.34.0)* Active item: `--accent-subtle` background, `--accent` color, `font-weight: 600`. Click → `_activeSection = section` (immediate content swap).

**Numeric badges** on sidebar items:

| Item | Badge | Condition |
|---|---|---|
| **MCP** | Accent numeric | Number of connected MCP servers (`_mcpConnectedCount > 0`) |
| **Permissions** | Accent numeric | Number of pending permission requests (`_pendingPermissionsCount > 0`) |

### Modified Fields

Modified fields display `--accent` border (class `changed`). Read-only fields have `--bg-surface` background.

### General Section

2-column grid.

| Field | Type | Behavior |
|---|---|---|
| **Display name** | Text input | Editable |
| **Port** | Read-only | Not modifiable (`:XXXXX`) |
| **Default model** | Select grouped by provider | Options grouped by configured provider. If current model not in list, added as isolated option. |
| **Tools profile** | Select | Options: `minimal`, `messaging`, `coding`, `full` |

**Providers subsection**: list of configured providers. Each provider: card with name, monospace ID, env var, masked key + **[Change]** button (inline edit) or **[Cancel]**. **[Remove]** button disabled if provider used by default model. **[+ Add provider]** button → select available providers (not yet configured).

### Agents Section

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

### Runtime Section

Informational panel + integrated chat. No editable fields (Save/Cancel not shown when active).

```
┌─ Runtime ─────────────────────────────────────────────────────┐
│  This instance runs on claw-runtime — the native claw-pilot   │
│  agent engine.                                                │
│                                                               │
│  Engine      claw-runtime                                     │
│  Config file runtime.json                                     │
│                                                               │
│  ── Chat ──────────────────────────────────────────────────── │
│  ┌─ cp-runtime-chat (480px height) ────────────────────────┐ │
│  │  [● Session title  $0.03 ▾]  [+ New] / [Permanent]      │ │
 │  │  pilot · web · 5 msg · 1.2k tok · $0.03  [Fork] [Archive]│ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  (messages)                                              │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  [textarea…]  [Send]                                     │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Engine** | Fixed value `claw-runtime`, monospace |
| **Config file** | Fixed value `runtime.json`, monospace muted |
| **Chat** | `cp-runtime-chat` component integrated in container `height: 480px`, `border: 1px solid --bg-border`, `border-radius: --radius-md` |

### Confirmation Toast

Appears bottom-right (`position: fixed`, `bottom: 80px`, `right: 24px`) for 4s after saving.

| Type | Color | Message |
|---|---|---|
| **success** | Green | "Configuration saved — hot-reload applied" |
| **warning** | Amber | "Configuration saved — instance restarted (reason)" |
| **error** | Red | Error message |

**Port changed warning**: if port changed, `⚠` banner displays under header: "Port changed — browser pairing will be lost after restart. Go to the Devices tab to approve the new request."

### Channels Section (`cp-instance-channels`)

**Source file**: `ui/src/components/instance-channels.ts`

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

### ~~Section Devices~~ *(removed in v0.34.0)*

Device pairing has been removed. The `cp-instance-devices` component and sidebar panel are no longer rendered. The `rt_pairing_codes` table is retained in the DB (additive-only policy).

### MCP Section (`cp-instance-mcp`)

**Source file**: `ui/src/components/instance-mcp.ts`

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

**Source file**: `ui/src/components/instance-permissions.ts`

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

**Source file**: `ui/src/components/instance-config.ts`

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

---

## Screen 3 — Agent Builder (`cp-agents-builder`)

**Source file**: `ui/src/components/agents-builder.ts`  
**Reference screenshot**: `screen1.png`

Free canvas with positioned agent cards and SVG links. Height = `100vh - 56px (nav) - 48px (subnav)`.

```
┌─ Header ──────────────────────────────────────────────────────┐
│  ← Back  Agents Builder  default  ● running  [+ New agent]  [↓ Export]  [↑ Import]  [↻ Sync]  │
└───────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────┐
│                                                               │
│   [Main]──────────────────────────────────────────────────    │
│      ↘                                                        │
│        [Bob - Scrum Master]   [Amelia - Developer]            │
│      ↙                                                        │
│   [Mary - Business A...]    [Oscar - DevSecOps]               │
│                                                               │
│                              ┌─ Agent Detail Panel ─────────┐ │
 │                              │  Pilot  pilot                │ │
│                              │  [Info] [AGENTS.md] [SOUL.md]│ │
│                              │  ...                         │ │
│                              └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Header

| Element | Description |
|---|---|
| **← Back** | Return to Instances view. Gray outline, accent hover. |
| **Agents Builder** | Fixed title |
| **slug** | Instance name in monospace muted |
| **State badge** | Instance state (running/stopped/...) |
| **+ New agent** | Opens agent creation dialog (`cp-create-agent-dialog`). Green outline on hover. Pushed right (`margin-left: auto`). |
| **↓ Export** | Exports team as `.team.yaml` (direct download). Gray outline. |
| **↑ Import** | Opens team import dialog (`cp-import-team-dialog`). Gray outline. |
| **↻ Sync** | Resynchronizes agents from disk. Accent outline. Disabled during sync. |

### Canvas

- Background `--bg-base`, position `absolute inset: 0`
- Cards positioned in `position: absolute`, centered on their point (`transform: translate(-50%, -50%)`)
- SVG links in overlay (`pointer-events: none`)
- **Drag & drop**: `pointerdown/move/up` on canvas. 5px threshold to distinguish click (selection) from drag (movement). Position persisted in DB after drag.
- **Short click**: select/deselect agent → open/close detail panel

### Canvas States

| State | Rendering |
|---|---|
| **Syncing** | Semi-transparent overlay + centered spinner |
| **Error** | Centered error banner at top |
| **Empty** | "No agents found" + "Click Sync to refresh from disk" centered |
| **Normal** | Cards + SVG links |

### SVG Links (`cp-agent-links-svg`)

**Source file**: `ui/src/components/agent-links-svg.ts`

Full-canvas SVG, `pointer-events: none`. Draws `spawn` type links between agents.

| Link Type | Style |
|---|---|
| **Normal spawn** | Gray dashes `#666`, gray arrow |
| **Pending-remove spawn** | Red dashes `#ef4444`, red arrow |
| **Pending-add spawn** | Green dashes `#10b981`, green arrow |

A2A links are not drawn in SVG — indicated by accent border on cards.

---

## Component: Agent Card Mini (`cp-agent-card-mini`)

**Source file**: `ui/src/components/agent-card-mini.ts`

Compact card positioned on canvas. Width 130-160px (180px for default agent).

```
┌─────────────────────────────┐
│  Bob - Scrum Master      ✕  │  ← row 1: name + delete button
│  sm              7 files    │  ← row 2: agent_id + file count
│  [A2A]  claude-haku-4-5     │  ← row 3: badge + model
└─────────────────────────────┘
```

### Badges (row 3)

| Badge | Color | Condition | Tooltip |
|---|---|---|---|
| **Default** | Blue accent | `is_default === true` | "Main entry point for conversations..." |
| **A2A** | Blue accent | Connected in A2A mode | "Connected in Agent-to-Agent mode..." |
| **SA** | Gray outline | Neither default nor A2A | "SubAgent: specialized agent..." |

### Visual States

| State | Style |
|---|---|
| **Normal** | `--bg-border` border |
| **A2A** | `--accent-border` border |
| **Selected** | `--accent` border + `--accent-border` glow |
| **New** (2s) | Thick green border + fading pulse animation |

### Delete Button (✕)

Visible only if `deletable === true` (non-default). Opacity 0.45 → 1 on hover, red color. `stopPropagation()` → emit `agent-delete-requested`.

---

## Component: Agent Detail Panel (`cp-agent-detail-panel`)

**Source file**: `ui/src/components/agent-detail-panel.ts`

Right side panel, `width: 420px`, canvas height 100%. Expands to 100% in expanded mode.

```
┌─ Panel Header ──────────────────────────────────────┐
│  Pilot  pilot                  [🗑] [⊞] [✕]        │
│  (role if defined)                                  │
├─ Tabs ──────────────────────────────────────────────┤
│  [Info]  [AGENTS.md]  [SOUL.md]  [HEARTBEAT.md] ... │
├─ Body ──────────────────────────────────────────────┤
│  (content by active tab)                            │
├─ Save Bar (conditional) ────────────────────────────┤
│  [Save]  N changes pending  [Cancel]                │
└─────────────────────────────────────────────────────┘
```

### Header

- **Name**: `font-size: 16px`, `font-weight: 700`
- **agent_id**: monospace muted next to name
- **Role** *(optional)*: italic muted under name
- **🗑 Delete**: visible if non-default. Red hover. Emit `agent-delete-requested`.
- **⊞/⊟ Expand**: toggle between 420px and 100% width
- **✕ Close**: emit `panel-close`

### Tabs

- **Info**: always present
- **Files**: one tab per file in `agent.files` (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, HEARTBEAT.md, MEMORY.md...)

### Info Tab

Displays in column:

| Field | Condition |
|---|---|
| **Model** | If defined |
| **Workspace** | Always |
| **Last sync** | If defined AND instance context (not blueprint) |
| **A2A links** | If A2A links exist. `↔ peer-id` accent badges. |
| **Can spawn** | If outgoing spawn links OR available agents. Editable badges with ✕ (remove) and ＋ (add via dropdown). |
| **Spawned by** | If incoming spawn links. `← source-id` badges. |
| **Notes** | If `agent.notes` defined |

### Spawn Link Management (inline)

- **Remove**: click ✕ on badge → pending-removal (strikethrough, red). Click ↩ → cancel.
- **Add**: click ＋ → dropdown of available agents → select → pending-add (green).
- **Save bar**: appears once pending changes exist. Save button → API call → reload. Cancel button → discard all changes.

### File Tabs

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

**Editable files**: AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md  
**Read-only files**: all others (MEMORY.md, etc.)

---

## Dialog: New Agent (`cp-create-agent-dialog`)

**Source file**: `ui/src/components/create-agent-dialog.ts`

Centered modal, max width `480px`. Same structure as instance creation dialog.

```
┌─ New agent ─────────────────────────── [✕] ┐
│                                              │
│  ── Identity ──────────────────────────────  │
│  Agent ID *        Display name *            │
│  [qa-engineer ]    [QA Engineer  ]           │
│  Role                                        │
│  [Quality Assurance                ]         │
│                                              │
│  ── Model ─────────────────────────────────  │
│  Provider          Model                     │
│  [Anthropic ▼]     [claude-sonnet ▼]         │
│                                              │
│                    [Cancel]  [Create agent]  │
└──────────────────────────────────────────────┘
```

### Validation

- Agent ID: auto-lowercase, `[a-z0-9-]`, 2-30 chars, not already used in instance
- Display name: auto-filled from ID (kebab-case → Title Case) while user hasn't manually edited
- Create button disabled if form invalid or providers loading

### Submission State

Spinner + "Creating agent **slug**..."

---

## Dialog: Delete Agent (`cp-delete-agent-dialog`)

**Source file**: `ui/src/components/delete-agent-dialog.ts`

Centered modal, max width `440px`. Destructive confirmation.

```
┌─ Delete agent ──────────────────────── [✕] ┐
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will permanently delete all...  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Bob - Scrum Master — sm                     │
│                                              │
│  Type the agent ID to confirm                │
│  [sm                                    ]    │
│                                              │
│                    [Cancel]  [Delete]        │
└──────────────────────────────────────────────┘
```

- **Delete** button solid red, disabled while input ≠ `agent.agent_id`
- `Enter` in input → confirms
- During deletion: spinner + "Deleting agent... **slug**"

---

## Dialog: Delete Instance (`cp-delete-instance-dialog`)

**Source file**: `ui/src/components/delete-instance-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `440px`. Triggered by ✕ button on instance card (event `request-delete` captured by `cluster-view`).

```
┌─ Delete instance ───────────────────── [✕] ┐
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will permanently stop the        │  │
│  │  service, remove all files...          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  My instance — default                       │
│                                              │
│  Type the instance slug to confirm           │
│  [default                              ]     │
│                                              │
│                    [Cancel]  [Destroy]       │
└──────────────────────────────────────────────┘
```

- **Destroy** button solid red, disabled while input ≠ exact slug
- `Enter` in input → confirms
- During deletion: spinner + "Destroying instance... **slug**"
- After deletion: emit `instance-deleted { slug }` → `cluster-view` reloads list

---

## Dialog: Team Import (`cp-import-team-dialog`)

**Source file**: `ui/src/components/import-team-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `500px`. Accessible from **↑ Import** button in Agent Builder and Blueprint Builder headers.

```
┌─ Import Agent Team ─────────────────── [✕] ┐
│                                              │
│  ┌─ Drop zone ────────────────────────────┐  │
│  │  Drop .team.yaml file here             │  │
│  │  or click to browse                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  (after selecting valid file)                │
│  File     my-team.team.yaml                  │
│  Agents   8 (current: 3)                     │
│  Links    12                                 │
│  Files    48                                 │
│                                              │
│  ┌─ Warning ──────────────────────────────┐  │
│  │  This will replace all existing        │  │
│  │  agents, files, and links.             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│                    [Cancel]  [Import]        │
└──────────────────────────────────────────────┘
```

### Behavior

| Step | Description |
|---|---|
| **Drop / Browse** | Drag & drop zone or click to open file selector (`.yaml`, `.yml`). Accent border + light background on hover/dragover. |
| **Auto dry-run** | Once file selected, automatic API call in dry-run mode → display summary (agents, links, files to import). |
| **Summary** | Number of agents to import, current count, links, workspace files. |
| **Warning** | Amber banner: "This will replace all existing agents, files, and links. This action cannot be undone." |
| **Import** | Button disabled until dry-run succeeds. During import: inline spinner. |
| **Success** | Emit `team-imported` → parent reloads canvas data. |

**Polymorphic context**: works for instance (`kind: "instance"`) or blueprint (`kind: "blueprint"`). Called API routes differ by context.

---

## Screen 4 — Blueprints View (`cp-blueprints-view`)

**Source file**: `ui/src/components/blueprints-view.ts`

Structure identical to Instances view: early return during loading, header with dynamic count + button, card grid.

```
┌─────────────────────────────────────────────────────────────────┐
│  2 blueprints                         [+ New Blueprint]         │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Blueprint Card  │  │  Blueprint Card  │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### States

| State | Rendering |
|---|---|
| **Loading** | "Loading blueprints..." centered (early return — header not shown) |
| **Error** | Red error banner before header |
| **Empty** | Header "0 blueprints" + 📋 icon + "No blueprints yet" + hint |
| **Normal** | Header "N blueprints" + grid `auto-fill minmax(300px, 1fr)`, gap 16px |

### Interactions

- **Click on a card** → navigate to Blueprint Builder
- **"+ New Blueprint" button** → open blueprint creation dialog
- **Deletion**: handled inline in card (confirmation)

---

## Component: Blueprint Card (`cp-blueprint-card`)

**Source file**: `ui/src/components/blueprint-card.ts`

```
┌─────────────────────────────────────┐
│ ▌ 🎯 HR Team              [Delete] │  ← header (color bar + icon + name)
│                                     │
│  Description du blueprint...        │  ← description (2 lines max)
│                                     │
│  3 agents   [hr]  [legal]           │  ← meta (count + tags)
│                                     │
│  ┌─ Delete blueprint "HR Team"? ──┐ │  ← inline confirmation (conditional)
│  │  [Delete]  [Cancel]            │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Elements

| Element | Description |
|---|---|
| **Color bar** | Left 3px vertical band with blueprint color (if defined) |
| **Icon** | Emoji or text, `font-size: 20px` (if defined) |
| **Name** | `font-size: 16px`, `font-weight: 700` |
| **Delete button** | Transparent outline → red on hover. `stopPropagation()`. |
| **Description** | 2 lines max with ellipsis |
| **Agent count** | "N agents" or "No agents" |
| **Tags** | Accent pills rounded (`border-radius: 20px`) |

### Deletion Confirmation

Appears inline below meta when Delete clicked. Transparent red background.  
**Delete** button solid red → emit `blueprint-delete`. **Cancel** button → hide confirmation.  
Card click ignored if delete/confirm area clicked.

### Hover

`--accent-border` border + glow `0 0 0 1px --accent-border`.

---

## Screen 5 — Blueprint Builder (`cp-blueprint-builder`)

**Source file**: `ui/src/components/blueprint-builder.ts`

Same visual structure as Agent Builder (canvas + panel), but for blueprints (no live instance).

```
┌─ Header ──────────────────────────────────────────────────────┐
│  ← Back to Blueprints   HR Team  🎯          [+ New agent]   │
└───────────────────────────────────────────────────────────────┘
┌─ Canvas ──────────────────────────────────────────────────────┐
│  (same canvas as agents-builder)                              │
│                              ┌─ Agent Detail Panel ─────────┐ │
│                              │  (same panel, BP context)    │ │
│                              └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Differences vs Agent Builder

| Aspect | Agent Builder | Blueprint Builder |
|---|---|---|
| Panel context | `{ kind: "instance", slug }` | `{ kind: "blueprint", blueprintId }` |
| Sync button | Present | Absent |
| Agent creation dialog | `cp-create-agent-dialog` (full) | Inline simplified dialog (ID + Name + Model) |
| Agent deletion | Via `cp-delete-agent-dialog` | Direct (no confirmation dialog) |
| Last sync in panel | Displayed | Hidden |
| Spawn links API | `/api/instances/:slug/agents/:id/spawn-links` | `/api/blueprints/:id/agents/:id/spawn-links` |

### Agent Creation Dialog (inline in blueprint-builder)

Simplified dialog without provider/API key:

```
┌─ New agent ─────────────────────────────────────┐
│  Agent ID *  [researcher              ]          │
│  Name *      [Research Agent          ]          │
│  Model       [claude-opus-4-5         ] (optional) │
│                          [Cancel]  [Create]      │
└──────────────────────────────────────────────────┘
```

---

## Dialog: Instance Discovery (`cp-discover-dialog`)

**Source file**: `ui/src/components/discover-dialog.ts`

Centered modal, dark overlay with `backdrop-filter: blur(4px)`. Max width `520px`. Triggered by **[Discover instances]** button in Instances view (empty state). Implements `DialogMixin`.

Scan starts automatically on open (`connectedCallback`).

### Phases

```
┌─ Discover instances ──────────────────────────── [✕] ┐
│                                                       │
│  Phase scanning:                                      │
│  ┌─────────────────────────────────────────────────┐  │
│  │  [spinner]                                      │  │
│  │  Scanning system...                             │  │
│  │  Looking for claw-runtime instances              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Phase results (instances found):                     │
│  Found 2 instance(s) on this system:                  │
│  ┌─ Instance card ───────────────────────────────┐    │
│  │  default                    ● running         │    │
│  │  :18789  ✈ @my_bot  claude-sonnet  3 agents   │    │
│  └───────────────────────────────────────────────┘    │
│  ┌─ Instance card ───────────────────────────────┐    │
│  │  staging                    ○ stopped         │    │
│  │  :18790                                       │    │
│  └───────────────────────────────────────────────┘    │
│                                [Cancel]  [Adopt all (2)]│
│                                                       │
│  Phase adopting:                                      │
│  [spinner]  Registering instances...                  │
│                                                       │
│  Phase done:                                          │
│  ✓  2 instance(s) registered successfully.            │
│                                                       │
│  Phase error:                                         │
│  [red banner]  [Close]  [Retry]                       │
└───────────────────────────────────────────────────────┘
```

### Phase Details

| Phase | Trigger | Rendering |
|---|---|---|
| **scanning** | Dialog open | Centered spinner + "Scanning system..." + subtitle "Looking for claw-runtime instances" |
| **results** | Scan complete | List of found instances (or message "No claw-runtime instances found") + footer [Cancel] [Adopt all (N)] |
| **adopting** | Click [Adopt all] | Spinner + "Registering instances..." |
| **done** | Adoption succeeded | Green ✓ icon + "N instance(s) registered successfully." Auto-close after 1.5s with `instances-adopted` emission |
| **error** | Scan or adoption error | Red banner + [Close] + [Retry] |

### Instance Card (in results list)

Background `--bg-base`, border `--bg-border`, `border-radius: --radius-md`.

| Element | Description |
|---|---|
| **Slug** | `font-weight: 700`, `font-size: 14px` |
| **State badge** | Green pill "● running" if `gatewayHealthy`, gray "○ stopped" otherwise |
| **Port** | Monospace muted `:XXXXX` |
| **Telegram** | Blue pill `#0088cc` if `telegramBot` defined |
| **Model** | Monospace muted if `defaultModel` defined |
| **Agent count** | "N agents" if `agentCount > 0` |

### Behaviors

- **Close**: ✕ button (disabled during `adopting` phase) or overlay click (same)
- **Retry**: restart scan from `scanning` phase
- **Adopt all**: adopt all found instances in single action
- **After adoption**: emit `instances-adopted { count }` → `cluster-view` closes dialog and reloads list

### Accessibility

`role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Implements `DialogMixin` (focus trap, Escape).

---

## ~~Component: Devices (`cp-instance-devices`)~~ *(removed in v0.34.0)*

> **DEPRECATED** — Device pairing was removed in v0.34.0. This component is no longer rendered. The documentation below is retained for historical reference only.

**Source file**: `ui/src/components/instance-devices.ts`

Standalone component displayed in **Devices** panel of Instance Settings. Manages device pairing (Control UI, CLI) with the OpenClaw instance.

```
┌─ DEVICES ───────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─ PENDING (2) ──────────────────────── [Approve all] ────────┐ │
│  │  macos    browser-abc123    2m ago    [Approve]             │ │
│  │  linux    browser-def456    5m ago    [Approve]             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  PAIRED (3)                                                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  macos    browser-xyz    admin    1h ago    [✕]             │ │
│  │  linux    cli            admin    3d ago    [cli]           │ │
│  │  windows  browser-abc    user     2d ago    [✕]             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [↻ Refresh]                                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Pending Section

Transparent amber background (`rgba(245,158,11,0.08)`), amber border. Visible only if `devices.pending.length > 0`.

| Element | Description |
|---|---|
| **"PENDING (N)" header** | Amber uppercase label + **[Approve all]** button if N > 1 |
| **Device line** | Platform (monospace) + clientId + relative age + **[Approve]** button |
| **[Approve]** | Green outline. Inline spinner during approval. Disabled during operation. |
| **[Approve all]** | Approve all devices sequentially. Inline spinner. |

**Polling**: if requests pending, automatic polling every 5s. Stops when pending list empty.

### Paired Section

Border `--bg-border`, `border-radius: --radius-md`, overflow hidden.

| Element | Description |
|---|---|
| **"PAIRED (N)" title** | Uppercase muted label |
| **Device line** | Platform (monospace) + clientId + role + relative age (based on `lastUsedAtMs` or `approvedAtMs`) + action |
| **Action — CLI** | Gray monospace `[cli]` badge (non-revocable) |
| **Action — Others** | **[✕]** button 24×24px, muted → red on hover. Click → inline confirmation. |
| **Inline confirmation** | "Revoke?" + **[Confirm]** red + **[Cancel]** gray. Replaces ✕ button. |
| **Empty state** | "No paired devices." |

### Relative Age

Calculated from `lastUsedAtMs` (max of tokens) or `approvedAtMs`: "just now" / "Xm ago" / "Xh ago" / "Xd ago".

### Footer

**[↻ Refresh]** button (gray outline) + inline error message if operation fails.

### Props

| Prop | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `active` | `boolean` | If `false`, component doesn't load and stops polling |

### Emitted Events

| Event | Payload | Description |
|---|---|---|
| `pending-count-changed` | `number` | Emitted after each load — number of pending requests. Used by `instance-settings` to update sidebar badge. |

---

## Global Component: Permission Overlay (`cp-permission-request-overlay`)

**Source file**: `ui/src/components/permission-request-overlay.ts`

Fixed overlay bottom-right corner (`bottom: 24px`, `right: 24px`, `z-index: 9999`, `width: 480px`). Automatically displayed when a claw-runtime agent emits `permission.asked` event via SSE stream. Managed by `cp-app` (or parent component monitoring active instance).

```
┌─ 🔐 Permission Request ──────────────────────── [✕] ─┐
│                                                       │
│  Request description (if provided)                    │
│                                                       │
│  ┌─ Details ────────────────────────────────────────┐ │
│  │  Permission  Bash                                │ │
│  │  Pattern     /tmp/**                             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  42s  ████████████████░░░░░░░░  (countdown bar)       │
│                                                       │
│  [toggle]  This time only / Always (for this agent)   │
│                                                       │
│  [Deny]  [Deny with feedback]  [Approve]  [Dismiss]   │
└───────────────────────────────────────────────────────┘
```

### Behavior

| Element | Description |
|---|---|
| **Header** | Transparent red background `rgba(239,68,68,0.06)`. Red title `--state-error` + 🔐 icon. Count badge if multiple requests queued. **[✕]** dismiss button. |
| **Description** | Free text provided by agent (optional). |
| **Details** | `--bg-hover` background, `--bg-border` border. Lines: Permission (monospace) + Pattern (monospace). |
| **Countdown** | Red progress bar emptying over 60s. Auto-dismiss at 0. |
| **Persist toggle** | "This time only" (default) / "Always (for this agent)". Controls if rule persisted. |
| **[Deny]** | Red outline. Send `decision: "deny"` immediately. |
| **[Deny with feedback]** | Transparent red outline. First click → show comment textarea. Second click → send with comment. |
| **[Approve]** | Green outline. Send `decision: "allow"`. |
| **[Dismiss]** | Gray, `margin-left: auto`. Remove request from queue without responding. |

### FIFO Queue

Requests accumulate in queue. Only one displayed at a time. After response or dismiss, next displays and countdown restarts at 60s.

### SSE Source

Listen to `GET /api/instances/:slug/runtime/chat/stream`. Event `permission.asked` → add to queue.

### Response API

`POST /api/instances/:slug/runtime/permission/reply` with `{ permissionId, decision, persist, comment? }`.

---

## Global Component: Bus Alerts (`cp-bus-alerts`)

**Source file**: `ui/src/components/bus-alerts.ts`

Live alert toasts positioned bottom-right (`bottom: 100px`, `right: 24px`, `z-index: 9998`). Displayed above footer, below permission overlay. Maximum 3 simultaneous toasts (FIFO — oldest removed if exceeded).

```
                               ┌─ Toast (360px) ──────────────────┐
                               │ ⚠  Doom loop detected            │
                               │    Agent: researcher             │
                               │                              [✕] │
                               └──────────────────────────────────┘
                               ┌─ Toast ──────────────────────────┐
                               │ ♥  Heartbeat alert               │
                               │    Agent message...  [View]      │
                               │                              [✕] │
                               └──────────────────────────────────┘
```

### Alert Types

| Event Type | Variant | Icon | Title | Persistent |
|---|---|---|---|---|
| `tool.doom_loop` | warning | ⚠ | "Doom loop detected" | Yes |
| `heartbeat.alert` | warning | ♥ | "Heartbeat alert" | Yes |
| `provider.failover` | info | ↺ | "Provider failover" | No (8s) |
| `provider.auth_failed` | error | ✕ | "Provider auth failed" | Yes |
| `llm.chunk_timeout` | warning | ⏱ | "LLM chunk timeout" | No (8s) |
| `agent.timeout` | error | ⏱ | "Agent timeout" | Yes |

### Design

| Element | Description |
|---|---|
| **Left border** | 3px colored by variant (amber/red/cyan) |
| **Icon** | Colored by variant |
| **Title** | `font-size: 12px`, `font-weight: 700`, `--text-primary` |
| **Body** | `font-size: 11px`, `--text-secondary`, truncated with ellipsis |
| **[View]** | Amber outline button. Visible only for `heartbeat.alert`. Emit `navigate-to-session { sessionId, slug }`. |
| **[✕]** | Dismiss button muted → primary on hover. |
| **Animation** | `slide-in`: translateX(20px) → 0, opacity 0 → 1, 0.2s ease-out. |

### Public API

`addAlert(event: { type, payload, slug? })` — called from `app.ts` on receiving bus WebSocket messages.

---

## Dialog Accessibility

Since v0.7.1, all modal dialogs implement `DialogMixin`:

| Behavior | Detail |
|---|---|
| **Focus trap** | Focus remains in dialog while open (Tab / Shift+Tab cycle in dialog) |
| **Escape** | Close dialog (except during operation in progress) |
| **aria-modal** | `aria-modal="true"` on dialog root element |

Dialogs covered: `cp-create-dialog`, `cp-delete-instance-dialog`, `cp-create-agent-dialog`, `cp-delete-agent-dialog`, `cp-import-team-dialog`.

---

## Dialog: New Blueprint (`cp-create-blueprint-dialog`)

**Source file**: `ui/src/components/create-blueprint-dialog.ts`

Centered modal, width `480px`.

```
┌─ New Blueprint ──────────────────────────────────┐
│                                                  │
│  Name *                                          │
│  [e.g. HR Team, Dev Squad              ]         │
│                                                  │
│  Description                                     │
│  [What this team does...               ]         │
│  [                                     ]         │
│                                                  │
│  Icon                                            │
│  [Emoji or icon name                   ]         │
│                                                  │
│  Tags                                            │
│  [Comma-separated, e.g. hr, legal      ]         │
│                                                  │
│  Color                                           │
│  [✕] [●] [●] [●] [●] [●] [●] [●] [●]           │
│                                                  │
│                        [Cancel]  [Create]        │
└──────────────────────────────────────────────────┘
```

### Fields

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | Free text. Create button disabled if empty. |
| **Description** | No | Resizable textarea |
| **Icon** | No | Emoji or free text |
| **Tags** | No | CSV string (e.g., "hr, legal") |
| **Color** | No | Selector for 8 preset colors + "none" option (✕). Circular swatches 28px. |

### Preset Colors

`#4f6ef7` (blue), `#10b981` (green), `#f59e0b` (amber), `#ef4444` (red), `#8b5cf6` (violet), `#06b6d4` (cyan), `#f97316` (orange), `#ec4899` (pink).

Selected swatch: white border + scale 1.1.

---

## Screen — Agent Templates (`cp-agent-templates-view`)

**Source file**: `ui/src/components/agent-templates-view.ts`  
**Route**: `#/agent-templates`

Gallery view for standalone reusable agent blueprints (`agent_blueprints` table). Independent of team blueprints and instances.

```
┌─ Templates ──────────────────────────────────────────────────────┐
│  Agent Templates                    [Import YAML]  [+ New Template] │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ 🤖 My Agent      │  │ 🛠 Tool Agent     │                     │
│  │ [user]           │  │ [tool]            │                     │
│  │ Description...   │  │ Description...    │                     │
│  │ [View] [Clone]   │  │ [View] [Clone]    │                     │
│  │         [Delete] │  │         [Delete]  │                     │
│  └──────────────────┘  └──────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

### Elements

| Element | Description |
|---|---|
| **Header** | Title "Agent Templates" + action buttons |
| **[Import YAML]** | Opens file picker → imports agent blueprint from YAML file |
| **[+ New Template]** | Opens `cp-create-agent-template-dialog` modal |
| **Template cards** | Grid (min 280px per card). Each card: icon, name, category badge (user/tool/system), description truncated to 2 lines, [View], [Clone], [Delete] |
| **[View]** | Navigates to `#/agent-templates/:id` |
| **[Clone]** | Duplicates blueprint → navigates to clone detail |
| **[Delete]** | Confirmation → deletes blueprint |
| **Empty state** | Icon + "No templates yet" + hint |

---

## Screen — Agent Template Detail (`cp-agent-template-detail`)

**Source file**: `ui/src/components/agent-template-detail.ts`  
**Route**: `#/agent-templates/:id`

Detail view for a single agent blueprint template with metadata display and file editing.

```
┌─ Agent Template Detail ──────────────────────────────────────────┐
│  [← Back]  🤖 My Agent  [user]              [Export YAML]       │
│                                                                  │
│  Description: ...                                                │
│  Category: user                                                  │
│                                                                  │
│  ┌─ Files ────────────────────────────────────────────────────┐  │
│  │ SOUL.md  [Edit]                                            │  │
│  │ IDENTITY.md  [Edit]                                        │  │
│  │ AGENTS.md  [Edit]                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [File editor: cp-agent-file-editor]                             │
└──────────────────────────────────────────────────────────────────┘
```

### Elements

| Element | Description |
|---|---|
| **[← Back]** | Navigates to `#/agent-templates` |
| **Title** | Icon + name + category badge |
| **[Export YAML]** | Downloads blueprint as YAML file |
| **Description** | Read-only metadata display |
| **Files list** | Lists workspace files for this blueprint; click [Edit] to open `cp-agent-file-editor` |
| **`cp-agent-file-editor`** | Inline textarea editor for workspace files (SOUL.md, IDENTITY.md, etc.) with [Save] and [Cancel] |

---

## Dialog — Create Agent Template (`cp-create-agent-template-dialog`)

**Source file**: `ui/src/components/create-agent-template-dialog.ts`

Modal for creating a new standalone agent blueprint.

```
┌─ New Agent Template ─────────────────────────────────────────────┐
│                                                                  │
│  Name *                                                          │
│  [Agent name                                          ]          │
│                                                                  │
│  Description                                                     │
│  [What this agent does...                             ]          │
│                                                                  │
│  Category                                                        │
│  ( user  ) ( tool  ) ( system )                                  │
│                                                                  │
│  Seed default workspace files                                    │
│  [☑] Create SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md           │
│                                                                  │
│                              [Cancel]  [Create Template]         │
└──────────────────────────────────────────────────────────────────┘
```

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | Free text, 1–100 chars. Create button disabled if empty. |
| **Description** | No | Textarea, up to 500 chars |
| **Category** | No | Radio: `user` (default) · `tool` · `system` |
| **Seed files** | No | If checked, creates default workspace files (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md) |

---

*Updated: 2026-03-16 - v0.28.5: Instance Card redesign (⚡ runtime badge, ⚠ PERM pill, simplified menu), expanded Settings sidebar (7 panels: General/Agents/Runtime/Channels/MCP/Permissions/Config), added components cp-instance-channels, cp-instance-mcp, cp-instance-permissions, cp-instance-config, cp-permission-request-overlay, cp-bus-alerts*

*Updated: 2026-03-17 - v0.37.0: replaced cp-runtime-chat with cp-runtime-pilot (17 components) — part display (tool calls, reasoning, subtasks, compaction), side LLM context panel (token gauge, tools, agent info, system prompt, event log), SSE expanded to 17 event types*

*Updated: 2026-03-18 - v0.41.24: complete documentation of cp-runtime-pilot (17 components), branding fix OpenClaw → claw-runtime, added hash route #/instances/:slug/pilot, tools profile correction (minimal/messaging/coding/full), version updates*

*Updated: 2026-03-19 - v0.41.39: added Agent Templates section (cp-agent-templates-view, cp-agent-template-detail, cp-create-agent-template-dialog, cp-agent-file-editor), new nav tab Templates, new hash routes #/agent-templates and #/agent-templates/:id*
