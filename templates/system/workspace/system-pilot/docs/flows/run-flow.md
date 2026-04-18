# Running a Flow

Flow execution is asynchronous. Starting a run returns immediately with a run ID while the flow engine processes steps in the background. Steps are executed in topological order with parallel execution for independent steps.

## Starting a Run

```
POST /api/instances/:slug/flows/:id/run
```

Returns:

```json
{
  "runId": "run-abc123",
  "status": "pending",
  "flowId": "flow-xyz",
  "createdAt": "2026-04-17T10:00:00Z"
}
```

The run transitions from `pending` to `running` as the first step begins execution.

## Execution Engine

The flow engine processes steps using these stages:

1. **Topological sort** — steps are ordered respecting all `dependsOn` constraints
2. **Parallel dispatch** — independent steps (no unfinished dependencies) launch concurrently via `Promise.race`
3. **Step execution** — for each step, the engine creates an agent session, injects the briefing, and runs the agent
4. **SITREP collection** — when the agent calls `complete_step`, the SITREP is recorded
5. **Downstream evaluation** — after a step completes, the engine evaluates which downstream steps are now unblocked
6. **Outcome gating** — if a step failed and `continueOnFailure` is false, dependent steps are skipped

## Step Execution Detail

When a step begins, the flow engine:

1. Creates an ephemeral agent session for the target agent
2. Injects a **briefing** containing:
   - The step's mission prompt
   - SITREPs from all upstream (completed) steps
   - Flow context (flow name, step ID, run ID)
3. Starts the agent's prompt loop with the configured `maxSteps`
4. Waits for the agent to call the `complete_step` tool with a SITREP

### SITREP Schema

The agent must call `complete_step` with the following structure:

| Field | Type | Description |
|---|---|---|
| `outcome` | enum | `success`, `failure`, or `partial` |
| `summary` | string | What was accomplished or why it failed |
| `keyFindings` | string[] | Notable observations, results, or data points |

If the agent exhausts its `maxSteps` without calling `complete_step`, the step is marked as failed with an auto-generated SITREP.

## maxSteps and Dynamic Extension

Each step has a `maxSteps` limit (default 50) controlling how many LLM interaction rounds the agent can perform. If the agent needs more steps during execution, it can call the `request_step_extension` tool to request an additional +20 steps. The hard cap is 200 steps per step execution — no extensions are granted beyond that limit.

| Parameter | Value |
|---|---|
| Default maxSteps | 50 |
| Extension increment | +20 per request |
| Hard cap | 200 |

## Step Timeout and Retry

| Setting | Range | Default | Description |
|---|---|---|---|
| `timeout` | 1s to 10min | — | Maximum wall-clock time for a step |
| `retries` | 0 to 5 | 0 | Number of retry attempts on failure |

When a step times out, it is treated as a failure. If retries are configured, the engine re-executes the step up to the specified number of times before marking it as permanently failed.

## Run Statuses

| Status | Meaning |
|---|---|
| `pending` | Run created, no steps started yet |
| `running` | At least one step is currently executing |
| `completed` | All steps finished with `success` or `partial` outcome |
| `failed` | One or more steps failed and blocked downstream completion |
| `cancelled` | Run was manually cancelled |

## Cancelling a Run

```
POST /api/instances/:slug/flows/runs/:runId/cancel
```

Cancellation stops all currently executing steps and prevents pending steps from starting. Steps already completed retain their SITREPs. The run status changes to `cancelled`.

## Viewing Run Results

```
GET /api/instances/:slug/flows/runs/:runId
```

Returns the full run record including:

| Field | Description |
|---|---|
| `status` | Current run status |
| `steps` | Array of step run records with their SITREPs |
| `tokens` | Total token usage across all steps |
| `cost` | Total cost in USD across all steps |
| `startedAt` | When the run began executing |
| `completedAt` | When the run finished (or was cancelled) |

Each step run record includes the agent session ID, SITREP JSON, result text, individual token counts, and cost.

## Monitoring Active Runs

Active flow runs appear in the instance's Flows tab with a real-time status indicator. The dashboard polls for status updates and displays step progress as each step completes. Completed steps show their SITREP outcome badge (success/failure/partial).

*ClawPilot v0.74.1*
