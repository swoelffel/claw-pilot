# claw-pilot — Functional Architecture

> **Version**: 0.69.0
> **Stack**: TypeScript ~6.0 / Node.js ESM, Lit ^3, SQLite (schema v34), Hono ^4.12
> **Repo**: https://github.com/swoelffel/claw-pilot
> **Detailed References**: [ux-design.md](./ux-design.md) (index) · [ux-screens/](./ux-screens/) · [ux-components/](./ux-components/) · [agents.md](./agents.md) · [registry-db.md](./registry-db.md) · [i18n.md](./i18n.md) · [design-rules.md](./design-rules.md) · `CLAUDE.md`

---

## Overview

claw-pilot is a **local orchestrator** for multi-agent instance clusters. It exposes two complementary interfaces:

- **CLI** (`claw-pilot <command>`) — scriptable operations, system administration
- **Web Dashboard** (`http://localhost:19000`) — complete graphical interface, real-time

Both interfaces share the same business logic layer (`src/core/`) and the same SQLite database (`~/.claw-pilot/registry.db`).

All instances use the **claw-runtime** engine — a native Node.js engine managed via PID file (daemon).

```
┌─────────────────────────────────────────────────────────────────┐
│                        claw-pilot                               │
│                                                                 │
│   CLI (Commander.js)          Dashboard (Hono + Lit UI)         │
│   commands                    HTTP/WS port 19000                │
│         │                              │                        │
│         └──────────────┬───────────────┘                        │
│                        │                                        │
│              Core (src/core/)                                   │
│   Provisioner · Lifecycle · Health · Discovery · AgentSync      │
│   BlueprintDeployer · AgentProvisioner · TeamExport/Import      │
│                        │                                        │
│              Registry (facade) → 20 Repositories                │
│                        │                                        │
│              ServerConnection (abstraction)                     │
│              LocalConnection (local shell/fs)                   │
│                        │                                        │
│              SQLite Registry (~/.claw-pilot/registry.db)        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
                claw-runtime instances
                (daemon PID file)
                <stateDir>/runtime.json (debug snapshot — DB is source of truth)
                <stateDir>/workspaces/<agentId>/
```

---

## Data model (SQLite)

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
| `instance_named_keys` | v24 (deprecated v25) | Junction: instance ↔ named key (replaced by FK on instances) |
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
| `rt_flow_step_runs` | v33 | Per-step execution — agent, session, SITREP JSON, tokens, cost, retry count |

**Added columns (v17–v26)**:
- `agents.config_json` (v20) — full RuntimeAgentConfig as JSON blob
- `agents.named_key_id` (v24) — optional FK to named_api_keys
- `instances.runtime_config_json` (v21) — full RuntimeConfig as JSON blob (source of truth)
- `instances.default_named_key_id` (v25) — default named key FK

**Added columns (v30–v34)**:
- `rt_tasks.type` (v30) — task/epic discriminator
- `rt_tasks.parent_id` (v30) — self-referential FK for epic hierarchy
- `instances.is_system` (v34) — system instance flag (HOMEBOT)

**Current migration version: 34**

**Default port range**: 18789–18838 (50 ports, 10 instances at 5-port intervals). Dashboard: 19000.

**Migration rule**: always additive (ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS). Never use DROP COLUMN / DROP TABLE without table recreation — migrations are irreversible in production.

Full reference: [registry-db.md](./registry-db.md)

---

## Code structure

### CLI (`src/commands/`)

```
_context.ts       withContext() — opens DB + registry, guarantees close
auth.ts           provider auth-profile management
create.ts         instance creation wizard
dashboard.ts      dashboard start/stop
destroy.ts        instance deletion
doctor.ts         environment diagnostics
init.ts           first-run initialization
list.ts           list instances
logs.ts           runtime logs
restart.ts        instance restart
runtime.ts        claw-runtime commands (start/stop/restart/status/chat/config/mcp)
service.ts        dashboard systemd/launchd service
start.ts          instance start
status.ts         detailed instance state
stop.ts           instance stop
team.ts           YAML team export/import
token.ts          instance token
update.ts         auto-update from GitHub
```

### Wizard (`src/wizard/`)

