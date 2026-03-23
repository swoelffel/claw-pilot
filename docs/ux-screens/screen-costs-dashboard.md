# Screen — Cost Dashboard (`cp-costs-dashboard`)

> **Source**: `ui/src/components/costs-dashboard.ts`
> **Route**: `#/instances/:slug/costs`
> **Entry point**: Instance card "Costs" action or sidebar navigation

Per-instance token and cost analytics. Fetches data from 4 cost API endpoints, displays summary cards, a stacked bar chart (daily costs by model), a sortable agent cost table, and a donut chart (token distribution by model).

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Costs — my-instance                    [ 7d | 30d | All ] │
└─────────────────────────────────────────────────────────────────┘

┌─ Summary cards ─────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ TOTAL COST│  │TOTAL TOKENS│ │ TOKENS IN │ │ MESSAGES │       │
│  │  $12.34  │  │   1.2M   │  │  980.5k  │  │   342    │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘

┌─ Daily Costs ───────────────────────────────────────────────────┐
│  $                                                              │
│  │ ██                                                           │
│  │ ██ ██       ██                                               │
│  │ ██ ██ ██ ██ ██ ██ ██                                         │
│  └──03/15──03/16──03/17──03/18──03/19──03/20──03/21──          │
│  (stacked bars, one color per model)                            │
└─────────────────────────────────────────────────────────────────┘

┌─ By Agent ─────────────────┐  ┌─ By Model ─────────────────────┐
│  AGENT    IN    OUT  COST % │  │       ┌───────┐               │
│  ceo    120k   45k  $3.20 26%│ │      /  donut  \  ● opus-4-6  │
│  dev    89k    38k  $2.10 17%│ │     | chart    |  ● sonnet-4-6│
│  ...                        │  │      \        /   ● haiku-4-5 │
│  (sortable columns)         │  │       └───────┘               │
└─────────────────────────────┘  └────────────────────────────────┘
```

## Header

| Element | Description |
|---|---|
| **← Back** | Gray outline button, accent hover. Emits `navigate { view: "cluster" }`. |
| **Title** | "Costs — {slug}" (`font-size: 20px`, `font-weight: 700`). |
| **Period selector** | Segmented control: `7d`, `30d`, `All`. Active button: `--accent` background, white text. |

## Summary Cards

4 cards in responsive grid (`grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))`).

| Card | Label | Value format | Source |
|---|---|---|---|
| **Total Cost** | `TOTAL COST` | USD (`$12.34`) | `summary.totalCostUsd` |
| **Total Tokens** | `TOTAL TOKENS` | Compact (`1.2M`, `980.5k`) | `summary.totalTokensIn + summary.totalTokensOut` |
| **Tokens In** | `TOKENS IN` | Compact | `summary.totalTokensIn` |
| **Messages** | `MESSAGES` | Integer | `summary.messageCount` |

Card style: `--bg-surface` background, `--bg-border` border, `--radius-lg`. Label: 12px uppercase muted. Value: 24px mono bold.

## Daily Costs Chart (SVG)

Stacked bar chart rendered inline as SVG (`viewBox`-based, responsive width).

| Element | Description |
|---|---|
| **Bars** | One bar per day, stacked by model. Bar width: 24px, gap: 8px. |
| **Colors** | Per-model: opus `#a78bfa`, sonnet `#60a5fa`, haiku `#34d399`, fallback `#94a3b8`. |
| **Y axis** | 3 ticks (0, mid, max) with dashed grid lines, USD labels (mono 10px). |
| **X axis** | Day labels (MM/DD format, mono 9px). |
| **Tooltips** | Native SVG `<title>` on each rect: "model: $X.XX". |

Empty state: centered "No data for this period" message.

## By Agent Table

Sortable table in left column of a 2-column grid.

| Column | Font | Sortable | Description |
|---|---|---|---|
| **Agent** | UI font | Yes | Agent ID |
| **In** | Mono | Yes | Input tokens (compact format) |
| **Out** | Mono | Yes | Output tokens (compact format) |
| **Cost** | Mono | Yes | USD cost |
| **%** | Mono | No | Percentage of total cost |

Sort behavior: click header to sort descending, click again to toggle ascending. Active sort column: `--accent` color + arrow indicator (▲/▼).

Default sort: `costUsd` descending.

## By Model Donut (SVG)

SVG donut chart in right column, rendered via `stroke-dasharray` on circles.

| Element | Description |
|---|---|
| **Donut** | `r=60`, `stroke-width=20`, centered in 160×160 viewBox. |
| **Segments** | One per model, same color palette as daily chart, `opacity: 0.85`. |
| **Legend** | Vertical list beside donut: color dot + model name + "X.X% · $Y.YY". |
| **Tooltips** | SVG `<title>` on each segment. |

## Data Fetching

All 4 endpoints called in parallel on mount and when `slug` or `_period` changes.

| Endpoint | Response type |
|---|---|
| `GET /api/instances/:slug/costs/summary?period=` | `CostSummary` |
| `GET /api/instances/:slug/costs/daily?period=` | `DailyCost[]` |
| `GET /api/instances/:slug/costs/by-agent?period=` | `AgentCost[]` |
| `GET /api/instances/:slug/costs/by-model?period=` | `ModelCost[]` |

**Auto-refresh**: polling every 5 minutes (`setInterval`, cleared on disconnect).

## Responsive

- Two-column layout (`1fr 1fr`) collapses to single column below 800px.
- Summary cards grid auto-fits with `minmax(180px, 1fr)`.
- Chart card has `overflow-x: auto` for horizontal scrolling on narrow viewports.

## States

| State | Display |
|---|---|
| **Loading** | Centered "Loading costs…" (shown only on first load, not on auto-refresh). |
| **Error** | Centered red error message. |
| **Empty** | Per-section "No data" / "No agent data" / "No model data" messages. |
| **Loaded** | Full dashboard with all 4 sections. |

## i18n

All strings use `msg("...", { id: "costs-*" })` prefix. 12 keys across 6 locales.
