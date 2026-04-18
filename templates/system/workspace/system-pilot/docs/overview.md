# ClawPilot Platform Overview

ClawPilot is a self-hosted platform that orchestrates multiple AI agent instances on a single server, providing a unified dashboard, REST API, and CLI for managing AI teams.

## What ClawPilot Does

ClawPilot lets you run several independent AI agent instances side by side. Each instance is an isolated runtime daemon with its own port, agents, tools, and conversation history. A central dashboard ties everything together: create instances, monitor health, manage API keys, and chat with agents — all from one place.

## Core Concepts

| Concept | Description |
|---|---|
| **Instance** | A runtime daemon process bound to a unique port. Contains one or more agents. Config stored in SQLite registry.db. |
| **Agent** | An AI entity inside an instance. Has a role, model, tool profile, workspace files, and persistence mode. |
| **Blueprint** | A reusable template that defines a team of agents. Deploy a blueprint to bootstrap an instance with pre-configured agents. |
| **Flow** | A DAG (directed acyclic graph) workflow. Steps execute sequentially or in parallel, each step delegated to an agent. |
| **Named API Key** | An encrypted, globally shared credential for AI providers (OpenAI, Anthropic, Mistral, etc.). Instances reference keys by name. |
| **Channel** | A communication interface: web (dashboard), Telegram bot, or CLI. Agents can receive messages from any channel. |

## Architecture

```
CLI (claw-pilot)
    │
    ▼
Dashboard (Hono server, port 19000)
    │
    ├── Web UI (Lit web components)
    ├── REST API (~160 endpoints)
    ├── SSE streaming (agent responses)
    └── WebSocket (health monitoring)
    │
    ▼
SQLite registry.db (source of truth)
    │
    ▼
Instance runtimes (claw-runtime engine processes)
    ├── Instance A (port 18789)
    ├── Instance B (port 18790)
    └── Instance C (port 18791)
```

### Dashboard

The dashboard runs on port 19000 by default. It serves the web UI and exposes the REST API. All instance management goes through the dashboard — the CLI is a thin wrapper around the same API.

### Registry Database

`registry.db` is the single source of truth for all configuration: instances, agents, API keys, blueprints, users, budgets, and more. It uses SQLite with FTS5 for full-text search. The file lives in `~/.claw-pilot/registry.db`.

### Instance Runtimes

Each instance runs as a separate `claw-runtime` process. The dashboard spawns and manages these processes. Ports are allocated from the range 18789–18838 (up to 50 concurrent instances).

## System Instance

A special instance called `cp-system` is auto-provisioned on first launch. It contains the `system-pilot` agent (that's me) plus several subagents for administrative tasks. The system instance handles platform-level operations like creating instances, managing keys, and monitoring health.

## Supported Languages

The dashboard UI supports 6 languages: English, French, German, Spanish, Italian, and Portuguese. Language detection is automatic based on browser settings.

## Key Directories

| Path | Purpose |
|---|---|
| `~/.claw-pilot/` | Main config directory (DB, logs, state) |
| `~/.claw-pilot/registry.db` | SQLite database (source of truth) |
| `~/.claw-pilot/instances/<slug>/` | Per-instance state directory (PID files, runtime snapshots) |
| `~/.claw-pilot/instances/<slug>/workspace/` | Agent workspace files (SOUL.md, docs, etc.) |

*ClawPilot v0.74.1*
