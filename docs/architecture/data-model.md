# Data Model (SQLite)

> Part of [claw-pilot Functional Architecture](README.md)

---

## Tables

| Table | Migration | Role |
|---|---|---|
| `servers` | base | Physical server (V1: always 1 local row) |
| `instances` | base + v4 + v8 + v10 | Instances — slug, port, state, config_path, state_dir |
| `agents` | base → v3 + v7 + v13 | Agents per instance or blueprint (polymorphic FK since v3) |
| `ports` | base | Port reservation registry (anti-conflict) |
| `config` | base | Global key-value config |
| `events` | base | Audit log per instance |
| `agent_files` | v2 | Workspace files per agent — content + hash |
| `agent_links` | v2 → v3 | Links between agents (`a2a` or `spawn`) |
| `blueprints` | v3 | Reusable team templates |
| `users` | v6 | Dashboard auth — admin/operator/viewer |
| `sessions` | v6 | Server sessions with TTL and sliding window |
| `rt_sessions` | v8 + v11 + v13 + v14 | claw-runtime sessions — permanent (1 per agent, cross-channel) or ephemeral. Key: `<slug>:<agentId>` (permanent) or `<slug>:<agentId>:<channel>:<peerId>` (ephemeral) |
| `rt_messages` | v8 + v14 | Messages per session (composite index `session_id, role` in v14) |
| `rt_parts` | v8 | Message parts (text, tool-call, tool-result, reasoning, subtask, compaction) |
| `rt_permissions` | v8 | Persisted permission rules (allow/deny/ask per scope+pattern) |
| `rt_auth_profiles` | v8 | API key rotation per provider (priority, cooldown, failure tracking) |
| `rt_pairing_codes` | v9 + v12 | Device pairing codes (legacy, table retained) |
| `agent_blueprints` | v16 | Standalone reusable agent templates (id TEXT PK, config_json, category) |
| `agent_blueprint_files` | v16 | Workspace files per agent blueprint |
| `user_profiles` | v17 | Per-user preferences (language, timezone, communication style, custom instructions) |
| `user_providers` | v17 (deprecated v24) | User-level provider configs — replaced by `named_api_keys` |
| `rt_events` | v19 | Runtime bus events per instance (activity console) |
| `named_api_keys` | v24 | AES-256-GCM encrypted API keys (admin-global, provider_id, default_model) |
| `instance_named_keys` | v24 (deprecated v25) | Junction: instance <> named key (replaced by FK on instances) |
| `rt_system_prompts` | v26 | System prompt snapshots per session (deduplicated by content hash) |
| `rt_budgets` | v27 | Per-instance/agent budget limits (monthly/lifetime, soft alert 80%, hard stop 100%, override +20%) |
| `rt_budget_events` | v27 | Budget audit trail (soft_alert, hard_stop, reset, override, reconcile) |
| `discovered_models` | v28 | Models discovered from provider APIs (provider_id + model_id PK, capabilities JSON, cost JSON) |
| `discovery_status` | v28 | Provider discovery status (last_success, last_error, model_count) |
| `rt_tasks` | v29 + v30 | Task board — title, status (pending/in_progress/completed/blocked/cancelled), priority, assignee, labels JSON, position, type (task/epic), parent_id (epic hierarchy) |
| `rt_task_comments` | v29 | Task discussion threads (author_id, content, FK CASCADE on task delete) |
| `rt_task_activities` | v31 | Activity timeline per task — 9 activity types with field-level diff tracking |
| `search_index` | v32 | FTS5 global search (BM25, 5 entity types: instance, agent, task, blueprint, agent_blueprint) |
| `search_index_map` | v32 | Shadow mapping table for FTS5 index management |
| `rt_flow_definitions` | v33 | Workflow definitions — name, steps DAG (JSON), trigger config (manual/bus), enabled |
| `rt_flow_runs` | v33 | Workflow execution runs — status (5 states), trigger, timing, error |
| `rt_flow_step_runs` | v33 | Per-step execution — agent, session, SITREP JSON (`outcome`, `summary`, `keyFindings`), tokens, cost, retry count |
| `agent_files_fts` | v36 | FTS5 virtual table — full-text search over `agent_files` content (content-backed, BM25 with snippet) |

## Added columns

**v17–v26**:
- `agents.config_json` (v20) — full RuntimeAgentConfig as JSON blob
- `agents.named_key_id` (v24) — optional FK to named_api_keys
- `instances.runtime_config_json` (v21) — full RuntimeConfig as JSON blob (source of truth)
- `instances.default_named_key_id` (v25) — default named key FK

**v30–v34**:
- `rt_tasks.type` (v30) — task/epic discriminator
- `rt_tasks.parent_id` (v30) — self-referential FK for epic hierarchy
- `instances.is_system` (v34) — system instance flag (HOMEBOT)

**v35–v36**:
- `ports` table: port derivation now includes username salt for multi-user isolation (v35)
- `agent_files_fts` FTS5 virtual table (v36) + INSERT/UPDATE/DELETE triggers to keep index in sync; initial population from existing rows

## Migration rules

**Current migration version: 36**

**Default port range**: 18789–18838 (50 ports, 10 instances at 5-port intervals). Dashboard: 19000.

**Migration rule**: always additive (ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS). Never use DROP COLUMN / DROP TABLE without table recreation — migrations are irreversible in production.

Full schema reference: [registry-db.md](../registry-db.md)

---

*Updated: 2026-04-16 — v0.73.5, schema v36, 35 tables (+ FTS5 virtual table)*