Interactive creation wizard using `@inquirer/prompts`. Extracted from commands/ for better separation of concerns.

### Core (`src/core/`)

```
lifecycle.ts              start/stop/restart — PID file daemon
health.ts                 health check — PID file
provisioner.ts            instance creation (wizard)
agent-provisioner.ts      add agents to existing instance
registry.ts               facade over 20 repositories
registry-types.ts         types InstanceRecord, AgentRecord, BlueprintRecord, AgentBlueprintRecord, etc.
repositories/             20 SQLite repositories:
  server-repository.ts      — servers table
  instance-repository.ts    — instances table
  agent-repository.ts       — agents + agent_files + agent_links tables
  port-repository.ts        — ports table
  config-repository.ts      — config table
  event-repository.ts       — events table
  blueprint-repository.ts   — blueprints + blueprint agents + blueprint links
  runtime-session-repository.ts — rt_sessions enriched queries
  agent-blueprint-repository.ts — agent_blueprints + agent_blueprint_files
  rt-event-repository.ts    — rt_events (activity console)
  cost-repository.ts        — cost aggregations per agent/session
  heartbeat-repository.ts   — heartbeat history and analytics
  named-key-repository.ts   — named_api_keys CRUD
  runtime-config-repository.ts — instances.runtime_config_json operations
  user-profile-repository.ts — user_profiles CRUD
  budget-repository.ts      — rt_budgets + rt_budget_events CRUD
  task-repository.ts        — rt_tasks + rt_task_comments CRUD, epic hierarchy, agent checkout
  task-activity-repository.ts — rt_task_activities: field-level mutation tracking, 9 activity types
  search-repository.ts      — search_index FTS5, BM25 ranking, 5 entity types, rebuild
  flow-repository.ts        — rt_flow_definitions + rt_flow_runs + rt_flow_step_runs CRUD
model-discovery/          Dynamic model discovery from provider APIs:
  service.ts                — ModelDiscoveryService (polling 24h, DB persistence, stale cache fallback)
  types.ts                  — DiscoveredModel, ProviderAdapter interfaces
  adapters/                 — 8 provider adapters (anthropic, openai, google, openrouter, ollama, mistral, xai, opencode)
agent-sync.ts             sync agents from runtime.json debug snapshot (deprecated, DB is source of truth)
agent-workspace.ts        resolve agent workspace paths
blueprint-deployer.ts     deploy blueprint on creation
config-generator.ts       generate .env with provider keys
config-helpers.ts         runtime.json debug snapshot manipulation (deprecated)
dashboard-service.ts      install/uninstall systemd/launchd service
destroyer.ts              delete instance (ports, DB, files)
discovery.ts              discover existing system instances
secrets.ts                generate dashboard tokens (64 chars hex)
self-update-checker.ts    check GitHub releases
self-updater.ts           git pull + pnpm install + pnpm build
team-export.ts            export .team.yaml
team-import.ts            import .team.yaml
team-schema.ts            Zod schema for .team.yaml (version "1")
workspace-state.ts        workspace state
auth.ts                   authentication helpers
builtin-blueprints.ts     built-in team blueprints (dev-harness, design-studio, team-architect)
launchd-generator.ts      generate macOS plist
systemd-generator.ts      generate systemd unit Linux
```

### Runtime (`src/runtime/`) — claw-runtime engine

