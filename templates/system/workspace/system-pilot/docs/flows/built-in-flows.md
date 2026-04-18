# Built-in Flows

The cp-system instance ships with 6 pre-configured flows that cover common platform operations. These flows are auto-provisioned from `templates/system/cp-system.flows.json` on first launch and provide ready-to-use workflows for health monitoring, onboarding, cost management, configuration backup, and team design.

## Available Flows

| # | Flow Name | Agent | Purpose |
|---|---|---|---|
| 1 | Health Check | analyst | Check all instances health, produce a diagnostic report |
| 2 | Onboarding | system-pilot | Guide a new user through first team setup |
| 3 | Cost Audit | analyst | Review costs across all instances, identify savings |
| 4 | Config Backup | system-pilot | Export configuration snapshot for all instances |
| 5 | Team Builder | architect | Design and provision a new team from a user brief |
| 6 | Team Optimizer | architect | Analyze an existing team and suggest improvements |

## Flow Details

### 1. Health Check

Runs the analyst agent to inspect every registered instance. The agent checks runtime status, port availability, agent responsiveness, and recent error logs. Produces a SITREP with per-instance health scores and any detected issues.

**Use case**: Periodic health monitoring, troubleshooting degraded instances, pre-deployment verification.

### 2. Onboarding

An interactive flow that walks a new user through creating their first team. The system-pilot agent asks about the user's goals, suggests a team blueprint, provisions the instance, and verifies the setup. Designed as a guided experience with user input at each step.

**Use case**: First-time setup, introduction to ClawPilot concepts, guided instance creation.

### 3. Cost Audit

The analyst agent reviews token usage and cost data across all instances for the current billing period. Identifies high-cost agents, inefficient model choices, and optimization opportunities. Produces a cost breakdown with actionable recommendations.

**Use case**: Monthly cost review, budget optimization, identifying runaway agents.

### 4. Config Backup

Exports a configuration snapshot of all instances as team YAML files. The system-pilot agent iterates through registered instances, extracts their agent configurations, and produces downloadable backup files. Useful for disaster recovery and environment replication.

**Use case**: Pre-upgrade backup, environment cloning, disaster recovery preparation.

### 5. Team Builder

The architect agent takes a user-provided brief describing a desired team and designs a complete agent configuration. It selects appropriate archetypes, tool profiles, models, and writes workspace files (SOUL.md). Then provisions the instance with the designed team.

**Use case**: Creating specialized teams from high-level requirements, rapid prototyping.

### 6. Team Optimizer

The architect agent analyzes an existing team's configuration, usage patterns, and performance metrics. It identifies suboptimal model assignments, missing agent capabilities, redundant roles, and suggests concrete improvements.

**Use case**: Periodic team review, performance tuning, cost-performance balance optimization.

## Auto-Provisioning

Built-in flows are provisioned during cp-system instance initialization. The provisioning process is **idempotent** — re-running it skips any flow that already exists (matched by name). This means:

- Upgrading ClawPilot does not duplicate built-in flows
- Manual modifications to built-in flows are preserved across upgrades
- Deleting a built-in flow and restarting will re-create it with the default definition

## Custom Flows

Users are not limited to built-in flows. Custom flows can be created for any instance through the flow editor or REST API. Custom flows use the same engine and support all the same features (DAG steps, SITREPs, outcome propagation, parallel execution).

## Running Built-in Flows

Built-in flows are run the same way as any other flow:

1. Navigate to the cp-system instance's **Flows** tab
2. Select the desired flow
3. Click **Run** (or use `POST /api/instances/cp-system/flows/:id/run`)
4. Monitor progress in the run detail view

Some flows (like Onboarding and Team Builder) require user interaction during execution. The agent will prompt for input through the active chat channel.

## Flow Template Format

Built-in flows are defined in `cp-system.flows.json` using the standard flow definition schema. Each entry specifies the flow name, description, steps array with agent IDs, prompts, and dependencies. The template file is read once during provisioning and is not monitored for changes at runtime.

*ClawPilot v0.74.1*
