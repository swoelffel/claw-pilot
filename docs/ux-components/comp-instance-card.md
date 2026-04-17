# Instance Card (`cp-instance-card`)

> **Source**: `ui/src/components/instance-card.ts`

## Mockup

```
┌────────────────────────────────────────────┐
│  My instance  SYSTEM      ●  [···]             │  ← header (● has title tooltip)
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

## Typography Hierarchy

| Element | Size | Weight | Color |
|---|---|---|---|
| `display_name` (or slug if absent) | 16px | 700 | `--text-primary` |
| `slug` (if display_name defined) | 11px | 400 | `--text-muted`, monospace |
| Model | 13px | 400 | `--text-secondary`, monospace |
| Port | 11px | 400 | `--text-muted`, monospace |

## Zone 1 — Header

Flex row `justify-content: space-between`, `gap: 10px`.

**Left side:**

| Element | Description |
|---|---|
| **display_name** | `font-size: 16px`, `font-weight: 700`, `--text-primary`. If `display_name` is null, displays slug instead. |
| **SYSTEM badge** *(conditional)* | Pill `10px`, `font-weight: 600`, `--accent` background, white text. Displayed only if `is_system` is true. |
| **slug** *(conditional)* | `font-size: 11px`, `--text-muted`, monospace, `margin-top: 2px`. Displayed only if `display_name` is defined. |

**Right side** (`card-header-right`, flex row `gap: 8px`):

| Element | Description |
|---|---|
| **State dot** | Colored dot (or spinner when transitioning) with state label as `title` tooltip. No text label displayed. |
| **`···` button** | 28×28px menu button. Opens action popover on click. `open` class when active. |

**Badge states:**

| State | Color |
|---|---|
| `running` | Green `--state-running` |
| `stopped` | Gray `--state-stopped` |
| `error` | Red `--state-error` |
| `unknown` | Gray |

## Zone 2 — Status bar

Flex row, `gap: 10px`, `flex-wrap: wrap`, separated from header and meta by `--bg-border` borders. Hidden if no indicators to display (`items.length === 0`).

| Indicator | Condition | Style |
|---|---|---|
| `◉ Gateway` | `state === "running"` AND `gateway === "healthy"` | Green `--state-running` |
| `◎ Gateway KO` | `state === "running"` AND `gateway === "unhealthy"` | Red `--state-error` |
| `✈ @bot` | `telegram_bot` defined AND `telegram !== "disconnected"` | Pill blue `#0088cc` |
| `✈ @bot ⚠` | `telegram_bot` defined AND `telegram === "disconnected"` | Pill amber `--state-warning` |
| `⬡ N agent(s)` | `agentCount > 0` | Text `--text-muted` |
| `⚠ PERM` | `pendingPermissions > 0` | Clickable red pill → `navigate { view: "pilot" }`. `font-weight: 700`. |

## Zone 3 — Meta

Flex column, `gap: 4px`.

| Field | Condition | Style |
|---|---|---|
| **Model** | If `default_model` defined. Smart resolution: if JSON `{"primary":"..."}`, extracts `primary` key. | `font-size: 13px`, `--text-secondary`, monospace |
| **Port** | Always. | `font-size: 11px`, `--text-muted`, monospace |

## Zone 4 — Error *(conditional)*

`font-size: 11px`, `--state-error`, `margin-top: 8px`. Displayed if a start/stop/restart action fails. Message resolved via `userMessage()`.

## Menu popover `···`

Opened on `···` button click. Closed on outside click (listener `document click`). Position `absolute`, `top: calc(100% + 4px)`, `right: 0`, `z-index: 100`, `min-width: 164px`, `box-shadow: 0 4px 20px rgba(0,0,0,0.45)`.

```
┌─────────────────────┐
│  ■  Stop            │  ← red if running / ▶ Start green if stopped
│  ─────────────────  │
│  ⚡ Pilot            │  ← visible if state === "running"
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
| **⚡ Pilot** | `state === "running"` | Normal | Emit `navigate { view: "pilot", slug }` |
| **⬡ Agents** | `state === "running"` OR `agentCount > 0` | Normal | Emit `navigate { view: "agents-builder", slug }` |
| **⚙ Settings** | Always | Normal | Emit `navigate { view: "instance-settings", slug }` |
| **↺ Restart** | `state === "running"` | Normal | Call `restartInstance(slug)` API |
| **✕ Delete** | Always | Red `.danger` | Emit `request-delete { slug }` (confirmation handled by parent) |

All items: `stopPropagation()` + `_menuOpen = false` before action.

## Behaviors

- **`···` click**: `stopPropagation()` + toggle `_menuOpen`
- **Outside click**: close popover via `document click` listener (added in `connectedCallback`, removed in `disconnectedCallback`)
- **PERM pill click**: `stopPropagation()` + `navigate { view: "pilot" }`

## Real-time Data (WebSocket)

The `health_update` handler in `app.ts` broadcasts the following fields to `InstanceInfo` on each tick:

| Field | Type |
|---|---|
| `gateway` | `"healthy" \| "unhealthy" \| "unknown"` |
| `state` | `"running" \| "stopped" \| "error" \| "unknown"` |
| `agentCount` | `number` |
| `pendingDevices` | `number` |
| `pendingPermissions` | `number` |
| `telegram` | `"connected" \| "disconnected" \| "not_configured"` |

## Related

- Screens: [Instances View](../ux-screens/screen-instances.md)
