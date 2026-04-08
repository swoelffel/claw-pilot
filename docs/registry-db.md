# claw-pilot — Registry Database (`registry.db`)

SQLite database at `~/.claw-pilot/registry.db`. WAL mode, foreign keys enforced.  
Current schema version: **28**. Source of truth: `src/db/schema.ts`.

---

## Schema overview

```
servers ──< instances ──< agents ──< agent_files
                    │              └──< (skills, config_json, named_key_id)
                    ├──< agent_links
                    ├──< events
                    ├──< ports
                    ├──< rt_sessions ──< rt_messages ──< rt_parts
                    │              └──< rt_system_prompts
                    ├──< rt_events
                    ├──< rt_permissions
                    ├──< rt_auth_profiles
                    ├──< rt_pairing_codes
                    ├──< rt_budgets ──< rt_budget_events
                    ├──< instance_named_keys ──> named_api_keys
                    └──< (runtime_config_json, default_named_key_id)

discovered_models  (provider_id + model_id composite PK)
discovery_status   (provider_id PK)

blueprints ──< agents ──< agent_files
           └──< agent_links

agent_blueprints ──< agent_blueprint_files

users ──< sessions
     └──< user_profiles

named_api_keys  (admin-global encrypted keys)
config  (global key-value)
schema_version  (single row)
```

`agents` and `agent_links` use a **polymorphic FK**: each row belongs to either an `instance` or a `blueprint`, never both (enforced by CHECK constraint).

`rt_*` tables are scoped to `claw-runtime` instances only.

---

## Tables — Complete column definitions

### `schema_version`

| Column | Type | Constraints |
|--------|------|-------------|
| `version` | INTEGER | NOT NULL |

### `servers`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `hostname` | TEXT | NOT NULL |
| `ip` | TEXT | |
| `ssh_user` | TEXT | |
| `ssh_port` | INTEGER | DEFAULT 22 |
| `openclaw_home` | TEXT | NOT NULL |
| `openclaw_bin` | TEXT | |
| `openclaw_version` | TEXT | |
| `os` | TEXT | |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

### `instances`

| Column | Type | Constraints | Added |
|--------|------|-------------|-------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | base |
| `server_id` | INTEGER | NOT NULL REFERENCES servers(id) | base |
| `slug` | TEXT | NOT NULL UNIQUE | base |
| `display_name` | TEXT | | base |
| `port` | INTEGER | NOT NULL UNIQUE | base |
| `state` | TEXT | DEFAULT 'unknown' CHECK(IN running,stopped,error,unknown) | base |
| `config_path` | TEXT | NOT NULL | base |
| `state_dir` | TEXT | NOT NULL | base |
| `systemd_unit` | TEXT | NOT NULL | base |
| `telegram_bot` | TEXT | | base |
| `default_model` | TEXT | | base |
| `discovered` | INTEGER | DEFAULT 0 | base |
| `created_at` | TEXT | | base |
| `updated_at` | TEXT | | base |
| `instance_type` | TEXT | NOT NULL DEFAULT 'openclaw' CHECK(IN openclaw,claw-runtime) | v8 |
| `runtime_config_json` | TEXT | (full RuntimeConfig JSON blob — source of truth) | v21 |
| `default_named_key_id` | INTEGER | REFERENCES named_api_keys(id) ON DELETE SET NULL | v25 |

### `agents`

| Column | Type | Constraints | Added |
|--------|------|-------------|-------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | base |
| `instance_id` | INTEGER | REFERENCES instances(id) ON DELETE CASCADE | base |
| `blueprint_id` | INTEGER | REFERENCES blueprints(id) ON DELETE CASCADE | v3 |
| `agent_id` | TEXT | NOT NULL | base |
| `name` | TEXT | NOT NULL | base |
| `model` | TEXT | | base |
| `workspace_path` | TEXT | NOT NULL | base |
| `is_default` | INTEGER | DEFAULT 0 | base |
| `role` | TEXT | | v2 |
| `tags` | TEXT | | v2 |
| `notes` | TEXT | | v2 |
| `position_x` | REAL | | v2 |
| `position_y` | REAL | | v2 |
| `config_hash` | TEXT | | v2 |
| `synced_at` | TEXT | | v2 |
| `skills` | TEXT | (JSON array or NULL = all) | v7 |
| `created_at` | TEXT | | v13 |
| `config_json` | TEXT | (full RuntimeAgentConfig JSON blob) | v20 |
| `named_key_id` | INTEGER | REFERENCES named_api_keys(id) ON DELETE SET NULL | v24 |

