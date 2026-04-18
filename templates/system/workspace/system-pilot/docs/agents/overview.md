# Agent Concepts Overview

An agent is an AI entity within a ClawPilot instance, defined by its model, tools, persistence mode, archetype, and workspace files. This document covers all key agent properties and concepts.

## What Is an Agent

Each agent is a configured AI persona that lives inside an instance. An instance can host multiple agents with different roles. Agents can communicate with each other, share workspace files, and be targeted by specific channels.

## Agent Properties

| Property | Description | Values |
|---|---|---|
| `id` | Unique identifier within the instance | kebab-case (e.g. `code-reviewer`) |
| `name` | Display name | Free text |
| `model` | Primary AI model | e.g. `claude-sonnet-4-20250514` |
| `fallbackModels` | Ordered list of fallback models | Used if primary model is unavailable |
| `toolProfile` | Which tools the agent can access | `minimal`, `messaging`, `coding`, `full`, `pilot` |
| `persistence` | Session lifetime | `permanent` or `ephemeral` |
| `archetype` | Behavioral archetype | `orchestrator`, `generator`, `analyst`, `planner`, `coder` |
| `promptMode` | How much context is injected | `full` or `minimal` |
| `kind` | Agent visibility | `primary` or `system` |
| `isDefault` | Receives unaddressed messages | `true` or `false` |

## Tool Profiles

Tool profiles control what capabilities an agent has access to:

| Profile | Description | Example Use |
|---|---|---|
| `minimal` | Basic text generation only | Simple Q&A agent |
| `messaging` | Can send messages to other agents and channels | Coordinator agent |
| `coding` | File read/write, shell commands, git operations | Developer agent |
| `full` | All available tools including web search, MCP | Research agent |
| `pilot` | Full tools plus instance management capabilities | System-pilot, admin agents |

## Persistence Modes

| Mode | Behavior |
|---|---|
| `permanent` | Shared conversation session across all channels. History persists between interactions. Agent remembers previous conversations. |
| `ephemeral` | Task-scoped session. Each new task or conversation starts fresh. No memory of prior interactions. |

## Archetypes

Archetypes define the behavioral pattern of an agent:

| Archetype | Behavior |
|---|---|
| `orchestrator` | Coordinates other agents, delegates tasks, manages workflows |
| `generator` | Produces content — code, text, documents, images |
| `analyst` | Examines data, reviews code, evaluates options |
| `planner` | Creates plans, breaks down tasks, designs approaches |
| `coder` | Writes, debugs, and refactors code with coding tools |

## Prompt Modes

| Mode | What Is Injected |
|---|---|
| `full` | SOUL.md (identity), AGENTS.md (team roster), BOOTSTRAP.md (first contact instructions), USER.md (user context), workspace knowledge files |
| `minimal` | Nothing injected — agent receives only the user message and tool definitions |

Use `full` for agents that need context about their role and team. Use `minimal` for stateless utility agents or when you want maximum control over the prompt.

## Agent Kinds

| Kind | Description |
|---|---|
| `primary` | User-facing agent. Appears in the Pilot view agent selector. Can be chatted with directly. |
| `system` | Internal agent. Not shown in the agent selector. Invoked by other agents or by flows. |

## Default Agent

One agent per instance is marked as the **default agent**. When a message arrives without targeting a specific agent (e.g. typing in the main chat), it routes to the default agent. Typically this is the primary orchestrator or the main user-facing agent.

## Agent-to-Agent Communication (A2A)

Agents within the same instance communicate via **A2A spawn links**. An agent can spawn a task for another agent and receive its response. This enables delegation patterns:

- Orchestrator receives user request
- Spawns subtask to specialist agent (e.g. coder, analyst)
- Receives result and synthesizes final response

A2A is asynchronous and tool-based — the calling agent uses a tool to spawn the task.

## Workspace Files

Each agent has access to workspace files that shape its behavior:

| File | Purpose |
|---|---|
| `SOUL.md` | Agent identity, personality, instructions, constraints |
| `AGENTS.md` | Roster of all agents in the instance with their roles and capabilities |
| `BOOTSTRAP.md` | First-contact message or onboarding instructions |
| `USER.md` | Context about the user (preferences, role, project) |
| `docs/` | Knowledge base files indexed by FTS5 for ws_search_files |

These files live in `~/.claw-pilot/instances/<slug>/workspace/<agent-id>/` and are injected into the agent prompt when `promptMode` is `full`.

*ClawPilot v0.74.1*
