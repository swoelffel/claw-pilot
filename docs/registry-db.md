# claw-pilot — Registry Database (`registry.db`)

SQLite database stored at `~/.claw-pilot/registry.db`.  
WAL mode enabled. Foreign keys enforced.  
Current schema version: **4** (base schema v1 + migrations v2 + v3 + v4).

---

## Schema overview

```
servers ──< instances ──< agents ──< agent_files
                    │
                    └──< agent_links
                    └──< events

blueprints ──< agents ──< agent_files
           │
           └──< agent_links

servers ──< ports

config  (global key-value)
schema_version  (single row)
```

> `agents` and `agent_links` use a **polymorphic FK**: each row belongs to either an
> `instance` (live agent) or a `blueprint` (template agent), never both. Enforced by a
> `CHECK` constraint.

---

## Tables

### `schema_version`

Single-row version tracker. Updated atomically by each migration.

| Column  | Type    | Notes             |
|---------|---------|-------------------|
| version | INTEGER | e.g. `1`, `2`, … |

---

### `servers`

Physical servers managed by claw-pilot. V1 always contains exactly one row (`id = 1`, the local machine).

| Column           | Type    | Notes                                      |
|------------------|---------|--------------------------------------------|
| id               | INTEGER | PK autoincrement                           |
| hostname         | TEXT    | machine hostname                           |
| ip               | TEXT    | nullable — public IP if known              |
| ssh_user         | TEXT    | nullable — reserved for future SSH impl    |
| ssh_port         | INTEGER | default `22`                               |
| openclaw_home    | TEXT    | home dir of the openclaw user              |
| openclaw_bin     | TEXT    | resolved binary name, e.g. `openclaw`      |
| openclaw_version | TEXT    | detected version, e.g. `2026.2.14`         |
| os               | TEXT    | nullable                                   |
| created_at       | TEXT    | ISO-like timestamp (`YYYY-MM-DD HH:MM:SS`) |
| updated_at       | TEXT    |                                            |

---

### `instances`

One row per OpenClaw gateway instance. Each instance has a unique slug and port.

| Column       | Type    | Notes                                                                 |
|--------------|---------|-----------------------------------------------------------------------|
| id           | INTEGER | PK autoincrement                                                      |
| server_id    | INTEGER | FK → servers(id)                                                      |
| slug         | TEXT    | UNIQUE — human-readable identifier, e.g. `default`, `staging`        |
| display_name | TEXT    | nullable — UI label                                                   |
| port         | INTEGER | UNIQUE — gateway HTTP port                                            |
| state        | TEXT    | `running` \| `stopped` \| `error` \| `unknown`                       |
| config_path  | TEXT    | absolute path to `openclaw.json`                                      |
| state_dir    | TEXT    | absolute path to state directory                                      |
| systemd_unit | TEXT    | e.g. `openclaw-gateway.service`, `openclaw-<slug>.service`            |
| telegram_bot | TEXT    | nullable — Telegram bot username if configured                        |
| default_model| TEXT    | nullable — JSON string or plain model ID                              |
| discovered   | INTEGER | `1` = adopted from existing infra, `0` = created by claw-pilot       |
| created_at   | TEXT    |                                                                       |
| updated_at   | TEXT    |                                                                       |

---

### `agents`

One row per agent — either within a live instance or within a blueprint template.
Live agents are populated by `agent-sync.ts` on each sync; blueprint agents are managed
via the Blueprint Builder UI.

| Column         | Type    | Notes                                                              |
|----------------|---------|--------------------------------------------------------------------|
| id             | INTEGER | PK autoincrement — used as FK in `agent_files`                     |
| instance_id    | INTEGER | nullable — FK → instances(id) ON DELETE CASCADE (live agent)       |
| blueprint_id   | INTEGER | nullable — FK → blueprints(id) ON DELETE CASCADE (template agent)  |
| agent_id       | TEXT    | string ID from `openclaw.json`, e.g. `main`, `analyst`, `dev`     |
| name           | TEXT    | display name, e.g. `Amelia - Developer`                            |
| model          | TEXT    | nullable — JSON string or plain model ID                           |
| workspace_path | TEXT    | absolute path to agent workspace directory                         |
| is_default     | INTEGER | `1` if this is the default agent of the instance                   |
| role           | TEXT    | nullable — free-text role label (v2, editable in UI)               |
| tags           | TEXT    | nullable — comma-separated tags (v2, reserved)                     |
| notes          | TEXT    | nullable — free-text notes (v2, reserved)                          |
| position_x     | REAL    | nullable — canvas X position in Agent Builder / Blueprint Builder  |
| position_y     | REAL    | nullable — canvas Y position in Agent Builder / Blueprint Builder  |
| config_hash    | TEXT    | nullable — SHA-256 of agent config at last sync                    |
| synced_at      | TEXT    | nullable — ISO timestamp of last sync                              |