CHECK: `instance_id` XOR `blueprint_id` must be set.  
UNIQUE: `(instance_id, agent_id)` and `(blueprint_id, agent_id)`.

### `ports`

| Column | Type | Constraints |
|--------|------|-------------|
| `server_id` | INTEGER | NOT NULL REFERENCES servers(id) |
| `port` | INTEGER | NOT NULL |
| `instance_slug` | TEXT | |

PRIMARY KEY: `(server_id, port)`.

### `config`

| Column | Type | Constraints |
|--------|------|-------------|
| `key` | TEXT | PRIMARY KEY |
| `value` | TEXT | NOT NULL |

Default values: `port_range_start=18789`, `port_range_end=18838`, `dashboard_port=19000`, `health_check_interval_ms=10000`, `openclaw_user=openclaw`.

### `events`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `instance_slug` | TEXT | |
| `event_type` | TEXT | NOT NULL |
| `detail` | TEXT | |
| `created_at` | TEXT | |

### `agent_files` (v2)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `agent_id` | INTEGER | NOT NULL REFERENCES agents(id) ON DELETE CASCADE |
| `filename` | TEXT | NOT NULL |
| `content` | TEXT | |
| `content_hash` | TEXT | |
| `updated_at` | TEXT | |

UNIQUE: `(agent_id, filename)`.

### `agent_links` (v2→v3)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `instance_id` | INTEGER | REFERENCES instances(id) ON DELETE CASCADE |
| `blueprint_id` | INTEGER | REFERENCES blueprints(id) ON DELETE CASCADE |
| `source_agent_id` | TEXT | NOT NULL |
| `target_agent_id` | TEXT | NOT NULL |
| `link_type` | TEXT | NOT NULL CHECK(IN a2a,spawn) |

CHECK: `instance_id` XOR `blueprint_id`.  
UNIQUE: `(instance_id, source, target, type)` and `(blueprint_id, source, target, type)`.

### `blueprints` (v3)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `name` | TEXT | NOT NULL UNIQUE |
| `description` | TEXT | |
| `icon` | TEXT | |
| `tags` | TEXT | (JSON array since v10) |
| `color` | TEXT | |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

### `users` (v6)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `username` | TEXT | NOT NULL UNIQUE |
| `password_hash` | TEXT | NOT NULL |
| `role` | TEXT | NOT NULL DEFAULT 'admin' CHECK(IN admin,operator,viewer) |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

