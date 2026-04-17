# Screen — Flow Run Detail (`cp-flow-run-detail`)

> **Source**: `ui/src/components/flow-run-detail.ts`
> **Route**: `#/instances/:slug/flows/runs/:runId`
> **Entry point**: Flow List → click on run status

Detailed view of a single flow execution: step progress, SITREP extraction, tokens, cost, timing.

## Mockup

```
┌─ Header ────────────────────────────────────────────────────────┐
│  ← Back   Run #42 — daily-report              [Cancel]          │
│  Status: running   Started: Apr 14 10:32   Duration: 2m 15s    │
└─────────────────────────────────────────────────────────────────┘

┌─ Steps ─────────────────────────────────────────────────────────┐
│  Step          Agent       Status     Duration  Tokens    Cost  │
│  ──────────── ─────────── ────────── ──────── ──────── ─────── │
│  ● research   analyst     completed  45s       12.4k    $0.03  │
│  ● draft      writer      running    1m 30s    --       --     │
│  ○ review     reviewer    pending    --        --       --     │
│                                                                  │
│  ┌─ SITREP (research) ──────────────────────────────────────┐   │
│  │  Summary: Found 3 relevant articles on topic...          │   │
│  │  Key findings: [bullet list]                              │   │
│  │  Confidence: high                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `runId` | `string` | Flow run ID |

## Run Header

| Element | Description |
|---|---|
| **Back** | Navigate to flow list |
| **Run ID** | `Run #<id> — <flowName>` |
| **Cancel** | Cancel button (visible only when status is `running`) |
| **Status** | Color-coded status badge |
| **Started** | Timestamp |
| **Duration** | Live counter (or final if completed) |

## Steps Table

| Column | Description |
|---|---|
| **Status dot** | ● filled (completed/running/failed), ○ empty (pending/skipped) |
| **Step ID** | Step name from DAG definition |
| **Agent** | Assigned agent ID |
| **Status** | Color-coded status: pending, running, completed, failed, cancelled, skipped |
| **Duration** | Elapsed time (live for running, final for completed) |
| **Tokens** | Input + output token count |
| **Cost** | USD cost for step |

## SITREP Panel

When a completed step has SITREP data (`sitrep_json`), it renders as an expandable panel below the step row. Since v0.73.2, SITREPs are structured:

| Field | Description |
|---|---|
| **Outcome** | `success` (green), `failure` (red), `partial` (amber) badge |
| **Summary** | 1-2000 char agent summary |
| **Key findings** | Optional bullet list |

A missing SITREP renders as `outcome: "failure"` with a note that the step completed without reporting.

## Outcome-driven skipping (v0.73.0+)

Steps with `outcome: "failure"` or `"partial"` automatically mark downstream dependent steps as `skipped` (displayed with `○` empty dot). Steps with `continueOnFailure: true` in the DAG definition are exempt from skip propagation and run regardless of upstream outcomes (visible as a gray "resilient" badge on the step row).

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/flows/runs/:runId` | Run detail with steps, SITREP, tokens, cost |
| `POST /api/instances/:slug/flows/runs/:runId/cancel` | Cancel running flow |

Polls every 5s while run status is `running` or `pending`.

## Status Colors

Same as flow-list: pending (muted), running (cyan), completed (green), failed (red), cancelled (amber), skipped (secondary).

## States

| State | Display |
|---|---|
| **Loading** | Centered spinner |
| **Error** | Error message with back button |
| **Not found** | "Run not found" message |

## i18n

All strings use `msg("...", { id: "flow-run.*" })` prefix.

---

*Since v0.68.0 (FLOW-001) — SITREP schema + outcome-driven skipping since v0.73.0–v0.73.2*