```
engine/       ClawRuntime(config, db, slug, workDir?) — state machine, channel-factory
              config-loader: loadRuntimeConfig(), saveRuntimeConfig(), ensureRuntimeConfig()
              plugin-wiring: wirePluginsToBus()
              channel-factory: creates channel instances from config
bus/          getBus(slug), disposeBus(), 26 event types (typed EventDef<T, P>)
provider/     resolveModel(providerId, modelId), 8 providers, auth-profiles rotation
              MODEL_CATALOG: 12 static models + dynamic discovery from provider APIs
permission/   ruleset last-match-wins, allow/deny/ask, wildcard glob matching (index.ts, wildcard.ts)
profile/      user profile resolution for system prompt injection (community-resolver.ts, types.ts)
config/       RuntimeConfig Zod schema, parseRuntimeConfig(), createDefaultRuntimeConfig()
session/      createSession(), getOrCreatePermanentSession(), runPromptLoop()
              permanent session key: <slug>:<agentId> (cross-channel, no peerId)
              auto compaction, system-prompt builder, workspace-cache
              message-builder: converts DB messages → ModelMessage[] (AI SDK v6)
              usage-tracker: cost and token tracking
              budget-check: pre/post-LLM budget enforcement (soft alert, hard stop, override)
              cleanup: ephemeral session cleanup (configurable retention)
              tool-set-builder: builds agent tool set from profile + MCP + plugins
              system-prompt-cache: getCachedSystemPrompt()
tool/         Tool.define() factory, registry (12 built-ins + MCP + plugin tools)
              built-in: read, write, edit, multiedit, bash, glob, grep, webfetch, question, todowrite, todoread, skill
              task: subagent spawning (dynamically added to "full" profile)
              profiles: minimal, messaging, coding, full
agent/        7 built-ins (build, plan, explore, general, compaction, title, summary)
              build/plan: have inline fallback prompts; use SOUL.md, IDENTITY.md from disk when workDir is provided
              initAgentRegistry(config.agents), getAgent(), defaultAgentName()
              resolveEffectivePersistence(): kind="primary" → "permanent"
plugin/       8 hooks: agent.beforeStart, agent.end, tool.beforeCall, tool.afterCall,
              message.received, message.sending, session.start, session.end
              tools(), routes(), tool.definition transform
mcp/          stdio + HTTP remote, McpRegistry, McpClient, sanitize tool IDs
channel/      Channel interface, ChannelRouter (per-session serialization queue), web-chat WS
              telegram: polling + webhook + MarkdownV2 formatter, pairing flow
memory/       FTS5 full-text search index (memory-index.db), decay scoring
              search-tool: memory_search for agents, writer: memory file writing
flow/         Declarative DAG workflow engine (FLOW-001):
              engine.ts: topological sort, fan-out/fan-in, Promise.race parallel execution
              step-executor.ts: per-step timeout (1s-10min), retry (0-5), agent session
              briefing.ts: mission briefing builder for step prompts
              sitrep.ts: structured SITREP extraction from agent responses
              types.ts: FlowStepDef, SitrepResult, FlowEngineContext
heartbeat/    HeartbeatRunner, intervals 5m-24h, active hours (timezone-aware, IANA validation)
              permanent session reuse (primary agents), structured finish_reason tagging
              HeartbeatTick, HeartbeatAlert, budget gate (skip if exceeded)
```

### Dashboard (`src/dashboard/`)

```
server.ts          Hono entry point — auth middleware (session cookie + Bearer token),
                   rate limiting, security headers, SPA fallback, WebSocket
monitor.ts         WebSocket monitor (health_update every 10s, delta-compressed)
                   enriches with: pendingPermissions, heartbeat agents/alerts, MCP count
rate-limit.ts      Rate limiter per IP (60/min API, 30/min instances, 1/5min self-update)
request-id.ts      X-Request-Id middleware
route-deps.ts      RouteDeps interface + apiError helper
session-store.ts   Server session store (TTL, sliding window, periodic cleanup)
token-cache.ts     In-memory token cache
routes/
  auth.ts          POST login/logout, GET me
  system.ts        GET health, GET/POST self-update
  teams.ts         GET/POST export/import instances and blueprints
  blueprints.ts    CRUD blueprints + agents + files + spawn-links
  agent-blueprints.ts  CRUD agent blueprint templates + files + clone + export/import YAML
  named-keys.ts    CRUD named API keys (encrypted, admin-global)
  search.ts        GET /api/search — global FTS5 search (BM25, 5 entity types)
  system-instance.ts  System instance auto-provisioning (HOMEBOT)
  profile.ts       GET/PATCH user profile preferences
  instances.ts     Instance routes dispatcher
  instances/
    index.ts       Instance routes orchestrator
    lifecycle.ts   CRUD instances + start/stop/restart + discover/adopt
    config.ts      GET/PATCH config + providers catalog + telegram token
    runtime.ts     GET runtime status/sessions/messages/context, POST chat, GET stream SSE
    budgets.ts     Budget CRUD, override, reset, audit events (8 endpoints)
    tasks.ts       Task board CRUD, status changes, reorder, comments, epics, timeline (12 endpoints)
    flows.ts       Flow CRUD + DAG validation + execution + run history (9 endpoints)
    costs.ts       GET cost aggregations per agent/session
    events.ts      GET rt_events (activity console)
    heartbeat.ts   GET heartbeat history and analytics
    memory.ts      GET memory files with decay scores
    config-schemas.ts  Schema validation helpers for config patches
    mcp.ts         GET mcp tools/status
    permissions.ts GET permissions, DELETE rule, POST reply
    telegram.ts    GET pairing, POST approve, DELETE reject
    discover.ts    POST discover + adopt
    workspace-download.ts  GET workspace file download
    agents.ts      Agents routes dispatcher
    agents/        CRUD agents + files + sync + skills + spawn-links (8 submodules):
      create.ts, delete.ts, files.ts, list.ts, skills.ts, spawn-links.ts, sync.ts, update.ts
```

