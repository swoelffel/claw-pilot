# Flows Overview

Flows are a declarative DAG (Directed Acyclic Graph) workflow engine for orchestrating multi-step agent tasks. A flow defines a sequence of steps, each executed by a designated agent, with dependencies that control execution order and parallelism. Flows enable complex, multi-agent workflows with outcome-driven control.

## What Is a Flow

A flow is a structured workflow where each step delegates a mission to an agent. Steps can run in parallel when they have no dependencies, or sequentially when one step depends on the output of another. The flow engine manages execution, tracks state, and propagates results between steps.

## Core Concepts

| Concept | Description |
|---|---|
| **Flow definition** | A named DAG describing steps, their agents, prompts, and dependencies |
| **Step** | A single unit of work within a flow, executed by one agent |
| **SITREP** | Situation Report — the structured output of each step (outcome, summary, key findings) |
| **Run** | A single execution of a flow definition, tracking status and results |
| **DAG** | Directed Acyclic Graph — steps form a graph with no cycles |
| **dependsOn** | Array of step IDs that must complete before a step can start |

## Flow Execution Model

```
Step A (no deps)  ──┐
                    ├──► Step C (depends on A, B)  ──► Step D (depends on C)
Step B (no deps)  ──┘
```

Steps A and B run in parallel because they have no dependencies. Step C waits for both A and B to complete. Step D runs after C finishes. This fan-out/fan-in pattern enables efficient parallel execution.

## SITREP Schema

Each step produces a SITREP (Situation Report) when the agent calls the `complete_step` tool:

| Field | Type | Description |
|---|---|---|
| `outcome` | enum | `success`, `failure`, or `partial` |
| `summary` | string | Human-readable summary of what was accomplished |
| `keyFindings` | string[] | List of notable findings, observations, or results |

SITREPs from upstream steps are injected into the briefing of downstream steps, enabling context propagation through the flow.

## Outcome-Driven Control

The flow engine uses step outcomes to control downstream execution:

| Upstream Outcome | Default Behavior | With `continueOnFailure: true` |
|---|---|---|
| `success` | Downstream steps proceed | Downstream steps proceed |
| `partial` | Downstream steps proceed | Downstream steps proceed |
| `failure` | Downstream steps are **skipped** | Downstream steps **proceed** |

When a step fails and `continueOnFailure` is not set, all dependent steps are skipped. This prevents wasted computation on tasks that depend on failed prerequisites.

## Flow Run Statuses

| Status | Description |
|---|---|
| `pending` | Run created but not yet started |
| `running` | At least one step is actively executing |
| `completed` | All steps finished (success or partial) |
| `failed` | One or more steps failed and blocked completion |
| `cancelled` | Run was manually cancelled before completion |

## DAG Validation

When a flow definition is created or updated, the engine validates the step graph:

- No cycles allowed (topological sort must succeed)
- All `dependsOn` references must point to valid step IDs within the same flow
- At least one step must have no dependencies (entry point)
- Step IDs must be unique within the flow

Invalid DAGs are rejected at creation time with a descriptive error message.

## Storage

Flow definitions are stored in `rt_flow_definitions`. Each run is recorded in `rt_flow_runs`, and individual step executions in `rt_flow_step_runs`. Step runs include the agent session ID, SITREP JSON, result text, token counts, and cost.

## When to Use Flows

Flows are ideal when a task involves multiple agents working in sequence or parallel with structured handoffs. Common use cases include:

- Multi-stage analysis pipelines (gather data, analyze, report)
- Code review workflows (lint, test, review, summarize)
- Operational runbooks (health check, diagnose, remediate, verify)
- Content pipelines (research, draft, edit, publish)

For simple single-agent tasks, use direct chat or task assignment instead.

*ClawPilot v0.74.1*
