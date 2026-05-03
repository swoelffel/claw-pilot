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
+---------------------+
|  Stop               |  <- red if running / Start green if stopped
|  ---                |
|  Pilot              |  <- visible if state === "running"
|  Agents             |  <- visible if running OR agentCount > 0
|  Tasks              |  <- always
|  Flows              |  <- always
|  Triggers           |  <- always (added PR #175)
|  Settings           |  <- always
|  Costs              |  <- always
|  Activity           |  <- always
|  Memory             |  <- always
|  Heartbeat          |  <- always
|  Session Logs       |  <- always
|  Restart            |  <- visible if state === "running"
|  ---                |
|  Delete             |  <- danger, separated
+---------------------+
```

| Item | i18n id | Condition | Behavior |
|---|---|---|---|
| **Stop / Start** | — | Always | Call `stopInstance` / `startInstance` API. Disabled during `_loading`. |
| **Pilot** | `btn-pilot` | `state === "running"` | Emit `navigate { view: "pilot", slug }` |
| **Agents** | — | `state === "running"` OR `agentCount > 0` | Emit `navigate { view: "agents-builder", slug }` |
| **Tasks** | `btn-tasks` | Always | `navigate { view: "tasks", slug }` |
| **Flows** | `btn-flows` | Always | `navigate { view: "flows", slug }` |
| **Triggers** | `btn-triggers` | Always | `navigate { view: "triggers", slug }` |
| **Settings** | `btn-settings` | Always | `navigate { view: "instance-settings", slug }` |
| **Costs** | `btn-costs` | Always | `navigate { view: "costs", slug }` |
| **Activity** | `btn-activity` | Always | `navigate { view: "activity", slug }` |
| **Memory** | `btn-memory` | Always | `navigate { view: "memory", slug }` |
| **Heartbeat** | `btn-heartbeat` | Always | `navigate { view: "heartbeat", slug }` |
| **Session Logs** | `btn-session-logs` | Always | `navigate { view: "session-logs", slug }` |
| **Restart** | — | `state === "running"` | Call `restartInstance(slug)` API |
| **Delete** | — | Always | Emit `request-delete { slug }` (confirmation handled by parent) |

All items: `stopPropagation()` + `_menuOpen = false` before action.

## Behaviors

- **Card body click** (zones 2, 3, 4 — excluding `···` and start/stop buttons): emits `navigate { view: "instance-dashboard", slug }` → routes to `#/instances/:slug/dashboard` (`cp-instance-dashboard`). `cursor: pointer`. Hover background: `--bg-hover` (150ms transition).
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