### Lib (`src/lib/`)

```
platform.ts        getDataDir(), getInstancesDir(), getRuntimeStateDir(), getRuntimePidPath(),
                   getRuntimePid(), isRuntimeRunning(), getServiceManager(), isDocker(),
                   getDashboardLaunchdPlistPath()
constants.ts       PORT_RANGE_START(18789), PORT_RANGE_END(18838), DASHBOARD_PORT(19000),
                   timeouts, paths, DISCOVERABLE_FILES, EDITABLE_FILES, TEMPLATE_FILES,
                   EXPORTABLE_FILES, SESSION_COOKIE_NAME, AUTH_RATE_LIMIT_MAX
errors.ts          ClawPilotError, CliError, InstanceNotFoundError, PortConflictError,
                   GatewayUnhealthyError
logger.ts          logger.info/warn/error/success/step/dim (chalk-based)
poll.ts            pollUntilReady()
shell.ts           shellEscape()
xdg.ts             XDG_RUNTIME_DIR resolution
dotenv.ts          .env parser
env-reader.ts      read .env from state dirs
validate.ts        input validation
guards.ts          instanceGuard for routes
date.ts            date formatting
process.ts         process utilities
model-helpers.ts   model string normalization
provider-catalog.ts provider metadata catalog
providers.ts       provider utilities
workspace-templates.ts workspace template rendering (Handlebars-style)
```

---

## Features

### 1. Initialization (`init`)

Checks prerequisites, creates `~/.claw-pilot/`, initializes DB, generates dashboard token, creates admin user, registers local server.

### 2. Instance creation (`create`)

Interactive wizard:

1. Slug, display name, port, AI provider, API key, initial agents, optional blueprint
2. Generate `runtime.json` debug snapshot in state directory (`~/.claw-pilot/instances/<slug>/`) — the DB is the source of truth
3. Lifecycle via PID file

### 3. Lifecycle (`start`, `stop`, `restart`, `destroy`)

The `Lifecycle` manages claw-runtime instances via PID file daemon:

| Action | Behavior |
|---|---|
| start | spawn daemon + poll PID file |
| stop | SIGTERM + poll process disappearance |
| restart | stop + start |

```bash
claw-pilot start default
claw-pilot stop default
claw-pilot restart default
claw-pilot destroy default
```

### 4. Health (`status`, `list`)

The `HealthChecker` verifies state via PID file — instance is `running` if PID process is alive.

### 5. claw-runtime commands (`runtime`)

```bash
claw-pilot runtime start <slug>              # foreground (SIGTERM to stop)
claw-pilot runtime start <slug> --daemon     # detached daemon (writes PID file)
claw-pilot runtime stop <slug>               # SIGTERM + poll stop
claw-pilot runtime restart <slug>            # stop + start --daemon
claw-pilot runtime status <slug>             # state + config
claw-pilot runtime chat <slug>               # interactive REPL
claw-pilot runtime chat <slug> --once "msg"  # non-interactive mode (CI/scripts)
claw-pilot runtime config init <slug>        # create runtime.json debug snapshot with defaults (DB is source of truth)
claw-pilot runtime config show <slug>        # display runtime.json debug snapshot
claw-pilot runtime config edit <slug>        # edit runtime.json debug snapshot (prefer DB/dashboard for persistent changes)
claw-pilot runtime mcp add <slug>            # add MCP server
claw-pilot runtime mcp remove <slug>         # remove MCP server
claw-pilot runtime mcp list <slug>           # list MCP servers
```

