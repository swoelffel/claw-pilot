# API Reference

> Part of [claw-pilot Functional Architecture](README.md)

---

## Client-side routing (hash-based)

| Hash URL | View | Component |
|---|---|---|
| `#/home` | Home screen (default) | `cp-home-screen` |
| `#/` or `#/instances` | Instances view | `cp-cluster-view` |
| `#/instances/:slug/builder` | Agent builder | `cp-agents-builder` |
| `#/instances/:slug/settings` | Instance settings | `cp-instance-settings` |
| `#/instances/:slug/pilot` | Interactive chat + LLM context panel | `cp-runtime-pilot` |
| `#/instances/:slug/costs` | Cost analytics dashboard | `cp-costs-dashboard` |
| `#/instances/:slug/activity` | Event browser + filters | `cp-activity-console` |
| `#/instances/:slug/memory` | Memory file browser + search | `cp-memory-browser` |
| `#/instances/:slug/heartbeat` | Heartbeat heatmap visualization | `cp-heartbeat-heatmap` |
| `#/instances/:slug/session-logs` | Session log viewer | `cp-session-logs` |
| `#/instances/:slug/tasks` | Task board (Kanban) | `cp-task-board` |
| `#/instances/:slug/flows` | Workflow editor + run history | `cp-flow-list` |
| `#/instances/:slug/flows/runs/:runId` | Flow execution detail | `cp-flow-run-detail` |
| `#/blueprints` | Blueprints view | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | Blueprint builder | `cp-blueprint-builder` |
| `#/agent-templates` | Agent templates (reusable) | `cp-agent-templates-view` |
| `#/agent-templates/:id` | Agent template detail + files | `cp-agent-template-detail` |
| `#/profile` | User profile settings | `cp-profile-settings` |

---

## REST API (~150 endpoints)

### Auth

| Method | Route | Role |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate, create session |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/auth/me` | Current user info + WS token |

### System

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/health` | Healthcheck (version, uptime, DB size) |
| `GET` | `/api/self/update-status` | Check for updates |
| `POST` | `/api/self/update` | Launch auto-update |

### Instances — CRUD & Lifecycle

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances` | List with health state |
| `POST` | `/api/instances` | Provision new instance |
| `GET` | `/api/instances/:slug` | Detail + health + token |
| `GET` | `/api/instances/:slug/health` | Health |
| `POST` | `/api/instances/:slug/start` | Start |
| `POST` | `/api/instances/:slug/stop` | Stop |
| `POST` | `/api/instances/:slug/restart` | Restart |
| `DELETE` | `/api/instances/:slug` | Destroy |
| `GET` | `/api/next-port` | Next free port |
| `POST` | `/api/instances/discover` | Scan system |
| `POST` | `/api/instances/discover/adopt` | Adopt discovered instances |

### Instances — Config

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/config` | Read structured config |
| `PATCH` | `/api/instances/:slug/config` | Modify config (hot reload) |
| `PATCH` | `/api/instances/:slug/config/telegram/token` | Modify Telegram token |
| `GET` | `/api/providers` | AI provider catalog |

