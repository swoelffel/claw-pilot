# Data Sources — Where State Lives

Canonical reference for **where to look** when investigating any concept in ClawPilot.

## Golden rule

**The SQLite database `~/.claw-pilot/registry.db` is the single source of truth for all configuration and runtime state.** Query it through the `cp_*` tools (preferred) or the dashboard HTTP API. For raw inspection, use `sqlite3 ~/.claw-pilot/registry.db`.

**Never read filesystem artifacts to answer configuration or state questions.** Several legacy or derived files exist on disk — they are snapshots, caches, or debug dumps, and they drift from the DB. Reading them leads to wrong answers.

## Forbidden sources for investigation

| File | Why it's forbidden |
|------|-------------------|
| `~/.claw-pilot/instances/<slug>/runtime.json` | **Deprecated.** Legacy snapshot from before schema v20 (agents.config_json). Not kept in sync. |
| `~/.claw-pilot/instances/<slug>/workspaces/**` | These are agent workspace files (SOUL.md, HEARTBEAT.md, AGENTS.md…) — they are inputs to agents, not runtime state. They tell you what an agent was configured to do, not what it did. |
| `HEARTBEAT.md` | Only loaded during a heartbeat tick as part of the agent's system prompt. It is NOT the heartbeat schedule config. |
| `runtime.pid` | Only tells you the PID of the runtime daemon. For liveness use the health API. |
| `.env` files | Only gateway token + optional Telegram bot token. All other secrets (API keys) are encrypted in the DB. |

## Canonical source per concept

| Concept | Where it lives | How to read it |
|---------|---------------|----------------|
| **Instance configuration** (models, settings, env) | `instances.runtime_config_json` | `cp_instance_get` / `GET /api/instances/:slug` |
| **Instance lifecycle state** (running/stopped/error) | `instances.state` + in-memory `Monitor._transitioning` | `cp_health_check` / `GET /api/health` |
| **Agent configuration** (role, model, prompt, tools, temperature, **heartbeat schedule**, budget, permissions) | `agents.config_json` | `cp_agent_get` / `GET /api/instances/:slug/agents/:id` |
| **Heartbeat tick history** | `rt_events` where `type LIKE 'heartbeat.%'` | `GET /api/instances/:slug/heartbeat/history` |
| **Sessions** (permanent + ephemeral) | `rt_sessions` | `cp_session_list` / `GET /api/instances/:slug/sessions` |
| **Messages / conversation history** | `rt_messages` + `rt_parts` | dashboard chat UI or `db-analyst` subagent |
| **Runtime events** (all bus events) | `rt_events` | `GET /api/instances/:slug/events` |
| **Flow definitions** | `rt_flow_definitions` | `GET /api/instances/:slug/flows` |
| **Flow runs / step results** | `rt_flow_runs` + `rt_flow_step_runs` | `GET /api/instances/:slug/flows/runs` |
| **Task board activity** | `rt_task_activities` | task board UI |
| **Named API keys** (encrypted) | `named_api_keys` | `cp_named_key_list` (metadata only — plaintext never exposed) |
| **Blueprints** (team templates) | `blueprints` + `agent_blueprints` | `cp_blueprint_list` |
| **Agent workspace files** (SOUL.md, AGENTS.md, USER.md, HEARTBEAT.md, MEMORY.md…) | `agent_files` (for instance agents) / `agent_blueprint_files` (for blueprints) | `cp_agent_file_get` |
| **Permissions** (allow/deny/ask rules) | `rt_permissions` | permissions UI |
| **Notifications** | `notifications` | notification inbox UI |
| **User preferences** | `user_profiles` | settings UI |
| **Dashboard auth** (users, sessions) | `users`, `sessions` | auth API |
| **Global config** (key-value) | `config` | `cp_config_get` |
| **Budget / cost tracking** | derived from `rt_sessions.total_cost` + `agents.config_json.budget` | cost analytics UI |

## When you need data that isn't exposed by a `cp_*` tool

Delegate to the **`db-analyst`** subagent — it has direct read-only access to `registry.db` and knows the full schema. Don't try to read the DB file yourself; always go through the tool or delegate.

## Schema reference

The authoritative schema lives in `src/db/schema.ts`. Current version: **37**. Migrations are always additive (no DROP COLUMN/TABLE).

For a human-readable table reference, see `docs/registry-db.md` in the main project docs.
