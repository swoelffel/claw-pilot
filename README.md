# claw-pilot

**CLI + web dashboard to orchestrate multi-agent clusters on a Linux or macOS server**

`claw-pilot` v0.30.0 manages the full lifecycle of **claw-runtime** agent instances: provisioning,
service integration, Nginx config generation, device pairing, and a visual Agent Builder to design
and edit multi-agent teams in real-time.

All instances use the **claw-runtime** engine — a native Node.js multi-agent runtime with built-in
support for Agent-to-Agent (A2A) spawning, heartbeat scheduling, MCP integration, permissions system,
memory management, and plugin architecture.

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
- **Heartbeat scheduling** — per-agent background ticks with configurable intervals and time windows
- **MCP integration** — discover and manage MCP servers per instance, real-time tool registry
- **Permission system** — interactive approval for file access, bash execution, agent spawning
- **Memory management** — context window compaction with FTS5 search on workspace files
- **Plugin system** — extensible hooks for tool registration, session lifecycle, message interception

### Dashboard & Tooling
- **Web dashboard** — real-time status dashboard, agent builder, settings, device pairing (port 19000)
- **Inline file editor** — edit agent workspace files (SOUL.md, AGENTS.md, TOOLS.md, MEMORY.md…) in the UI
- **Token management** — `claw-pilot token <slug>` for programmatic access
- **Device pairing** — web-based chat channel with secure 8-char pairing codes
- **Blueprints UI** — create, deploy, and manage reusable agent templates
- **Self-update** — update to latest release via CLI or dashboard banner
- **i18n** — UI available in 6 languages (EN, FR, DE, ES, IT, PT)

---

## Requirements

- **Node.js >= 22.12.0**
- **pnpm >= 9**
- **Linux** (Ubuntu/Debian recommended) with systemd user services
  - OR **macOS** with launchd integration (M1/M2/M3/M4 arm64 or Intel)
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
| **Settings** | Per-instance configuration: general, agents, runtime, devices, MCP, permissions, advanced |
| **Inline Editor** | Edit workspace files (SOUL.md, AGENTS.md, TOOLS.md, MEMORY.md…) with Markdown preview |
| **Chat** | Real-time multi-agent chat via web-chat channel (device pairing required) |

### Key Features

- **Real-time status** — WebSocket push updates (health, heartbeat alerts, MCP server status)
- **Heartbeat monitoring** — per-agent scheduled background ticks with alert visualization
- **MCP dashboard** — view connected MCP servers and their tools
- **Permission requests** — interactive approval UI for file access, bash, A2A spawning
- **Agent tree** — visualize session hierarchy and spawn depth
- **Blueprints** — save team templates as reusable JSON, deploy to any instance

---

## Architecture

```
src/
  commands/         CLI commands — thin wrappers over core/
  core/             Business logic (registry, discovery, provisioner, agent-sync, blueprints, …)
  dashboard/        Hono HTTP server + WebSocket monitor + auth (sessions/cookies)
  db/               SQLite schema and migrations (schema.ts) — current version: 10
  lib/              Utilities (logger, errors, constants, platform, xdg, shell, …)
  runtime/          claw-runtime engine (bus, provider, session, tool, agent, plugin, mcp, channel)
  server/           ServerConnection abstraction (LocalConnection; SSH planned)
  wizard/           Interactive creation wizard (@inquirer/prompts)
ui/src/
  components/       Lit web components (instance cards, agent builder, blueprint views, …)
  locales/          i18n strings (en, fr, de, es, it, pt)
templates/          Workspace bootstrap files (SOUL.md, AGENTS.md, TOOLS.md, …)
```

### Data Model

SQLite `~/.claw-pilot/registry.db` — schema v12. See [`docs/registry-db.md`](docs/registry-db.md).

**claw-pilot registry** (instance management):
| Table | Role |
|-------|------|
| `servers` | Physical servers (always 1 local row in v1) |
| `instances` | Instances — slug, port, state, config path |
| `agents` | Agents per instance/blueprint — canvas position, sync hash, skills |
| `agent_files` | Workspace file cache (SOUL.md, AGENTS.md, TOOLS.md, …) |
| `agent_links` | A2A spawn links and tool dependencies between agents |
| `blueprints` | Reusable agent team templates with canvas layouts |
| `ports` | Port reservation registry (avoid conflicts) |
| `config` | Global key-value configuration (Telegram, dashboard token…) |
| `events` | Audit log per instance (creation, modification, deletion) |
| `users` / `sessions` | Dashboard user accounts + HTTP session auth |

