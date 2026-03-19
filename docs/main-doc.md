# claw-pilot — Functional Architecture

> **Version**: 0.41.39
> **Stack**: TypeScript / Node.js ESM, Lit web components, SQLite, Hono
> **Repo**: https://github.com/swoelffel/claw-pilot
> **Detailed References**: [ux-design.md](./ux-design.md) · [agents.md](./agents.md) · [registry-db.md](./registry-db.md) · [i18n.md](./i18n.md) · [design-rules.md](./design-rules.md) · `CLAUDE.md`

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
│              Registry (facade) → 8 Repositories                 │
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
                <stateDir>/runtime.json
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

**Current migration version: 16**

**Default port range**: 18789–18838 (50 ports, 10 instances at 5-port intervals). Dashboard: 19000.

**Migration rule**: always additive (ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS). Never use DROP COLUMN / DROP TABLE without table recreation — migrations are irreversible on VM01.

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
registry.ts               facade over 9 repositories
registry-types.ts         types InstanceRecord, AgentRecord, BlueprintRecord, AgentBlueprintRecord, etc.
repositories/             9 SQLite repositories:
  server-repository.ts      — servers table
  instance-repository.ts    — instances table
  agent-repository.ts       — agents + agent_files + agent_links tables
  port-repository.ts        — ports table
  config-repository.ts      — config table
  event-repository.ts       — events table
  blueprint-repository.ts   — blueprints + blueprint agents + blueprint links
  runtime-session-repository.ts — rt_sessions enriched queries
  agent-blueprint-repository.ts — agent_blueprints + agent_blueprint_files
agent-sync.ts             sync agents from runtime.json
agent-workspace.ts        resolve agent workspace paths
blueprint-deployer.ts     deploy blueprint on creation
config-generator.ts       generate .env with provider keys
config-helpers.ts         runtime.json manipulation
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
provider/     resolveModel(providerId, modelId), 5 providers, auth-profiles rotation
              MODEL_CATALOG: 10 models (Anthropic, OpenAI, Google, Ollama)
permission/   ruleset last-match-wins, allow/deny/ask, wildcard glob matching
config/       RuntimeConfig Zod schema, parseRuntimeConfig(), createDefaultRuntimeConfig()
session/      createSession(), getOrCreatePermanentSession(), runPromptLoop()
              permanent session key: <slug>:<agentId> (cross-channel, no peerId)
              auto compaction, system-prompt builder, workspace-cache
              message-builder: converts DB messages → ModelMessage[] (AI SDK v6)
              usage-tracker: cost and token tracking
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
heartbeat/    HeartbeatRunner, intervals 5m-24h, active hours (timezone-aware)
              HeartbeatTick, HeartbeatAlert, ack pattern "HEARTBEAT_OK"
```

### Dashboard (`src/dashboard/`)

```
server.ts          Hono entry point — auth middleware (session cookie + Bearer token),
                   rate limiting, security headers, SPA fallback, WebSocket
monitor.ts         WebSocket monitor (health_update every 10s, delta-compressed)
                   enriches with: pendingPermissions, heartbeat agents/alerts, MCP count
rate-limit.ts      Rate limiter per IP (60/min API, 10/min instances, 1/5min self-update)
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
  instances.ts     Instance routes dispatcher
  instances/
    index.ts       Instance routes orchestrator
    lifecycle.ts   CRUD instances + start/stop/restart + discover/adopt
    config.ts      GET/PATCH config + providers catalog + telegram token
    runtime.ts     GET runtime status/sessions/messages/context, POST chat, GET stream SSE, GET heartbeat history
    mcp.ts         GET mcp tools/status
    permissions.ts GET permissions, DELETE rule, POST reply
    telegram.ts    GET pairing, POST approve, DELETE reject
    discover.ts    POST discover + adopt
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
2. Generate `runtime.json` in state directory (`~/.claw-pilot/instances/<slug>/`)
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
claw-pilot runtime config init <slug>        # create runtime.json with defaults
claw-pilot runtime config show <slug>        # display runtime.json
claw-pilot runtime config edit <slug>        # edit runtime.json
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
| **Rate limiting** | 60 req/min per IP on `/api/*` · 10 req/min on `POST /api/instances` · 1/5min self-update |
| **Security headers** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| **Validation** | Zod `.strict()` on config patches |
| **TokenCache** | In-memory token cache |
| **Public healthcheck** | `GET /health` without auth |

### Client-side routing (hash-based)

| Hash URL | View | Component |
|---|---|---|
| `#/` or `#/instances` | Instances view | `cp-cluster-view` |
| `#/instances/:slug/builder` | Agent builder | `cp-agents-builder` |
| `#/instances/:slug/settings` | Instance settings | `cp-instance-settings` |
| `#/instances/:slug/pilot` | Interactive chat + LLM context panel | `cp-runtime-pilot` |
| `#/blueprints` | Blueprints view | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | Blueprint builder | `cp-blueprint-builder` |

### REST API (69 endpoints)

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
| `GET` | `/api/instances/:slug/runtime/heartbeat/history` | Heartbeat history |

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

### WebSocket Monitor

WS connection on `/ws`. Auth via first message. Broadcasts `health_update` every 10s with each instance state (delta-compressed). Enriches with: pending permissions, heartbeat agents/alerts, MCP count.

---

## claw-runtime engine

### Config (`runtime.json`)

Stored in `<stateDir>/runtime.json`. Zod schema `RuntimeConfig`:

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

10 models across 5 providers (see `src/runtime/provider/models.ts`):

| Provider | ID | Models |
|---|---|---|
| Anthropic | `anthropic` | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5 |
| OpenAI | `openai` | gpt-4o, gpt-4o-mini, o3-mini |
| Google | `google` | gemini-2.0-flash, gemini-2.5-pro |
| Ollama | `ollama` | llama3.2, qwen2.5-coder (local, no cost) |
| OpenRouter | `openrouter` | any OpenRouter model (pass-through) |

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
| **systemd --user** | Linux (VM01) | PID file |
| **launchd** | macOS (dev local, MACMINI-INT) | PID file |
| **Docker** | Container | PID file |

---

## Internationalization

6 languages: English, French, German, Spanish, Italian, Portuguese. Via `@lit/localize` (runtime, dynamic loading). See [i18n.md](./i18n.md).

---

*Updated: 2026-03-19 - v0.41.39: schema v16 (agent_blueprints, agent_blueprint_files), 9 repositories, 69 API endpoints (12 new /api/agent-blueprints), 26 bus events (session.system_prompt), plugin hooks renamed, wizard/ directory*
