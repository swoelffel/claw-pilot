# Screen — Heartbeat Heatmap (`cp-heartbeat-heatmap`)

> **Source**: `ui/src/components/heartbeat-heatmap.ts`
> **Route**: `#/instances/:slug/heartbeat`
> **Entry point**: Instance card "Heartbeat" action or sidebar navigation

Consolidated SVG heatmap view of all agents' heartbeat ticks for a configurable period (7/14/30 days). Shows per-agent heatmap grids (days × 24 hours) with summary cards and schedule configuration.

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Heartbeat Heatmap                       [ 7d | 14d | 30d ] │
└─────────────────────────────────────────────────────────────────┘

┌─ Summary cards ─────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ ACTIVE AGENTS│  │TOTAL TICKS│  │  ALERTS  │  │  UPTIME  │   │
│  │      3       │  │   1,247  │  │    2     │  │  99.8%   │   │
│  └──────────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─ Agent: pilot (every 5m · 08:00–22:00 · Europe/Paris) ─────────┐
│  Ticks: 842   Alerts: 1   Last: 12m ago                        │
│  ┌─ Heatmap (SVG) ──────────────────────────────────────────┐   │
│  │ 00│ ██ ██ ██ ██ ██ ██ ██                                 │   │
│  │ 01│ ░░ ░░ ░░ ░░ ░░ ░░ ░░   (gray = inactive hours)     │   │
│  │...│                                                       │   │
│  │ 08│ ██ ██ ██ ██ ██ ██ ██   (green = OK ticks)            │   │
│  │ 09│ ██ ██ ██ ██ 🟨 ██ ██   (amber = alert in hour)       │   │
│  │...│                                                       │   │
│  │ 22│ ██ ██ ██ ██ ██ ██ ██                                 │   │
│  │ 23│ ░░ ░░ ░░ ░░ ░░ ░░ ░░                                │   │
│  │   Apr02 Apr03 Apr04 Apr05 Apr06 Apr07 Apr08              │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ● OK   ● Alert   ● Missing   ● Inactive                       │
└─────────────────────────────────────────────────────────────────┘
```

## Header

| Element | Description |
|---|---|
| **← Back** | Gray outline button, accent hover. Emits `navigate { view: "cluster" }`. |
| **Title** | "Heartbeat Heatmap" (`font-size: 20px`, `font-weight: 700`). |
| **Period selector** | Segmented control: `7d`, `14d`, `30d`. Active button: `--accent` background, white text. Default: 7d. |

## Summary Cards

4 cards in responsive grid (`grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`).

| Card | Label | Value style |
|---|---|---|
| **Active Agents** | `ACTIVE AGENTS` | Default `--text-primary` |
| **Total Ticks** | `TOTAL TICKS` | Locale-formatted number |
| **Alerts** | `ALERTS` | Amber (`--state-warning`) if > 0 |
| **Uptime** | `UPTIME` | Green (`--state-running`), percentage |

Card style: `--bg-surface` background, `--bg-border` border, `--radius-lg`. Label: 11px uppercase muted. Value: 22px mono bold.

## Per-Agent Section

One section per agent (sorted alphabetically). `--bg-surface` card with border and padding.

### Agent header

| Element | Style |
|---|---|
| **Agent name** | 15px, `font-weight: 700`, `--text-primary` |
| **Config** | 12px, `--text-muted`. Shows: interval (`every 5m`), active hours (`08:00–22:00`), timezone, or "always active" |

### Agent stats

12px `--text-secondary`. Shows: Ticks count, Alerts count, Last tick relative time.

### Heatmap Grid (SVG)

Inline SVG with `viewBox`-based responsive sizing.

| Dimension | Value |
|---|---|
| **Cell size** | 18×18px |
| **Gap** | 2px |
| **Y-axis** | Hour labels 00–23 (mono 10px, `--text-muted`), 32px width |
| **X-axis** | Date labels (e.g., "Apr03", mono 9px, `--text-muted`), 24px height |
| **Columns** | One per day in selected period |
| **Rows** | 24 (one per hour) |

### Cell colors

| State | Fill | Opacity |
|---|---|---|
| **OK** (ticks > 0, no alerts) | `--state-running` (green) | 1.0 |
| **Alert** (ticks > 0, alerts > 0) | `--state-warning` (amber) | 1.0 |
| **Missing** (active hour, no ticks) | `--state-error` (red) | 1.0 |
| **Inactive** (outside active hours) | `--bg-border` (gray) | 0.3 |

Each cell has a native SVG `<title>` tooltip: `"2026-04-03 08:00 — 12 ticks"` or `"— no ticks"` or `"— inactive"`.

### Legend

Horizontal flex below heatmap, 11px `--text-muted`. Four items: OK (green), Alert (amber), Missing (red), Inactive (gray). Each with 10×10px colored dot.

## Data Fetching

Both endpoints called in parallel on mount and when `slug` or period changes.

| Endpoint | Response type |
|---|---|
| `GET /api/instances/:slug/heartbeat/schedule` | `{ agents: HeartbeatScheduleAgent[] }` |
| `GET /api/instances/:slug/heartbeat/heatmap?days=` | `{ buckets: HeartbeatHourBucket[], stats: HeartbeatAgentStats[] }` |

**Auto-refresh**: 5 minutes (`setInterval`, cleared on disconnect).

## States

| State | Display |
|---|---|
| **Loading** | Centered "Loading..." (min-height 300px). |
| **Error** | Centered error message in `--state-error` color. |
| **Empty** | Centered "No heartbeat configured for this instance". |
| **Loaded** | Summary cards + per-agent sections. |

## i18n

All strings use `msg("...", { id: "hb-*" })` prefix. 10 keys across 6 locales.