### 6. Instance token (`token`)

```bash
claw-pilot token default          # raw token
claw-pilot token default --url    # URL with #token=
claw-pilot token default --open   # open browser
```

### 7. Team export/import (`team`)

```bash
claw-pilot team export default --output team.yaml
claw-pilot team import default --file team.yaml
```

### 8. Diagnostics (`doctor`)

Checks Node.js, systemd/launchd, DB, instances in consistent state.

### 9. Dashboard service (`service`)

```bash
claw-pilot service install
claw-pilot service uninstall
claw-pilot service status
```

### 10. Auto-update (`update`)

```bash
claw-pilot update              # update from GitHub (git pull + build)
```

---

## Web Dashboard

Hono HTTP/WS server on port 19000. Dual auth: session cookie (priority) or Bearer token (fallback).

### Security

| Mechanism | Detail |
|---|---|
| **Session auth** | `POST /api/auth/login` → HttpOnly cookie, server session store with TTL |
| **Token auth** | `Authorization: Bearer <token>` — timing-safe comparison |
| **WebSocket auth** | First message authenticated via token |
| **Rate limiting** | 60 req/min per IP on `/api/*` · 30 req/min on `POST /api/instances` · 1/5min self-update |
| **Security headers** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| **Validation** | Zod schemas on all mutation routes (config patches, tasks, budgets, blueprints) |
| **TokenCache** | In-memory token cache |
| **Public healthcheck** | `GET /health` without auth |

### Client-side routing (hash-based)

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

### REST API (~139 endpoints)

#### Auth

| Method | Route | Role |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate, create session |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/auth/me` | Current user info + WS token |

#### System

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/health` | Healthcheck (version, uptime, DB size) |
| `GET` | `/api/self/update-status` | Check for updates |
| `POST` | `/api/self/update` | Launch auto-update |

#### Instances — CRUD & Lifecycle

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

#### Instances — Config

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/config` | Read structured config |
| `PATCH` | `/api/instances/:slug/config` | Modify config (hot reload) |
| `PATCH` | `/api/instances/:slug/config/telegram/token` | Modify Telegram token |
| `GET` | `/api/providers` | AI provider catalog |

#### Instances — Agents (10 endpoints)

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/agents` | List agents |
| `GET` | `/api/instances/:slug/agents/builder` | Builder data (agents + links) |
| `POST` | `/api/instances/:slug/agents` | Create agent |
| `DELETE` | `/api/instances/:slug/agents/:agentId` | Delete agent |
| `PATCH` | `/api/instances/:slug/agents/:agentId/meta` | Update metadata |
| `PATCH` | `/api/instances/:slug/agents/:agentId/position` | Canvas position |
| `PATCH` | `/api/instances/:slug/agents/:agentId/spawn-links` | Spawn links |
| `GET/PUT` | `/api/instances/:slug/agents/:agentId/files/:filename` | Workspace files |
| `GET` | `/api/instances/:slug/skills` | Available skills |
| `POST` | `/api/instances/:slug/agents/sync` | Sync from disk |

#### Instances — Runtime

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/runtime/status` | Runtime state |
| `GET` | `/api/instances/:slug/runtime/sessions` | List sessions |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/messages` | Messages + parts |
| `GET` | `/api/instances/:slug/runtime/sessions/:id/context` | LLM context |
| `POST` | `/api/instances/:slug/runtime/chat` | Send message |
| `GET` | `/api/instances/:slug/runtime/chat/stream` | SSE real-time streaming |

#### Instances — Budgets (8 endpoints)

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

#### Instances — Task Board (11 endpoints)

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

#### Instances — Flows (9 endpoints)

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

