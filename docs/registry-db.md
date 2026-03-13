# claw-pilot — Registry Database (`registry.db`)

SQLite database at `~/.claw-pilot/registry.db`. WAL mode, foreign keys enforced.  
Current schema version: **10**. Source of truth: `src/db/schema.ts`.

---

## Schema overview

```
servers ──< instances ──< agents ──< agent_files
                    │              └──< (skills column)
                    ├──< agent_links
                    ├──< events
                    ├──< ports
                    ├──< rt_sessions ──< rt_messages ──< rt_parts
                    ├──< rt_permissions
                    ├──< rt_auth_profiles
                    └──< rt_pairing_codes

blueprints ──< agents ──< agent_files
           └──< agent_links

users ──< sessions

config  (global key-value)
schema_version  (single row)
```

`agents` and `agent_links` use a **polymorphic FK**: each row belongs to either an `instance` or a `blueprint`, never both (enforced by CHECK constraint).

`rt_*` tables are scoped to `claw-runtime` instances only.

---

## Tables

### Core (v1)

| Table | Role |
|-------|------|
| `schema_version` | Single-row version tracker |
| `servers` | Physical servers — V1 always has exactly one local row |
| `instances` | One row per instance — slug, port, state, config_path (all instances are `claw-runtime`) |
| `agents` | Agents per instance or blueprint — canvas position, sync hash, skills |
| `ports` | Port reservation registry — prevents conflicts across instances |
| `config` | Global key-value store (port range, dashboard port, health interval) |
| `events` | Append-only audit log per instance |

### Added by migrations

| Table | Migration | Role |
|-------|-----------|------|
| `agent_files` | v2 | Workspace file cache per agent (SOUL.md, AGENTS.md, …) |
| `agent_links` | v2 | A2A and spawn links — polymorphic (instance or blueprint) |
| `blueprints` | v3 | Reusable team templates |
| `users` | v6 | Dashboard auth — single admin in v1, role column prepared for multi-user |
| `sessions` | v6 | Server-side sessions with TTL and sliding window |
| `rt_sessions` | v8 | claw-runtime sessions (one per conversation / channel peer) |
| `rt_messages` | v8 | User + assistant turns within a session |
| `rt_parts` | v8 | Atomic content units within a message (text, tool-call, tool-result) |
| `rt_permissions` | v8 | Persisted permission rules (allow/deny/ask per scope+pattern) |
| `rt_auth_profiles` | v8 | API key rotation per provider (priority, cooldown, failure tracking) |
| `rt_pairing_codes` | v9 | Short-lived 8-char codes pairing a browser to a runtime instance |

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
| 10 | Removed openclaw support — `instance_type` column retained (additive-only) but all instances are now `claw-runtime` |

---

## Key access patterns

All DB access goes through `src/core/registry.ts` methods — never raw SQL in commands.

| Operation | Method |
|-----------|--------|
| List instances | `registry.listInstances()` |
| Get instance | `registry.getInstance(slug)` |
| List agents | `registry.listAgents(slug)` |
| Upsert agent (sync) | `registry.upsertAgent()` |
| Get / write agent file | `registry.getAgentFileContent()` / `registry.upsertAgentFile()` |
| Replace links | `registry.replaceAgentLinks()` / `registry.replaceBlueprintLinks()` |
| Blueprint CRUD | `registry.listBlueprints()`, `createBlueprint()`, `updateBlueprint()`, `deleteBlueprint()` |
| Log event | `registry.logEvent()` |

---

*Mis à jour : 2026-03-13 — schema v10 (removed openclaw support, claw-runtime only)*
