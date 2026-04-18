# Creating a Flow

Flows are created via the dashboard flow editor or the REST API. A flow definition specifies a name, description, steps array, and trigger configuration. Each step targets an agent with a mission prompt and optional dependencies on other steps.

## Flow Definition Structure

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique flow name within the instance |
| `description` | string | no | Human-readable purpose of the flow |
| `steps` | array | yes | Ordered list of step definitions |
| `trigger` | object | no | Trigger configuration (manual only for now) |

## Step Definition

Each step in the `steps` array has the following fields:

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | yes | — | Unique step identifier within the flow |
| `agentId` | string | yes | — | ID of the agent that executes this step |
| `prompt` | string | yes | — | Mission text describing what the agent should accomplish |
| `dependsOn` | string[] | no | `[]` | Step IDs that must complete before this step starts |
| `maxSteps` | number | no | `50` | Maximum LLM interaction steps for this step |
| `continueOnFailure` | boolean | no | `false` | Whether downstream steps proceed if this step fails |

## Creating via REST API

```
POST /api/instances/:slug/flows
Content-Type: application/json

{
  "name": "Code Review Pipeline",
  "description": "Automated code review with analysis and reporting",
  "steps": [
    {
      "id": "analyze",
      "agentId": "code-analyst",
      "prompt": "Analyze the latest pull request for code quality issues, security vulnerabilities, and test coverage gaps.",
      "maxSteps": 30
    },
    {
      "id": "review",
      "agentId": "code-reviewer",
      "prompt": "Review the analysis findings and produce a detailed review report with actionable recommendations.",
      "dependsOn": ["analyze"]
    },
    {
      "id": "summarize",
      "agentId": "report-writer",
      "prompt": "Summarize the review into an executive summary suitable for the team lead.",
      "dependsOn": ["review"],
      "continueOnFailure": true
    }
  ]
}
```

The API validates the DAG (no cycles, valid step references) and returns the created flow definition with its generated `id`.

## Creating via Dashboard Flow Editor

The dashboard provides a visual flow editor with a DAG canvas:

1. Navigate to the instance's **Flows** tab
2. Click **+ New Flow**
3. Enter flow name and description
4. Add steps by clicking the **+ Add Step** button
5. For each step: select the target agent, write the mission prompt, configure maxSteps
6. Draw dependency edges by connecting steps on the canvas
7. Click **Save** to validate and persist the flow

The visual editor displays steps as nodes and dependencies as directed edges. Steps can be repositioned on the canvas for clarity.

## DAG Validation Rules

The flow engine enforces these rules at creation time:

| Rule | Error |
|---|---|
| Cycle detected in step dependencies | `FLOW_CYCLE_DETECTED` |
| `dependsOn` references a non-existent step ID | `FLOW_INVALID_DEPENDENCY` |
| No entry point (all steps have dependencies) | `FLOW_NO_ENTRY_POINT` |
| Duplicate step IDs | `FLOW_DUPLICATE_STEP_ID` |

If validation fails, the flow is not created and the error response includes a descriptive message.

## Step Configuration Guidelines

### maxSteps

The `maxSteps` parameter limits how many LLM interaction rounds the agent can perform within a single step. Default is 50. Set lower for simple tasks (10-20) and higher for complex research or coding tasks. During execution, agents can request a dynamic extension of +20 steps using the `request_step_extension` tool, up to a hard cap of 200.

### continueOnFailure

Set `continueOnFailure: true` on non-critical steps where downstream work should proceed even if this step fails. For example, a notification step that sends a Telegram message should not block the rest of the flow if the message fails to send.

## Trigger Configuration

Currently, flows support manual triggers only. The trigger configuration is reserved for future scheduled execution support. To run a flow after creation, use the run endpoint:

```
POST /api/instances/:slug/flows/:id/run
```

## Updating a Flow

```
PATCH /api/instances/:slug/flows/:id
Content-Type: application/json

{
  "description": "Updated description",
  "steps": [ ... ]
}
```

The same DAG validation rules apply when updating steps. Active runs of the flow are not affected by definition changes.

*ClawPilot v0.74.1*