Unique constraints: `(instance_id, agent_id)` and `(blueprint_id, agent_id)`.

CHECK constraint: exactly one of `instance_id` / `blueprint_id` must be non-null.

---

### `agent_files` *(added in migration v2)*

Workspace file cache for each agent. Stores the full content of editable files
(`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`)
and read-only files (`MEMORY.md`, `BOOTSTRAP.md`, …).

| Column       | Type    | Notes                                            |
|--------------|---------|--------------------------------------------------|
| id           | INTEGER | PK autoincrement                                 |
| agent_id     | INTEGER | FK → agents(id) ON DELETE CASCADE                |
| filename     | TEXT    | e.g. `SOUL.md`, `AGENTS.md`, `MEMORY.md`         |
| content      | TEXT    | nullable — full file content                     |
| content_hash | TEXT    | nullable — SHA-256 of content (change detection) |
| updated_at   | TEXT    | last write timestamp                             |

Unique constraint: `(agent_id, filename)`.

**Known filenames and editability:**

| Filename      | Editable | Notes                              |
|---------------|----------|------------------------------------|
| AGENTS.md     | yes      | Agent-to-agent routing config      |
| SOUL.md       | yes      | Agent personality / system prompt  |
| TOOLS.md      | yes      | Tool definitions                   |
| IDENTITY.md   | yes      | Identity context                   |
| USER.md       | yes      | User context                       |
| HEARTBEAT.md  | yes      | Heartbeat / health instructions    |
| MEMORY.md     | no       | Runtime memory (read-only)         |
| BOOTSTRAP.md  | no       | Bootstrap instructions (read-only) |

Editability is enforced server-side by the `EDITABLE_FILES` Set in `src/core/agent-sync.ts`.

---

### `agent_links` *(added in migration v2, extended in v3)*

Directed agent-to-agent relationships scoped to either a live instance or a blueprint.
Mirrors the `a2a` and `spawn` links declared in `openclaw.json`.

| Column          | Type    | Notes                                                             |
|-----------------|---------|-------------------------------------------------------------------|
| id              | INTEGER | PK autoincrement                                                  |
| instance_id     | INTEGER | nullable — FK → instances(id) ON DELETE CASCADE (live link)       |
| blueprint_id    | INTEGER | nullable — FK → blueprints(id) ON DELETE CASCADE (template link)  |
| source_agent_id | TEXT    | string agent_id of the source                                     |
| target_agent_id | TEXT    | string agent_id of the target                                     |
| link_type       | TEXT    | `a2a` (peer communication) \| `spawn` (sub-agent)                 |

Unique constraints: `(instance_id, source_agent_id, target_agent_id, link_type)` and
`(blueprint_id, source_agent_id, target_agent_id, link_type)`.

CHECK constraint: exactly one of `instance_id` / `blueprint_id` must be non-null.

Live instance links are replaced atomically on each sync via `registry.replaceAgentLinks()`.
Blueprint links are managed via `registry.replaceBlueprintLinks()`.

---

### `blueprints` *(added in migration v3)*

Reusable team templates. A blueprint holds a set of agents (with their workspace files)
and the links between them. It can be deployed to create a new instance pre-populated
with that team.

| Column      | Type    | Notes                                                        |
|-------------|---------|--------------------------------------------------------------|
| id          | INTEGER | PK autoincrement                                             |
| name        | TEXT    | UNIQUE — human-readable name, e.g. `BMAD Core Team`         |
| description | TEXT    | nullable — short description shown in the UI                 |
| icon        | TEXT    | nullable — emoji or icon identifier                          |
| tags        | TEXT    | nullable — comma-separated tags (reserved)                   |
| color       | TEXT    | nullable — hex color for the card accent, e.g. `#6366f1`    |
| created_at  | TEXT    | ISO-like timestamp                                           |
| updated_at  | TEXT    |                                                              |