### Instances — Agents (13 endpoints)

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/agents` | List agents |
| `GET` | `/api/instances/:slug/agents/builder` | Builder data (agents + links) |
| `POST` | `/api/instances/:slug/agents` | Create agent |
| `DELETE` | `/api/instances/:slug/agents/:agentId` | Delete agent |
| `PATCH` | `/api/instances/:slug/agents/:agentId/meta` | Update metadata |
| `PATCH` | `/api/instances/:slug/agents/:agentId/position` | Canvas position |
| `PATCH` | `/api/instances/:slug/agents/:agentId/spawn-links` | Spawn links |
| `GET` | `/api/instances/:slug/agents/:agentId/files` | Workspace file tree (hierarchical JSON, v0.73.5) |
| `GET` | `/api/instances/:slug/agents/:agentId/files/*` | Read single workspace file by relative path |
| `PUT` | `/api/instances/:slug/agents/:agentId/files/*` | Create or update workspace file (path-validated) |
| `DELETE` | `/api/instances/:slug/agents/:agentId/files/*` | Delete workspace file |
| `GET` | `/api/instances/:slug/skills` | Available skills |
| `POST` | `/api/instances/:slug/agents/sync` | Sync from disk |

### Instances — Runtime

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/runtime/status` | Runtime state |
| `GET` | `/api/instances/:slug/runtime/sessions` | List sessions |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/messages` | Messages + parts |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/context` | LLM context |
| `POST` | `/api/instances/:slug/runtime/chat` | Send message (races vs pending question) |
| `GET` | `/api/instances/:slug/runtime/chat/stream` | SSE real-time streaming (see [SSE Architecture](../sse-architecture.md)) |
| `GET` | `/api/instances/:slug/runtime/tools` | Available tools for instance |

### Instances — Budgets (8 endpoints)

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/budgets` | List budgets |
| `POST` | `/api/instances/:slug/budgets` | Create budget (instance or agent scope) |
| `GET` | `/api/instances/:slug/budgets/:budgetId` | Get single budget |
| `PATCH` | `/api/instances/:slug/budgets/:budgetId` | Update budget |
| `DELETE` | `/api/instances/:slug/budgets/:budgetId` | Delete budget |
| `GET` | `/api/instances/:slug/budgets/:budgetId/events` | Budget audit events |
| `POST` | `/api/instances/:slug/budgets/:budgetId/override` | Apply override (+20% above limit) |
| `POST` | `/api/instances/:slug/budgets/:budgetId/reset` | Manual reset |

### Instances — Task Board (11 endpoints)

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/tasks` | List tasks (optional status filter) |
| `GET` | `/api/instances/:slug/tasks/counts` | Task counts by status |
| `GET` | `/api/instances/:slug/tasks/:id` | Get single task |
| `POST` | `/api/instances/:slug/tasks` | Create task or epic (Zod validated) |
| `PATCH` | `/api/instances/:slug/tasks/:id` | Update task fields (Zod validated) |
| `PATCH` | `/api/instances/:slug/tasks/:id/status` | Change status + drag & drop position |
| `PATCH` | `/api/instances/:slug/tasks/:id/reorder` | Reorder within column |
| `DELETE` | `/api/instances/:slug/tasks/:id` | Delete task (pending/cancelled only) |
| `POST` | `/api/instances/:slug/tasks/:id/comments` | Add comment |
| `GET` | `/api/instances/:slug/epics` | List epics |
| `GET` | `/api/instances/:slug/epics/:id/children` | Get epic's child tasks |

### Instances — Flows (9 endpoints)

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/flows` | List flow definitions |
| `POST` | `/api/instances/:slug/flows` | Create flow (Zod validated, DAG cycle detection) |
| `GET` | `/api/instances/:slug/flows/:id` | Get flow definition |
| `PUT` | `/api/instances/:slug/flows/:id` | Update flow |
| `DELETE` | `/api/instances/:slug/flows/:id` | Delete flow |
| `POST` | `/api/instances/:slug/flows/:id/run` | Execute flow (async, returns run ID) |
| `POST` | `/api/instances/:slug/flows/runs/:runId/cancel` | Cancel running flow |
| `GET` | `/api/instances/:slug/flows/runs` | List flow runs |
| `GET` | `/api/instances/:slug/flows/runs/:runId` | Get run detail (steps, SITREP, tokens) |

### Instances — Costs, Events, Heartbeat, Memory

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/costs` | Cost aggregations per agent/session |
| `GET` | `/api/instances/:slug/events` | Runtime bus events (activity console) |
| `GET` | `/api/instances/:slug/events/stream` | SSE instance-wide event stream (see [SSE Architecture](../sse-architecture.md)) |
| `GET` | `/api/instances/:slug/heartbeat/history` | Heartbeat history and analytics |
| `GET` | `/api/instances/:slug/memory` | Memory files with decay scores |

### Instances — MCP & Permissions

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/mcp/tools` | MCP tools |
| `GET` | `/api/instances/:slug/mcp/status` | MCP server status |
| `GET` | `/api/instances/:slug/runtime/permissions` | Permission rules |
| `DELETE` | `/api/instances/:slug/runtime/permissions/:id` | Delete rule |
| `POST` | `/api/instances/:slug/runtime/permission/reply` | Reply to request |

### Instances — Telegram

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/telegram/pairing` | Pairing status |
| `POST` | `/api/instances/:slug/telegram/pairing/approve` | Approve |
| `DELETE` | `/api/instances/:slug/telegram/pairing/:code` | Reject |

### Blueprints (13 endpoints)

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/blueprints` | List blueprints |
| `POST` | `/api/blueprints` | Create blueprint |
| `GET` | `/api/blueprints/:id` | Blueprint detail |
| `PUT` | `/api/blueprints/:id` | Modify blueprint |
| `DELETE` | `/api/blueprints/:id` | Delete blueprint |
| `GET` | `/api/blueprints/:id/builder` | Full builder data |
| `POST` | `/api/blueprints/:id/agents` | Add agent |
| `PATCH` | `/api/blueprints/:id/agents/:agentId/meta` | Agent metadata |
| `DELETE` | `/api/blueprints/:id/agents/:agentId` | Delete agent |
| `PATCH` | `/api/blueprints/:id/agents/:agentId/position` | Canvas position |
| `GET/PUT` | `/api/blueprints/:id/agents/:agentId/files/:filename` | Workspace files |
| `PATCH` | `/api/blueprints/:id/agents/:agentId/spawn-links` | Spawn links |

### Agent Blueprints (12 endpoints)

Standalone reusable agent templates, independent of team blueprints and instances.

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/agent-blueprints` | List all agent blueprints |
| `POST` | `/api/agent-blueprints` | Create (optional file seeding) |
| `GET` | `/api/agent-blueprints/:id` | Detail + workspace files |
| `PUT` | `/api/agent-blueprints/:id` | Update metadata |
| `DELETE` | `/api/agent-blueprints/:id` | Delete (cascade files) |
| `POST` | `/api/agent-blueprints/:id/clone` | Deep clone |
| `GET` | `/api/agent-blueprints/:id/files/:filename` | Read file |
| `PUT` | `/api/agent-blueprints/:id/files/:filename` | Write file |
| `DELETE` | `/api/agent-blueprints/:id/files/:filename` | Delete file |
| `POST` | `/api/agent-blueprints/from-agent` | Create from instance agent ("Save as template") |
| `GET` | `/api/agent-blueprints/:id/export` | Export as YAML |
| `POST` | `/api/agent-blueprints/import` | Import from YAML |

### Teams

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/team/export` | Export YAML |
| `POST` | `/api/instances/:slug/team/import` | Import YAML (with dry_run) |
| `GET` | `/api/blueprints/:id/team/export` | Export blueprint |
| `POST` | `/api/blueprints/:id/team/import` | Import blueprint |

### Named API Keys

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/named-keys` | List all named keys |
| `POST` | `/api/named-keys` | Create named key (encrypted) |
| `PUT` | `/api/named-keys/:id` | Update named key |
| `DELETE` | `/api/named-keys/:id` | Delete named key |

### User Profile

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/profile` | Read current user profile |
| `PATCH` | `/api/profile` | Update profile preferences |

### Global Search

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/search?q=&limit=` | FTS5 BM25 ranked search across 5 entity types (instance, agent, task, blueprint, agent_blueprint) |

### System Instance (HOMEBOT)

| Method | Route | Role |
|---|---|---|
| `POST` | `/api/system-instance/provision` | Auto-provision system instance (cp-system) with 6 agents + 6 flows |
| `GET` | `/api/system-instance/status` | System instance provisioning status |

---

*Updated: 2026-04-16 — v0.73.5, ~160 REST endpoints, 18 hash routes*