### `sessions` (v6)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `user_id` | INTEGER | NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `expires_at` | TEXT | NOT NULL |
| `last_seen_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `ip_address` | TEXT | |
| `user_agent` | TEXT | |

Indexes: `idx_sessions_user_id`, `idx_sessions_expires_at`.

### `rt_sessions` (v8+v11+v13+v14)

| Column | Type | Constraints | Added |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | v8 |
| `instance_slug` | TEXT | NOT NULL REFERENCES instances(slug) ON DELETE CASCADE | v8 |
| `parent_id` | TEXT | REFERENCES rt_sessions(id) | v8 |
| `agent_id` | TEXT | NOT NULL | v8 |
| `channel` | TEXT | NOT NULL DEFAULT 'web' | v8 |
| `peer_id` | TEXT | | v8 |
| `title` | TEXT | | v8 |
| `state` | TEXT | NOT NULL DEFAULT 'active' CHECK(IN active,archived) | v8 |
| `permissions` | TEXT | | v8 |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') | v8 |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') | v8 |
| `session_key` | TEXT | | v11 |
| `spawn_depth` | INTEGER | NOT NULL DEFAULT 0 | v11 |
| `label` | TEXT | | v11 |
| `metadata` | TEXT | | v11 |
| `persistent` | INTEGER | NOT NULL DEFAULT 0 | v13 |

UNIQUE partial index: `idx_rt_sessions_key ON (session_key) WHERE parent_id IS NULL`.

Session key formats:
- Permanent: `<slug>:<agentId>` (one per primary agent, cross-channel)
- Ephemeral: `<slug>:<agentId>:<channel>:<peerId>`

### `rt_messages` (v8+v14)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `session_id` | TEXT | NOT NULL REFERENCES rt_sessions(id) ON DELETE CASCADE |
| `role` | TEXT | NOT NULL CHECK(IN user,assistant) |
| `agent_id` | TEXT | |
| `model` | TEXT | |
| `tokens_in` | INTEGER | |
| `tokens_out` | INTEGER | |
| `cost_usd` | REAL | |
| `finish_reason` | TEXT | |
| `is_compaction` | INTEGER | NOT NULL DEFAULT 0 |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Indexes: `idx_rt_messages_session`, `idx_rt_messages_session_role` (v14).

### `rt_parts` (v8)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `message_id` | TEXT | NOT NULL REFERENCES rt_messages(id) ON DELETE CASCADE |
| `type` | TEXT | NOT NULL |
| `state` | TEXT | CHECK(IN pending,running,completed,error) |
| `content` | TEXT | |
| `metadata` | TEXT | |
| `sort_order` | INTEGER | NOT NULL DEFAULT 0 |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Index: `idx_rt_parts_message`.

Part types: `text`, `tool-call`, `tool-result`, `reasoning`, `subtask`, `compaction`.

### `rt_permissions` (v8)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `instance_slug` | TEXT | NOT NULL REFERENCES instances(slug) ON DELETE CASCADE |
| `scope` | TEXT | NOT NULL |
| `permission` | TEXT | NOT NULL |
| `pattern` | TEXT | NOT NULL |
| `action` | TEXT | NOT NULL CHECK(IN allow,deny,ask) |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Index: `idx_rt_permissions_scope ON (instance_slug, scope)`.

### `rt_auth_profiles` (v8)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `instance_slug` | TEXT | NOT NULL REFERENCES instances(slug) ON DELETE CASCADE |
| `provider_id` | TEXT | NOT NULL |
| `api_key_env_var` | TEXT | NOT NULL |
| `priority` | INTEGER | NOT NULL DEFAULT 0 |
| `cooldown_until` | TEXT | |
| `failure_count` | INTEGER | NOT NULL DEFAULT 0 |
| `last_error` | TEXT | |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Index: `idx_rt_auth_profiles_provider ON (instance_slug, provider_id)`.

### `rt_pairing_codes` (v9+v12)

| Column | Type | Constraints |
|--------|------|-------------|
| `code` | TEXT | PRIMARY KEY |
| `instance_slug` | TEXT | NOT NULL REFERENCES instances(slug) ON DELETE CASCADE |
| `channel` | TEXT | NOT NULL DEFAULT 'web' |
| `peer_id` | TEXT | |
| `used` | INTEGER | NOT NULL DEFAULT 0 |
| `expires_at` | TEXT | NOT NULL |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `meta` | TEXT | (JSON, added v12) |

Indexes: `idx_rt_pairing_codes_instance`, `idx_rt_pairing_codes_expires`.

### `agent_blueprints` (v16)

Standalone reusable agent templates, independent of team blueprints and instances. Can be created from scratch, cloned, or saved from an existing instance agent.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | |
| `category` | TEXT | NOT NULL DEFAULT 'user' CHECK(IN user,tool,system) |
| `config_json` | TEXT | NOT NULL DEFAULT '{}' |
| `icon` | TEXT | |
| `tags` | TEXT | |
| `created_at` | TEXT | NOT NULL |
| `updated_at` | TEXT | NOT NULL |

### `agent_blueprint_files` (v16)

Workspace files per agent blueprint (SOUL.md, IDENTITY.md, AGENTS.md, etc.).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `agent_blueprint_id` | TEXT | NOT NULL REFERENCES agent_blueprints(id) ON DELETE CASCADE |
| `filename` | TEXT | NOT NULL |
| `content` | TEXT | NOT NULL DEFAULT '' |
| `content_hash` | TEXT | |
| `updated_at` | TEXT | |

UNIQUE: `(agent_blueprint_id, filename)`.
Index: `idx_agent_blueprint_files_bp ON (agent_blueprint_id)`.

### `user_profiles` (v17)

Per-user preferences injected into agent system prompts.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `user_id` | INTEGER | NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE |
| `display_name` | TEXT | |
| `language` | TEXT | NOT NULL DEFAULT 'fr' |
| `timezone` | TEXT | |
| `communication_style` | TEXT | NOT NULL DEFAULT 'concise' CHECK(IN concise,detailed,technical) |
| `custom_instructions` | TEXT | |
| `default_model` | TEXT | |
| `avatar_url` | TEXT | |
| `ui_preferences` | TEXT | (JSON) |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

### `user_providers` (v17, deprecated v24)

Replaced by `named_api_keys` with encrypted storage. Auto-migrated at startup.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `user_id` | INTEGER | NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `provider_id` | TEXT | NOT NULL |
| `api_key_env_var` | TEXT | NOT NULL |
| `base_url` | TEXT | |
| `priority` | INTEGER | NOT NULL DEFAULT 0 |
| `headers` | TEXT | |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

UNIQUE: `(user_id, provider_id)`.

### `rt_events` (v19)

Runtime bus events per instance for the Activity Console.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `instance_slug` | TEXT | NOT NULL |
| `event_type` | TEXT | NOT NULL |
| `agent_id` | TEXT | |
| `session_id` | TEXT | |
| `level` | TEXT | NOT NULL DEFAULT 'info' CHECK(IN info,warn,error) |
| `summary` | TEXT | |
| `payload` | TEXT | (JSON) |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Indexes: `idx_rt_events_slug_created`, `idx_rt_events_slug_type`, `idx_rt_events_slug_level`.

### `named_api_keys` (v24)

Admin-global named API keys. Encrypted with AES-256-GCM via `MASTER_ENCRYPTION_KEY` env var.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `name` | TEXT | NOT NULL UNIQUE |
| `provider_id` | TEXT | NOT NULL |
| `encrypted_api_key` | TEXT | NOT NULL |
| `default_model` | TEXT | NOT NULL |
| `base_url` | TEXT | |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

### `instance_named_keys` (v24, deprecated v25)

Junction table replaced by `instances.default_named_key_id` FK. Retained for additive-only policy.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `instance_id` | INTEGER | NOT NULL REFERENCES instances(id) ON DELETE CASCADE |
| `named_key_id` | INTEGER | NOT NULL REFERENCES named_api_keys(id) ON DELETE RESTRICT |
| `is_default` | INTEGER | NOT NULL DEFAULT 0 |

UNIQUE: `(instance_id, named_key_id)`.

### `rt_system_prompts` (v26)

System prompt snapshots per session, deduplicated by content hash.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `session_id` | TEXT | NOT NULL REFERENCES rt_sessions(id) ON DELETE CASCADE |
| `prompt_hash` | TEXT | NOT NULL |
| `system_prompt` | TEXT | NOT NULL |
| `built_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Index: `idx_rt_system_prompts_session`.