#### Instances — Costs, Events, Heartbeat, Memory

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/costs` | Cost aggregations per agent/session |
| `GET` | `/api/instances/:slug/events` | Runtime bus events (activity console) |
| `GET` | `/api/instances/:slug/heartbeat/history` | Heartbeat history and analytics |
| `GET` | `/api/instances/:slug/memory` | Memory files with decay scores |

#### Instances — MCP & Permissions

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/mcp/tools` | MCP tools |
| `GET` | `/api/instances/:slug/mcp/status` | MCP server status |
| `GET` | `/api/instances/:slug/runtime/permissions` | Permission rules |
| `DELETE` | `/api/instances/:slug/runtime/permissions/:id` | Delete rule |
| `POST` | `/api/instances/:slug/runtime/permission/reply` | Reply to request |

#### Instances — Telegram

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/telegram/pairing` | Pairing status |
| `POST` | `/api/instances/:slug/telegram/pairing/approve` | Approve |
| `DELETE` | `/api/instances/:slug/telegram/pairing/:code` | Reject |

#### Blueprints (13 endpoints)

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

#### Agent Blueprints (12 endpoints)

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

#### Teams

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/instances/:slug/team/export` | Export YAML |
| `POST` | `/api/instances/:slug/team/import` | Import YAML (with dry_run) |
| `GET` | `/api/blueprints/:id/team/export` | Export blueprint |
| `POST` | `/api/blueprints/:id/team/import` | Import blueprint |

#### Named API Keys

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/named-keys` | List all named keys |
| `POST` | `/api/named-keys` | Create named key (encrypted) |
| `PUT` | `/api/named-keys/:id` | Update named key |
| `DELETE` | `/api/named-keys/:id` | Delete named key |

#### User Profile

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/profile` | Read current user profile |
| `PATCH` | `/api/profile` | Update profile preferences |

#### Global Search

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/search?q=&limit=` | FTS5 BM25 ranked search across 5 entity types (instance, agent, task, blueprint, agent_blueprint) |

#### System Instance (HOMEBOT)

| Method | Route | Role |
|---|---|---|
| `POST` | `/api/system-instance/provision` | Auto-provision system instance (cp-system) with 6 agents + 6 flows |
| `GET` | `/api/system-instance/status` | System instance provisioning status |

### WebSocket Monitor

WS connection on `/ws`. Auth via first message. Broadcasts `health_update` every 10s with each instance state (delta-compressed). Enriches with: pending permissions, heartbeat agents/alerts, MCP count.

---

## claw-runtime engine

### Config (`RuntimeConfig`)

> **Deprecated since v0.59.3**: The file `runtime.json` is now a read-only debug snapshot.
> The source of truth is the database: `agents.config_json` (per-agent) and
> `instances.runtime_config_json` (global). Do not edit runtime.json directly.

Zod schema `RuntimeConfig`:

```typescript
{
  defaultModel: "anthropic/claude-sonnet-4-5",  // "provider/model"
  defaultInternalModel?: "anthropic/claude-haiku-3-5",
  models?: { [alias]: "provider/model" },
  providers?: { [providerId]: { apiKeyEnvVar } },
  agents: RuntimeAgentConfig[],
  globalPermissions?: PermissionRule[],
  mcpEnabled: boolean,
  mcpServers: RuntimeMcpServerConfig[],
  webChat: { enabled: boolean, port: number },
  telegram: { enabled: boolean, botToken?: string, ... },
  compaction?: { threshold, reservedTokens },
  subagents?: { maxSpawnDepth, maxActiveChildren },
}
```

Full reference for agent fields: [agents.md](./agents.md)

### Supported providers

12 static models across 8 providers + dynamic model discovery (see `src/runtime/provider/models.ts` + `src/core/model-discovery/`):

| Provider | ID | API | Static Models |
|---|---|---|---|
| Anthropic | `anthropic` | anthropic-messages | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5 |
| OpenAI | `openai` | openai-completions | gpt-4o, gpt-4o-mini, o3-mini |
| Google | `google` | google-generative-ai | gemini-2.0-flash, gemini-2.5-pro |
| Ollama | `ollama` | ollama | llama3.2, qwen2.5-coder (local, no cost) |
| OpenRouter | `openrouter` | openrouter | any OpenRouter model (pass-through) |
| Mistral | `mistral` | openai-completions | (dynamic discovery only) |
| xAI / Grok | `xai` | openai-completions | (dynamic discovery only) |
| OpenCode Zen | `opencode` | openai-completions | (dynamic discovery only, no auth) |

**Dynamic model discovery** (v0.63.0): `ModelDiscoveryService` polls provider APIs every 24h to discover available models. Results are cached in `discovered_models` table and merged with the static catalog. Stale cache is kept on error (better than empty list). Discovery is triggered on named key CRUD.

### Daemon lifecycle

```
runtime start --daemon <slug>
  → spawn(process.execPath, ["runtime", "start", slug], { detached: true })
  → child writes PID to <stateDir>/runtime.pid
  → parent polls PID file (5s timeout)

