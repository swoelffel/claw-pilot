# claw-pilot

**CLI + web dashboard to orchestrate multi-agent clusters on a Linux or macOS server**

`claw-pilot` v0.63.1 manages the full lifecycle of **claw-runtime** agent instances: provisioning,
service integration, visual Agent Builder, inter-agent messaging, middleware pipeline, named API keys,
user profiles, budget enforcement, dynamic model discovery, and a real-time dashboard to monitor and interact with multi-agent teams.

All instances use the **claw-runtime** engine — a native Node.js multi-agent runtime with built-in
support for Agent-to-Agent (A2A) messaging, heartbeat scheduling, MCP integration, permissions system,
memory management, middleware chain, and plugin architecture.

> Installed from source only (`/opt/claw-pilot` or custom path via `CLAW_PILOT_INSTALL_DIR`).

**Questions** → [Discussions (Q&A)](https://github.com/swoelffel/claw-pilot/discussions/categories/q-a) · **Bugs / Tasks** → [Issues](https://github.com/swoelffel/claw-pilot/issues) · **Ideas** → [Discussions (Ideas)](https://github.com/swoelffel/claw-pilot/discussions/categories/ideas)

---

## Features

### Instance Management
- **Provision** — interactive wizard to create new claw-runtime instances with auto Nginx + SSL config
- **Discovery** — auto-detect existing instances on the server
- **Lifecycle** — start, stop, restart, destroy instances (PID daemon-based control)
- **Health monitoring** — real-time status via WebSocket, health checks, detailed logs

### Agent Builder & Teams
- **Visual canvas** — drag-and-drop to design multi-agent teams with live preview
- **Agent-to-Agent (A2A)** — spawn links between agents, configure permissions and lifecycle modes
- **Blueprints** — save reusable agent team templates, deploy to any instance
- **Team export/import** — manage agent configurations as JSON/YAML for version control

### Runtime Features
- **Permanent sessions** — primary agents get a single persistent session shared across all channels (web, Telegram, CLI)
- **Inter-agent messaging** — `send_message` tool for persistent cross-agent communication (synchronous or fire-and-forget with async processing)
- **Middleware pipeline** — extensible pre/post middleware chain in the message processing pipeline (guardrail, tool error recovery)
- **Heartbeat scheduling** — per-agent background ticks with configurable intervals and time windows
- **MCP integration** — discover and manage MCP servers per instance, real-time tool registry
- **Permission system** — interactive approval for file access, bash execution, agent spawning
- **Memory management** — context window compaction with FTS5 search on workspace files
- **Plugin system** — extensible hooks for tool registration, session lifecycle, message interception
- **Named API keys** — centralized AES-256-GCM encrypted key management, assignable to instances and agents
- **User profiles** — per-user preferences (language, timezone, communication style, custom instructions)
- **Agent archetypes** — 6 built-in templates (analyst, communicator, evaluator, generator, orchestrator, planner)
- **Budget enforcement** — per-instance/agent monthly or lifetime limits, soft alert (80%), hard stop (100%), auto-pause, Telegram notifications
- **Dynamic model discovery** — real-time model discovery from 8 provider APIs with polling, caching, and DB persistence

### Dashboard & Tooling
- **Web dashboard** — real-time status dashboard, agent builder, settings, device pairing (port 19000)
- **Runtime Pilot** — multi-agent chat with tool call visualization, token/cost tracking, context panel, session tree
- **Cost dashboard** — per-agent cost tracking with SVG charts + budget management tab
- **Activity console** — live event stream (SSE) with filters and floating widget
- **Memory browser** — browse and search agent memory files with decay scores
- **Heartbeat heatmap** — SVG heatmap of multi-agent heartbeat activity
- **Agent templates** — standalone reusable agent templates with archetype system, import/export YAML
- **Named keys panel** — manage encrypted API keys, assign to instances/agents
- **Profile settings** — user preferences, communication style, custom instructions
- **Permission overlay** — real-time permission request/approval from dashboard
- **Inline file editor** — edit agent workspace files (SOUL.md, AGENTS.md, MEMORY.md…) in the UI
- **Self-update** — update to latest release via CLI or dashboard banner
- **i18n** — UI available in 6 languages (EN, FR, DE, ES, IT, PT)

---

## Requirements

- **Node.js >= 22.12.0**
- **pnpm >= 9**
- **Linux** (Ubuntu/Debian recommended) with systemd user services
  - OR **macOS** with launchd integration (M1/M2/M3/M4/M5 arm64 or Intel)
- **Bash >= 5.0** for installation scripts

---

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
```

Clones the repo to `/opt/claw-pilot` (override with `CLAW_PILOT_INSTALL_DIR`), builds the CLI,
and links the binary into your PATH.

---

## CLI commands

```
claw-pilot [command]

Instance Management:
  init              Initialize claw-pilot & discover existing instances
  create            Create a new instance (interactive wizard)
  list              List all instances with status
  status <slug>     Show detailed status of an instance
  destroy <slug>    Destroy an instance (stops service, removes files)

Instance Lifecycle:
  start <slug>      Start an instance
  stop <slug>       Stop an instance
  restart <slug>    Restart an instance

claw-runtime:
  runtime start <slug>        Start a claw-runtime instance (--daemon for background)
  runtime stop <slug>         Stop a claw-runtime instance
  runtime restart <slug>      Restart a claw-runtime instance
  runtime logs <slug>         View runtime logs (-f for live tail)
  runtime config <slug>       Show/edit runtime.json configuration
  runtime chat <slug> [msg]   Interactive chat with an agent

Tooling:
  dashboard         Start the web dashboard (default port 19000)
  token <slug>      Show instance token (--url for full URL, --open to launch browser)
  doctor [slug]     Diagnose instance health (PID, config, workspace files)
  logs <slug>       View instance logs (-f for live tail)
  update            Update claw-pilot to the latest release
  team              Export / import agent team configurations

Authentication & Service:
  auth              Setup / reset / check dashboard authentication
  service           Install / uninstall / restart dashboard system service (systemd/launchd)

Configuration:
  config get <key>  Get a global config value
  config set <key> <value>  Set a global config value
```

---

## Web Dashboard

```sh
claw-pilot dashboard
# → http://localhost:19000  (login required, user: claw-pilot, auto-generated password)
```

### Screens

| Screen | Purpose |
|--------|---------|
| **Instances** | Live status cards (health, port, agent count) with lifecycle actions |
| **Agent Builder** | Visual canvas per instance — design teams with drag-and-drop, A2A/spawn links |
| **Blueprints** | Create, edit, deploy reusable agent team templates |
| **Agent Templates** | Standalone reusable agent templates with archetype system |
| **Runtime Pilot** | Multi-agent chat — tool calls, token usage, context panel, session tree |
| **Session Logs** | Browse session history, messages, system prompt snapshots |
| **Settings** | Per-instance configuration: general, agents, runtime, devices, MCP, permissions, named keys |
| **Cost Dashboard** | Per-agent cost tracking with SVG charts + budget management |
| **Activity Console** | Live event stream with real-time filters |
| **Memory Browser** | Browse and search agent memory files with decay scores |
| **Heartbeat Heatmap** | SVG heatmap of multi-agent heartbeat activity and scheduling |
| **Profile Settings** | User preferences, communication style, custom instructions |

---

## Architecture

```
src/
  commands/         CLI commands — thin wrappers over core/ (17 commands incl. auth, service)
  core/             Business logic (registry, discovery, provisioner, agent-sync, blueprints, …)
    repositories/   16 SQLite repositories (server, instance, agent, port, config, event,
                    blueprint, agent-blueprint, runtime-session, rt-event, cost, heartbeat,
                    named-key, runtime-config, user-profile, budget)
    model-discovery/ Dynamic model discovery service (8 provider adapters, polling, DB persistence)
  dashboard/        Hono HTTP server + WebSocket monitor + auth (sessions/cookies)
    routes/         REST API (~113 endpoints) + WebSocket
  db/               SQLite schema and migrations (schema.ts) — current version: 28
  lib/              Utilities (logger, errors, constants, platform, xdg, shell, …)
  runtime/          claw-runtime engine
    bus/            Event bus (pub/sub)
    channel/        Message channels (web-chat, Telegram, internal)
    config/         Runtime configuration types and loaders
    engine/         Engine bootstrap, config builder, plugin wiring
    middleware/     Pre/post middleware pipeline (guardrail, tool error recovery)
    permission/     Permission ruleset (wildcard glob matching, last-match-wins)
    profile/        User profile resolution (community resolver)
    provider/       LLM provider resolution and auth profiles
    session/        Prompt loop, message handling, compaction, system prompt
    tool/           Built-in tools + send_message + task delegation
    agent/          Agent defaults, registry, kind resolution
    plugin/         Plugin system (hooks, types)
    mcp/            MCP client integration
    memory/         Memory indexing, decay, search tool
    heartbeat/      Heartbeat scheduling and execution
  server/           ServerConnection abstraction (LocalConnection; SSH planned)
  wizard/           Interactive creation wizard (@inquirer/prompts)
ui/src/
  components/       43 Lit web components (instance cards, agent builder, pilot, …)
    pilot/          Runtime Pilot subcomponents (messages, parts, context, input, header)
  services/         Auth state, WS monitor, router, update poller
  locales/          i18n via @lit/localize (6 languages)
  styles/           Design tokens, shared CSS
templates/
  archetypes/       6 agent archetype templates (analyst, communicator, evaluator, …)
  blueprints/       3 built-in team blueprints (design-studio, dev-harness, team-architect)
  workspace/        Workspace bootstrap files (SOUL.md, IDENTITY.md, AGENTS.md, …)
```

### Data Model

SQLite `~/.claw-pilot/registry.db` — schema v28. See [`docs/registry-db.md`](docs/registry-db.md).

**claw-pilot registry** (instance management):
| Table | Role |
|-------|------|
| `servers` | Physical servers (always 1 local row in v1) |
| `instances` | Instances — slug, port, state, runtime_config_json, default_named_key_id |
| `agents` | Agents per instance/blueprint — canvas position, skills, config_json, named_key_id |
| `agent_files` | Workspace file cache (SOUL.md, AGENTS.md, MEMORY.md…) |
| `agent_links` | A2A spawn links and tool dependencies between agents |
| `blueprints` | Reusable agent team templates with canvas layouts |
| `agent_blueprints` | Standalone reusable agent templates |
| `agent_blueprint_files` | Workspace files per agent blueprint |
| `named_api_keys` | AES-256-GCM encrypted API keys (admin-global) |
| `ports` | Port reservation registry (avoid conflicts) |
| `config` | Global key-value configuration |
| `events` | Audit log per instance (creation, modification, deletion) |
| `users` / `sessions` | Dashboard user accounts + HTTP session auth |
| `user_profiles` | Per-user preferences (language, timezone, communication style) |
| `rt_budgets` | Per-instance/agent budget limits (monthly/lifetime, soft alert, hard stop) |
| `rt_budget_events` | Budget audit trail (alerts, overrides, resets) |
| `discovered_models` | Models discovered from provider APIs (cached, with capabilities + cost) |
| `discovery_status` | Provider discovery status (last success/error, model count) |

**claw-runtime persistence** (conversation history & state):
| Table | Role |
|-------|------|
| `rt_sessions` | Permanent (one per primary agent, cross-channel) or ephemeral sessions |
| `rt_messages` | Messages per session (user/assistant, model, tokens, cost) |
| `rt_parts` | Message parts (text, tool-call, tool-result, error) |
| `rt_events` | Runtime bus events per instance (activity console) |
| `rt_permissions` | Permission rules approved by user (filesystem, bash, A2A) |
| `rt_auth_profiles` | LLM provider auth profiles with failover chains |
| `rt_system_prompts` | System prompt snapshots per session (deduplicated by hash) |

---

## Development

```sh
git clone https://github.com/swoelffel/claw-pilot.git
cd claw-pilot
pnpm install

pnpm build         # Build CLI + UI (dist/)
pnpm build:cli     # Build CLI only
pnpm build:ui      # Build UI only (Vite)
pnpm typecheck:all # tsc --noEmit (backend + UI)
pnpm test:run      # Run unit/integration tests (~1900 passing)
pnpm test:ui       # Run UI tests
pnpm test:e2e      # Run e2e tests (~100, real HTTP server, in-memory DB)
pnpm lint:all      # oxlint src/ + ui/src/
pnpm format:check  # Prettier check
pnpm spellcheck    # cspell (en + fr dictionaries)
```

Pre-commit hooks (lefthook): format:check + lint:all + typecheck:all.
Pre-push hooks: spellcheck + test:run. Commits follow conventional commits (commitlint).

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Runtime** | Node.js >= 22.12.0, ESM modules, TypeScript ~6.0 |
| **CLI** | Commander.js ^14 + @inquirer/prompts (interactive wizard) |
| **HTTP / WebSocket** | Hono ^4.12 + ws ^8 (real-time status + agent communication) |
| **Database** | better-sqlite3 ^12 + SQLite WAL (schema v28) |
| **UI** | Lit ^3 web components + Vite ^8 + @lit/localize (i18n, 6 languages) |
| **Build** | tsdown (CLI), Vite ^8 (UI) |
| **LLM Integration** | Vercel AI SDK ^6.0 (@ai-sdk/anthropic, openai, google) |
| **Tests** | Vitest ^4 (~1900 unit/integration + ~100 e2e) |
| **Lint / Format** | oxlint ^1.56 + Prettier ^3.8 + cspell + lefthook (pre-commit/push hooks) |
| **Plugin System** | Event bus + hook-based plugins for tool, session, and message lifecycle |
| **MCP** | @modelcontextprotocol/sdk ^1.28 (stdio + HTTP transports) |

---

## Documentation

| Document | Content |
|----------|---------|
| [`docs/main-doc.md`](docs/main-doc.md) | Architecture overview — read this before major changes |
| [`docs/ux-design.md`](docs/ux-design.md) | Dashboard UX — all screens, components, interaction patterns |
| [`docs/ux-screens/`](docs/ux-screens/) | Individual screen docs (13 screens) |
| [`docs/ux-components/`](docs/ux-components/) | Individual component and dialog docs (26 components) |
| [`docs/design-rules.md`](docs/design-rules.md) | Design system, anti-patterns, delivery checklist |
| [`docs/i18n.md`](docs/i18n.md) | i18n architecture — adding languages, translation workflow |
| [`docs/registry-db.md`](docs/registry-db.md) | Database schema (v28), migration history, recovery procedures |
| [`CLAUDE.md`](CLAUDE.md) | Development conventions, key patterns, common pitfalls |
| [`CHANGELOG.md`](CHANGELOG.md) | Detailed release notes |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

- **v0.63.0** (current) — Dynamic model discovery, 8 providers, circular dependency fix
- **v0.62.0** — Budget enforcement with auto-pause, Telegram alerts, 55 new tests
- **v0.61.12** — Documentation overhaul (README, main-doc, registry-db)
- **v0.58.0** — Dashboard service management, auth command, system prompt snapshots
- **v0.55.0** — Agent templates, runtime config in DB, skills sync
- **v0.49.1** — Middleware chain, fire-and-forget fix, TypeScript 6.0
- **v0.48.0** — Heartbeat heatmap, memory browser, activity console, cost dashboard
- **v0.45.0** — Cost tracking, send_message tool, multi-agent collaboration
- **v0.30.0** — Workspace autodiscovery, runtime-specific features
- **v0.20.0** — Removed OpenClaw support; claw-runtime only

---

## License

MIT — see [LICENSE](LICENSE)

---

*Updated: 2026-04-08 — v0.63.0, schema v28, 8 providers, budget enforcement, dynamic model discovery, ~113 REST endpoints*