### `rt_budgets` (v27)

Per-instance and per-agent budget limits with auto-enforcement.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `instance_slug` | TEXT | NOT NULL REFERENCES instances(slug) ON DELETE CASCADE |
| `scope` | TEXT | NOT NULL CHECK(IN agent,instance) |
| `scope_id` | TEXT | (agent_id when scope=agent, NULL for instance) |
| `period` | TEXT | NOT NULL CHECK(IN monthly,lifetime) |
| `limit_usd` | REAL | NOT NULL |
| `spent_usd` | REAL | NOT NULL DEFAULT 0 |
| `soft_alert_pct` | REAL | NOT NULL DEFAULT 0.8 |
| `hard_stop_pct` | REAL | NOT NULL DEFAULT 1.0 |
| `override_pct` | REAL | NOT NULL DEFAULT 0.2 |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 |
| `period_start` | TEXT | |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |
| `updated_at` | TEXT | NOT NULL DEFAULT datetime('now') |

UNIQUE: `(instance_slug, scope, scope_id, period)`.

### `rt_budget_events` (v27)

Budget audit trail for alerts, overrides, and resets.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `budget_id` | INTEGER | NOT NULL REFERENCES rt_budgets(id) ON DELETE CASCADE |
| `event_type` | TEXT | NOT NULL CHECK(IN soft_alert,hard_stop,reset,override,reconcile) |
| `current_usd` | REAL | |
| `limit_usd` | REAL | |
| `message` | TEXT | |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') |

Index: `idx_rt_budget_events_budget`.

### `discovered_models` (v28)

Models discovered from provider APIs. Cached for cold-start persistence.

