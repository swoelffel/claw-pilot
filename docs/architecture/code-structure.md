# Code Structure

> Part of [claw-pilot Functional Architecture](README.md)

---

## CLI (`src/commands/`)

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

## Wizard (`src/wizard/`)

Interactive creation wizard using `@inquirer/prompts`. Extracted from commands/ for better separation of concerns.

## Core (`src/core/`)

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

## Runtime (`src/runtime/`) — claw-runtime engine

```
engine/       ClawRuntime(config, db, slug, workDir?) — state machine, channel-factory
              config-loader: loadRuntimeConfig(), saveRuntimeConfig(), ensureRuntimeConfig()
              plugin-wiring: wirePluginsToBus()
              channel-factory: creates channel instances from config
              internal-api: InternalApiServer — SSE event stream + HTTP endpoints for IPC
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
              _prompt-loop-handlers: chunk handlers, watchdog manager, compaction logic
tool/         Tool.define() factory, registry (12 built-ins + MCP + plugin tools)
              built-in: read, write, edit, multiedit, bash, glob, grep, webfetch, question, todowrite, todoread, skill
              task: subagent spawning (dynamically added to "full" profile)
              _task-handlers: A2A delegation, subagent execution, contract verdict logic
              profiles: minimal, messaging, coding, full
              built-in/_skill-frontmatter: frontmatter parsing and eligibility checks
              built-in/_skill-remote: remote skill fetching
agent/        7 built-ins (build, plan, explore, general, compaction, title, summary)
              build/plan: have inline fallback prompts; use SOUL.md, IDENTITY.md from disk when workDir is provided
              initAgentRegistry(config.agents), getAgent(), defaultAgentName()
              resolveEffectivePersistence(): kind="primary" → "permanent"
plugin/       Plugin system with 8 hooks: agent.beforeStart, agent.end, tool.beforeCall, tool.afterCall,
              message.received, message.sending, session.start, session.end
              tools(), routes(), tool.definition transform
              system-tools/: DB-direct admin tools (22 cp_* tools) — queries registry.db via Registry, Lifecycle, Provisioner, Destroyer
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

## Dashboard (`src/dashboard/`)

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
  _sse-proxy.ts    SSE proxy: runtime daemon → dashboard → browser (see sse-architecture.md)
  instances/
    index.ts       Instance routes orchestrator
    lifecycle.ts   CRUD instances + start/stop/restart + discover/adopt
    config.ts      GET/PATCH config + providers catalog + telegram token
    runtime-chat.ts  POST chat, GET stream SSE (21+ event types)
    runtime-messages.ts  GET sessions/messages/context
    runtime-status.ts    GET runtime status
    runtime-tools.ts     GET tools
    budgets.ts     Budget CRUD, override, reset, audit events (8 endpoints)
    tasks-crud.ts  Task board CRUD (create, read, update, delete)
    tasks-actions.ts  Status changes, reorder, comments, epics, timeline
    _tasks-shared.ts  Shared task helpers
    flows.ts       Flow CRUD + DAG validation + execution + run history (9 endpoints)
    costs.ts       GET cost aggregations per agent/session
    events.ts      GET rt_events (activity console) + SSE event stream
    heartbeat.ts   GET heartbeat history and analytics
    memory.ts      GET memory files with decay scores
    config-schemas.ts  Schema validation helpers for config patches
    config-patch-handlers.ts  Config PATCH decomposed handlers
    config-builders.ts  Config response builders
    mcp.ts         GET mcp tools/status
    permissions.ts GET permissions, DELETE rule, POST reply
    telegram.ts    GET pairing, POST approve, DELETE reject
    discover.ts    POST discover + adopt
    workspace-download.ts  GET workspace file download
    agents.ts      Agents routes dispatcher
    agents/        CRUD agents + files + sync + skills + spawn-links (8 submodules):
      create.ts, delete.ts, files.ts, list.ts, skills.ts, spawn-links.ts, sync.ts, update.ts
```

## Lib (`src/lib/`)

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

*Updated: 2026-04-16 — v0.73.5*