runtime stop <slug>
  → read PID file → process.kill(pid, "SIGTERM")
  → poll until process disappears (5s timeout)
  → delete PID file if still present

runtime start (foreground)
  → write PID file on startup
  → delete PID file on exit (SIGTERM/SIGINT)
```

### Channels

| Channel | Protocol | Config |
|---|---|---|
| Web Chat | WebSocket | `webChat.enabled`, `webChat.port` |
| Telegram | HTTPS polling | `telegram.enabled`, `telegram.botToken` |

### Built-in tools (12 + 1 dynamic)

| Tool | Profiles | Description |
|---|---|---|
| `read` | coding, full | Read files |
| `write` | coding, full | Write files |
| `edit` | coding, full | Edit file sections |
| `multiedit` | coding, full | Multi-section editing |
| `bash` | coding, full | Shell command execution |
| `glob` | coding, full | File search by pattern |
| `grep` | coding, full | Search file content |
| `webfetch` | messaging, coding, full | Fetch web content |
| `question` | minimal, messaging, coding, full | Ask user question |
| `todowrite` | coding, full | Todo list management (write) |
| `todoread` | coding, full | Todo list management (read) |
| `skill` | coding, full | Execute named skill |
| `task` | full only | Spawn subagent (removed for subagents) |

### Event bus (26 types)

The bus is instance-scoped (`getBus(slug)`). 26 typed event types (typed via `EventDef<T, P>`):

| Category | Events |
|---|---|
| Runtime | `runtime.started`, `runtime.stopped`, `runtime.state_changed`, `runtime.error` |
| Session | `session.created`, `session.updated`, `session.ended`, `session.status`, `session.system_prompt` |
| Message | `message.created`, `message.updated`, `message.part.delta` |
| Permission | `permission.asked`, `permission.replied` |
| Provider | `provider.auth_failed`, `provider.failover` |
| Subagent | `subagent.completed`, `agent.timeout` |
| Heartbeat | `heartbeat.tick`, `heartbeat.alert` |
| MCP | `mcp.server.reconnected`, `mcp.tools.changed` |
| Tool | `tool.doom_loop`, `llm.chunk_timeout` |
| Channel | `channel.message.received`, `channel.message.sent` |

### Memory system

Separate SQLite FTS5 index in `memory-index.db`. Chunks MEMORY.md and memory/*.md (500 chars, 100 overlap). BM25 search. Temporal decay scoring. `memory_search` tool for agents.

---

## Token architecture

| Token | Size | Storage | Role |
|---|---|---|---|
| **Dashboard token** | 64 chars hex | `~/.claw-pilot/dashboard-token` | Authenticates dashboard REST API (Bearer) |
| **Session cookie** | UUID | Server-side session store | Dashboard auth (HttpOnly cookie) |
| **Password hash** | scrypt | `users` table | Login auth |

---

## Platform compatibility

| Manager | Platform | claw-runtime instances |
|---|---|---|
| **systemd --user** | Linux | PID file |
| **launchd** | macOS | PID file |
| **Docker** | Container | PID file |

---

## Internationalization

6 languages: English, French, German, Spanish, Italian, Portuguese. Via `@lit/localize` (runtime, dynamic loading). See [i18n.md](./i18n.md).

---

*Updated: 2026-04-12 — v0.69.0: schema v34, 20 repositories, ~139 API endpoints, HOMEBOT, workflow engine (FLOW-001), task board + epics, command palette, activity timeline*