| Column | Type | Constraints |
|--------|------|-------------|
| `provider_id` | TEXT | NOT NULL |
| `model_id` | TEXT | NOT NULL |
| `name` | TEXT | |
| `api` | TEXT | |
| `capabilities` | TEXT | (JSON) |
| `cost` | TEXT | (JSON) |
| `discovered_at` | TEXT | NOT NULL DEFAULT datetime('now') |

PRIMARY KEY: `(provider_id, model_id)`.

### `discovery_status` (v28)

Provider discovery status for error tracking and polling.

| Column | Type | Constraints |
|--------|------|-------------|
| `provider_id` | TEXT | PRIMARY KEY |
| `last_success` | TEXT | |
| `last_error` | TEXT | |
| `model_count` | INTEGER | |

---

## Migration history

| Version | Changes |
|---------|---------|
| 1 | Base schema: servers, instances, agents, ports, config, events |
| 2 | Added `agent_files`, `agent_links`; enriched `agents` (role, tags, notes, position, config_hash, synced_at) |
| 3 | Added `blueprints`; recreated `agents` + `agent_links` with polymorphic FK (instance_id OR blueprint_id) |
| 4 | Removed `nginx_domain` from `instances` (Nginx support dropped) |
| 5 | Updated `port_range_end` default to 18838 |
| 6 | Added `users` + `sessions` tables for dashboard authentication |
| 7 | Added `skills` column to `agents` (JSON array string or NULL = all skills) |
| 8 | Added `instance_type` to `instances`; added `rt_sessions`, `rt_messages`, `rt_parts`, `rt_permissions`, `rt_auth_profiles` |
| 9 | Added `rt_pairing_codes` for web-chat device pairing |
| 10 | Removed openclaw support — `instance_type` column retained (additive-only) but all instances are now `claw-runtime`. Normalized blueprint tags to JSON array. |
| 11 | Added `session_key` to `rt_sessions`, `spawn_depth`, `label`, `metadata` columns. UNIQUE partial index on `session_key` for root sessions. |
| 12 | Added `meta` (JSON) to `rt_pairing_codes` for storing username/display name. |
| 13 | Added `persistent` flag to `rt_sessions` (permanent sessions). Added `created_at` to `agents`. |
| 14 | Index `idx_rt_messages_session_role` on `(session_id, role)`. **PLAN-16**: archives duplicate permanent sessions (keeps oldest per agent), recalculates permanent keys to `<slug>:<agentId>` (removes peerId). |
| 15 | Relocated instance state directories from `~/.runtime-<slug>/` to `~/.claw-pilot/instances/<slug>/`. Recalculates `state_dir` and `config_path`. |
| 16 | Added `agent_blueprints` and `agent_blueprint_files` tables for standalone reusable agent templates (independent of team blueprints and instances). |
| 17 | Added `user_profiles`, `user_providers`, `user_model_aliases` tables for per-user preferences and provider configs. |
| 18 | Dropped `user_model_aliases` — replaced by dynamic model discovery from provider APIs. |
| 19 | Added `rt_events` table for runtime bus events (activity console). Indexes on slug+created, slug+type, slug+level. |
| 20 | Added `agents.config_json` — full RuntimeAgentConfig as JSON blob. Backfilled from runtime.json. |
| 21 | Added `instances.runtime_config_json` — full RuntimeConfig as JSON blob (source of truth, replaces runtime.json). Backfilled from runtime.json. |
| 22 | Synced `agents.skills` whitelist into `runtime_config_json` — skills column was a dead store. |
| 23 | Replaced vestigial gateway ports with actual web-chat derived ports (djb2 hash, range 19100–19199). Cleared old ports table. |
| 24 | Added `named_api_keys` and `instance_named_keys` tables. Added `agents.named_key_id` FK. AES-256-GCM encrypted key storage. |
| 25 | Added `instances.default_named_key_id` FK — simplifies key assignment (replaces junction table). |
| 26 | Added `rt_system_prompts` table for system prompt snapshots per session (deduplicated by content hash). |
| 27 | Added `rt_budgets` and `rt_budget_events` tables for budget enforcement. Per-instance/agent, monthly/lifetime, soft alert, hard stop, override. |
| 28 | Added `discovered_models` and `discovery_status` tables for dynamic model discovery from provider APIs. Composite PK (provider_id, model_id). |

---

## Key access patterns

All DB access goes through `src/core/registry.ts` facade (16 repositories) — never raw SQL in commands or routes.

