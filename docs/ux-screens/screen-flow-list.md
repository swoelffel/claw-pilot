# Screen — Flow List (`cp-flow-list`)

> **Source**: `ui/src/components/flow-list.ts`
> **Route**: `#/instances/:slug/flows`
> **Entry point**: Instance sidebar "Flows" navigation

Workflow definitions list with run/edit/delete actions and embedded flow editor dialog.

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Flows                                  [+ New Flow]   │
└─────────────────────────────────────────────────────────────────┘

┌─ Flow Table ────────────────────────────────────────────────────┐
│  Name         Steps  Trigger   Last run       Status    Actions │
│  ──────────── ────── ──────── ────────────── ──────── ──────── │
│  daily-report   3    manual   Apr 14, 10:32  completed  ▶ ✎ ✕  │
│  code-review    5    manual   Apr 13, 16:20  failed     ▶ ✎ ✕  │
│  onboarding     2    manual   --             --         ▶ ✎ ✕  │
└─────────────────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug — required for all API calls |

## Table Columns

| Column | Description |
|---|---|
| **Name** | Flow definition name (mono) |
| **Steps** | Step count (parsed from steps_json) |
| **Trigger** | Trigger type: `manual` or `bus` |
| **Last run** | Timestamp of most recent run (or `--`) |
| **Status** | Last run status with color coding |
| **Actions** | Run (▶), Edit (✎), Delete (✕) buttons |

## Status Colors

| Status | Color |
|---|---|
| `pending` | `--text-muted` |
| `running` | `--state-info` (cyan) |
| `completed` | `--state-running` (green) |
| `failed` | `--state-error` (red) |
| `cancelled` | `--state-warning` (amber) |

## Flow Editor

Clicking "New Flow" or Edit opens `cp-flow-editor` as a dialog overlay. The editor handles DAG step definition, validation, and save.

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/flows` | List flow definitions with last run info |
| `POST /api/instances/:slug/flows/:id/run` | Execute flow (async) |
| `DELETE /api/instances/:slug/flows/:id` | Delete flow definition |
| `PUT /api/instances/:slug/flows/:id` | Update flow (toggle enabled) |

Auto-refresh every 15s while connected.

## Navigation

Clicking a flow run status navigates to `#/instances/:slug/flows/runs/:runId` for detailed execution view.

## States

| State | Display |
|---|---|
| **Loading** | Centered spinner |
| **Error** | Error message |
| **Empty** | "No flows defined" with create button |
| **Instance stopped** | Run buttons disabled, info message |

## i18n

All strings use `msg("...", { id: "flow.*" })` prefix.

---

*Since v0.68.0 (FLOW-001)*
