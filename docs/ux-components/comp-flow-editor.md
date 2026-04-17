# Component — Flow Editor (`cp-flow-editor`)

> **Source**: `ui/src/components/flow-editor.ts`
> **Used in**: Flow List (`cp-flow-list`) — as create/edit dialog

Dialog for creating and editing flow definitions. Manages the DAG step structure, agent assignment, and trigger configuration.

## Mockup

```
┌─ Flow Editor Dialog ─────────────────────────────────────────┐
│  Create Flow                                          [✕]    │
│                                                               │
│  Name          [daily-report                         ]       │
│  Description   [Generate daily project report        ]       │
│                                                               │
│  ── Steps ────────────────────────────────────────────       │
│  ┌─ Step 1 ─────────────────────────────────────────┐        │
│  │  ID: research   Agent: [analyst ▾]               │        │
│  │  Prompt: [Research latest project metrics...]    │        │
│  │  Depends on: (none)                               │        │
│  │  Timeout: [300s]  Retries: [1]           [✕]     │        │
│  └───────────────────────────────────────────────────┘        │
│  ┌─ Step 2 ─────────────────────────────────────────┐        │
│  │  ID: draft      Agent: [writer ▾]                │        │
│  │  Prompt: [Draft report based on research...]     │        │
│  │  Depends on: [research]                           │        │
│  │  Timeout: [600s]  Retries: [0]           [✕]     │        │
│  └───────────────────────────────────────────────────┘        │
│  [+ Add Step]                                                 │
│                                                               │
│                            [Cancel]  [Create Flow]            │
└───────────────────────────────────────────────────────────────┘
```

## Props

| Property | Type | Description |
|---|---|---|
| `slug` | `string` | Instance slug |
| `flowId` | `number \| undefined` | Flow ID for editing (undefined = create) |

## Step Fields

| Field | Type | Notes |
|---|---|---|
| **ID** | Text | Unique step identifier within the flow |
| **Agent** | `<select>` | Agent from instance (fetched from builder API) |
| **Prompt** | Textarea | Instruction for the agent |
| **Depends on** | Multi-select | Other step IDs (DAG dependencies) |
| **Timeout** | Number | Seconds (default: 300, range: 1-600) |
| **Retries** | Number | Retry count (default: 0, range: 0-5) |

**Advanced panel** (v0.73.4+):

| Field | Type | Notes |
|---|---|---|
| **Max steps** | Number | Max LLM steps for this step (default: 50). Serialized in JSON only when non-default. |
| **Continue on failure** | Checkbox | When checked, this step runs even if upstream dependencies returned `failure`/`partial` outcome. Default: false. |

## Validation

- Flow name required and unique per instance
- At least 1 step required
- Step IDs must be unique
- DAG cycle detection (server-side via topological sort)
- Dependency references must exist

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/instances/:slug/agents/builder` | Agent list for step assignment |
| `GET /api/instances/:slug/flows/:id` | Load existing flow (edit mode) |
| `POST /api/instances/:slug/flows` | Create new flow |
| `PUT /api/instances/:slug/flows/:id` | Update existing flow |

## Events

| Event | Direction | Description |
|---|---|---|
| `flow-saved` | editor → flow-list | Flow created/updated successfully |
| `editor-close` | editor → flow-list | User cancelled or closed |

## i18n

Uses `msg("...", { id: "flow-editor.*" })` prefix.

---

*Since v0.68.0 (FLOW-001) — advanced step fields (maxSteps, continueOnFailure) since v0.73.4*