### Instance operations

| Operation | Repository | Method |
|-----------|-----------|--------|
| List instances | `InstanceRepository` | `listInstances()` |
| Get instance | `InstanceRepository` | `getInstance(slug)` |
| Create instance | `InstanceRepository` | `createInstance(data)` |
| Update state | `InstanceRepository` | `updateInstanceState(slug, state)` |
| Update fields | `InstanceRepository` | `updateInstance(slug, fields)` |
| Delete instance | `InstanceRepository` | `deleteInstance(slug)` |

### Agent operations

| Operation | Repository | Method |
|-----------|-----------|--------|
| List agents | `AgentRepository` | `listAgents(instanceSlug)` |
| Get agent | `AgentRepository` | `getAgentByAgentId(instanceId, agentId)` |
| Upsert agent (sync) | `AgentRepository` | `upsertAgent(instanceId, data)` |
| Update meta | `AgentRepository` | `updateAgentMeta(agentDbId, fields)` |
| Update position | `AgentRepository` | `updateAgentPosition(agentDbId, x, y)` |
| Delete agent | `AgentRepository` | `deleteAgentById(agentDbId)` |
| Get/write file | `AgentRepository` | `getAgentFileContent()` / `upsertAgentFile()` |
| Replace links | `AgentRepository` | `replaceAgentLinks(instanceId, links)` |

### Blueprint operations

| Operation | Repository | Method |
|-----------|-----------|--------|
| CRUD blueprints | `BlueprintRepository` | `listBlueprints()`, `createBlueprint()`, `updateBlueprint()`, `deleteBlueprint()` |
| Blueprint agents | `BlueprintRepository` | `listBlueprintAgents()`, `createBlueprintAgent()`, `deleteBlueprintAgent()` |
| Blueprint links | `BlueprintRepository` | `listBlueprintLinks()`, `replaceBlueprintLinks()` |
| Builder payload | `BlueprintRepository` | `getBlueprintBuilderData(blueprintId)` |

### Agent blueprint operations

| Operation | Repository | Method |
|-----------|-----------|--------|
| List agent blueprints | `AgentBlueprintRepository` | `listAgentBlueprints()` |
| Get agent blueprint | `AgentBlueprintRepository` | `getAgentBlueprint(id)` |
| Create agent blueprint | `AgentBlueprintRepository` | `createAgentBlueprint(data)` |
| Update agent blueprint | `AgentBlueprintRepository` | `updateAgentBlueprint(id, fields)` |
| Delete agent blueprint | `AgentBlueprintRepository` | `deleteAgentBlueprint(id)` |
| Get/write blueprint file | `AgentBlueprintRepository` | `getAgentBlueprintFile()` / `upsertAgentBlueprintFile()` |

### Other operations

| Operation | Repository | Method |
|-----------|-----------|--------|
| Port allocation | `PortRepository` | `allocatePort()`, `releasePort()`, `getUsedPorts()` |
| Global config | `ConfigRepository` | `getConfig(key)`, `setConfig(key, value)` |
| Log event | `EventRepository` | `logEvent(slug, type, detail?)` |
| Local server | `ServerRepository` | `getLocalServer()`, `upsertLocalServer()` |
| Enriched sessions | `RuntimeSessionRepository` | `listEnrichedSessions(db, slug, opts?)` |
| Runtime events | `RtEventRepository` | `listEvents(slug, opts?)`, `insertEvent()` |
| Cost aggregations | `CostRepository` | `getCostsByAgent(slug)`, `getCostsBySession()` |
| Heartbeat history | `HeartbeatRepository` | `getHeartbeatHistory(slug, opts?)` |
| Named keys CRUD | `NamedKeyRepository` | `list()`, `create()`, `update()`, `delete()` |
| Runtime config | `RuntimeConfigRepository` | `getRuntimeConfig(slug)`, `updateRuntimeConfig()` |
| User profile | `UserProfileRepository` | `getProfile(userId)`, `updateProfile()` |
| Budget CRUD | `BudgetRepository` | `listBudgets(slug)`, `createBudget()`, `updateBudget()`, `deleteBudget()` |
| Budget events | `BudgetRepository` | `listBudgetEvents(budgetId)`, `insertBudgetEvent()` |

---

*Updated: 2026-04-08 — v0.63.0: schema v28, 16 repositories, migration history v1–v28*