Blueprint agents and links are stored in the shared `agents` and `agent_links` tables
using the polymorphic `blueprint_id` FK.

---

### `ports`

Port reservation registry. Prevents port conflicts across instances.

| Column        | Type    | Notes                                    |
|---------------|---------|------------------------------------------|
| server_id     | INTEGER | FK → servers(id)                         |
| port          | INTEGER |                                          |
| instance_slug | TEXT    | nullable — which instance owns this port |

PK: `(server_id, port)`.

Default range: **18789–18799** (11 slots). Dashboard: **19000** (not tracked here).

---

### `config`

Global key-value store. Seeded with defaults on first run.

| Column | Type | Notes           |
|--------|------|-----------------|
| key    | TEXT | PK              |
| value  | TEXT | always a string |

**Default values:**

| key                      | value    |
|--------------------------|----------|
| port_range_start         | 18789    |
| port_range_end           | 18799    |
| dashboard_port           | 19000    |
| health_check_interval_ms | 10000    |
| openclaw_user            | openclaw |

---

### `events`

Append-only audit log. One row per lifecycle event.

| Column        | Type    | Notes                                                           |
|---------------|---------|-----------------------------------------------------------------|
| id            | INTEGER | PK autoincrement                                                |
| instance_slug | TEXT    | nullable — which instance the event concerns                    |
| event_type    | TEXT    | `discovered` \| `created` \| `started` \| `stopped` \| `restarted` |
| detail        | TEXT    | nullable — human-readable description                           |
| created_at    | TEXT    |                                                                 |

---

## Migration history

| Version | Changes                                                                                  |
|---------|------------------------------------------------------------------------------------------|
| 1       | Base schema: `schema_version`, `servers`, `instances`, `agents`, `ports`, `config`, `events` |
| 2       | Added `agent_files`, `agent_links` tables; added enriched columns to `agents` (`role`, `tags`, `notes`, `position_x/y`, `config_hash`, `synced_at`) |
| 3       | Added `blueprints` table; recreated `agents` and `agent_links` with polymorphic FK (`instance_id` OR `blueprint_id`) and CHECK constraint; added `blueprint_id` column to both tables |
| 4       | Removed `nginx_domain` column from `instances` table (Nginx support dropped) |

---

## Key access patterns

| Operation | Method | SQL pattern |
|-----------|--------|-------------|
| List all instances | `registry.listInstances()` | `SELECT * FROM instances ORDER BY port` |
| Get instance by slug | `registry.getInstance(slug)` | `SELECT * FROM instances WHERE slug = ?` |
| List agents for instance | `registry.listAgents(slug)` | JOIN instances + agents |
| Upsert agent (sync) | `registry.upsertAgent()` | `INSERT … ON CONFLICT DO UPDATE` (preserves v2 fields) |
| Get file content | `registry.getAgentFileContent()` | `SELECT * FROM agent_files WHERE agent_id = ? AND filename = ?` |
| Write file (edit) | `registry.upsertAgentFile()` | `INSERT OR REPLACE INTO agent_files` |
| Replace all links (instance) | `registry.replaceAgentLinks()` | DELETE + INSERT in transaction |
| Log event | `registry.logEvent()` | `INSERT INTO events` |
| List all blueprints | `registry.listBlueprints()` | `SELECT * FROM blueprints ORDER BY name` |
| Get blueprint by id | `registry.getBlueprint(id)` | `SELECT * FROM blueprints WHERE id = ?` |
| Create blueprint | `registry.createBlueprint()` | `INSERT INTO blueprints` |
| Update blueprint | `registry.updateBlueprint()` | `UPDATE blueprints SET … WHERE id = ?` |
| Delete blueprint | `registry.deleteBlueprint()` | `DELETE FROM blueprints WHERE id = ?` |
| List blueprint agents | `registry.listBlueprintAgents(id)` | `SELECT * FROM agents WHERE blueprint_id = ?` |
| Upsert blueprint agent | `registry.upsertBlueprintAgent()` | `INSERT … ON CONFLICT DO UPDATE` |
| Replace blueprint links | `registry.replaceBlueprintLinks()` | DELETE + INSERT in transaction |
| Get blueprint builder data | `registry.getBlueprintBuilderData(id)` | agents + files + links in one call |

---

*Updated: 2026-02-26 — v3 schema: blueprints table, polymorphic FK on agents/agent_links*