**claw-runtime persistence** (conversation history & state):
| Table | Role |
|-------|------|
| `rt_sessions` | Multi-agent sessions with parent/depth tree structure |
| `rt_messages` | Messages per session (agent input/output) |
| `rt_parts` | Message parts (text, tool-call, tool-result, error) |
| `rt_permissions` | Permission rules approved by user (filesystem, bash, A2A) |
| `rt_auth_profiles` | LLM provider auth profiles with failover chains |
| `rt_pairing_codes` | 8-char device pairing codes for web-chat channel access |

---

## Development

```sh
git clone https://github.com/swoelffel/claw-pilot.git
cd src/claw-pilot
pnpm install

pnpm build         # Build CLI + UI (dist/)
pnpm build:cli     # Build CLI only
pnpm build:ui      # Build UI only (Vite)
pnpm typecheck     # tsc --noEmit
pnpm test:run      # Run unit/integration tests (849 passing)
pnpm test:e2e      # Run e2e tests (102, real HTTP server, in-memory DB)
pnpm lint          # oxlint src/ + prettier check
```

### Development Servers

```sh
# Terminal 1: Dashboard dev server (Vite HMR)
pnpm build:cli && pnpm dashboard

# Terminal 2: UI dev watcher (auto-rebuild on change)
pnpm vite build -w

# Terminal 3: Create and test instances
claw-pilot create
claw-pilot start my-instance
claw-pilot logs my-instance -f
```

### Database Inspection

```sh
# In-memory DB for testing (auto-cleaned)
pnpm test:run

# Production registry at ~/.claw-pilot/registry.db
sqlite3 ~/.claw-pilot/registry.db
  > .tables
  > .schema instances
  > SELECT slug, port, state FROM instances;
```

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Runtime** | Node.js >= 22.12.0, ESM modules |
| **CLI** | Commander.js + @inquirer/prompts (interactive wizard) |
| **HTTP / WebSocket** | Hono + ws (real-time status + agent spawning) |
| **Database** | better-sqlite3 + SQLite WAL (500K+ session capacity) |
| **UI** | Lit web components + Vite + @lit/localize (i18n) |
| **Build** | tsdown (CLI), Vite (UI), TypeScript strict mode |
| **LLM Integration** | Vercel AI SDK v6 (Anthropic, OpenAI, Ollama, custom…) |
| **Tests** | Vitest + Playwright (849 unit + 102 e2e tests) |
| **Lint / Format** | oxlint + Prettier + lefthook (pre-commit hooks) |
| **Plugin System** | Dynamic CommonJS loader for agent plugins |
| **MCP** | @modelcontextprotocol/sdk (stdio + HTTP transports) |

---

## Documentation

| Document | Content |
|----------|---------|
| [`docs/main-doc.md`](docs/main-doc.md) | Architecture overview — read this before major changes |
| [`docs/ux-design.md`](docs/ux-design.md) | Dashboard UX — all screens, components, interaction patterns |
| [`docs/design-rules.md`](docs/design-rules.md) | Design system, anti-patterns, delivery checklist |
| [`docs/i18n.md`](docs/i18n.md) | i18n architecture — adding languages, translation workflow |
| [`docs/registry-db.md`](docs/registry-db.md) | Database schema, migration history, recovery procedures |
| [`CLAUDE.md`](CLAUDE.md) | Development conventions, key patterns, common pitfalls |
| [`../../../AGENTS.md`](../../../AGENTS.md) | Server infrastructure, deployment, runbooks |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

- **v0.30.0** (current) — Workspace autodiscovery, runtime-specific features, UX improvements
- **v0.20.0** — Removed OpenClaw support; claw-runtime only
- **v0.10.0** — First public release (OpenClaw + claw-runtime support)

---

## License

MIT — see [LICENSE](LICENSE)

---

*Updated: 2026-03-16 — claw-runtime focused, OpenClaw references removed, features list expanded*
