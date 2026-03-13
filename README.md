# claw-pilot

**CLI + web dashboard to orchestrate multi-agent clusters on a Linux server**

`claw-pilot` v0.20.0 manages the full lifecycle of claw-runtime agent instances: provisioning,
service integration, Nginx config generation, device pairing, and a visual Agent Builder to design
and edit multi-agent teams.

All instances use the **claw-runtime** engine — a native Node.js runtime managed via PID file daemon.

> Not published on npm — installed from source only.

**Questions** → [Discussions (Q&A)](https://github.com/swoelffel/claw-pilot/discussions/categories/q-a) · **Bugs / Tasks** → [Issues](https://github.com/swoelffel/claw-pilot/issues) · **Ideas** → [Discussions (Ideas)](https://github.com/swoelffel/claw-pilot/discussions/categories/ideas)

---

## Features

- **Instance management** — provision, start, stop, restart, destroy claw-runtime instances (PID daemon lifecycle)
- **Discovery** — auto-detect existing claw-runtime instances on the server
- **Interactive wizard** — guided creation with Nginx + SSL config generation
- **Web dashboard** — real-time status via WebSocket, port 19000, login/session auth
- **Agent Builder** — visual canvas to design multi-agent teams (drag & drop, A2A/spawn links)
- **Blueprints** — save and reuse agent team templates, deploy to any instance
- **Inline file editor** — edit agent workspace files (SOUL.md, AGENTS.md, TOOLS.md, …) directly from the UI
- **Skills per agent** — configure skill allowlists per agent from the detail panel
- **Token management** — `claw-pilot token <slug>` to retrieve tokens
- **Self-update** — dashboard banner + `claw-pilot update` command
- **i18n** — UI available in 6 languages (EN, FR, DE, ES, IT, PT)

---

## Requirements

- Node.js >= 22.12.0
- pnpm >= 9
- Linux (Ubuntu/Debian recommended) with systemd user services enabled

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

Instance lifecycle:
  init              Initialize claw-pilot & discover existing instances
  create            Create a new instance (interactive wizard)
  destroy <slug>    Destroy an instance (stops service, removes files)
  list              List all instances with status
  start <slug>      Start an instance
  stop <slug>       Stop an instance
  restart <slug>    Restart an instance
  status <slug>     Show detailed status of an instance
  logs <slug>       View runtime logs (-f for live tail)

claw-runtime:
  runtime start <slug>   Start a claw-runtime instance (--daemon for background)
  runtime stop <slug>    Stop a claw-runtime instance
  runtime logs <slug>    View runtime logs

Tooling:
  dashboard         Start the web dashboard (default port 19000)
  token <slug>      Show instance token (--url for full URL, --open to launch browser)
  doctor [slug]     Diagnose instance health
  update            Update claw-pilot to the latest release
  team              Manage agent team files (export / import)
```

---

## Web dashboard

```sh
claw-pilot dashboard
# → http://localhost:19000  (login required)
```

- **Instances view** — live status cards with start/stop/restart actions
- **Agent Builder** — drag-and-drop canvas per instance to visualize and edit the agent graph
- **Blueprints** — create reusable agent team templates and deploy them to instances
- **Inline editor** — edit agent workspace files with Markdown preview, directly from the detail panel
- **Settings** — per-instance configuration (Telegram, plugins, devices, skills)

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

### Data model

SQLite `~/.claw-pilot/registry.db` — schema v10. See [`docs/registry-db.md`](docs/registry-db.md).

| Table | Role |
|-------|------|
| `servers` | Physical servers (V1: always 1 local row) |
| `instances` | Instances — slug, port, state, config_path |
| `agents` | Agents per instance or blueprint — canvas position, sync hash, skills |
| `agent_files` | Workspace file cache (SOUL.md, AGENTS.md, …) |
| `agent_links` | A2A and spawn links between agents |
| `blueprints` | Reusable agent team templates |
| `ports` | Port reservation registry (anti-conflict) |
| `config` | Global key-value config |
| `events` | Audit log |
| `users` / `sessions` | Dashboard authentication |
| `rt_sessions/messages/parts` | claw-runtime conversation history |
| `rt_permissions` / `rt_auth_profiles` | claw-runtime permission rules + API key rotation |
| `rt_pairing_codes` | Device pairing for web-chat channel |

---

## Development

```sh
git clone https://github.com/swoelffel/claw-pilot.git
cd claw-pilot
pnpm install

pnpm build         # Build CLI + UI
pnpm build:cli     # Build CLI only
pnpm test:run      # Run tests (591 unit)
pnpm test:e2e      # Run e2e tests (89, real HTTP server)
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint src/
```

---

## Tech stack

| Layer | Stack |
|-------|-------|
| Runtime | Node.js >= 22, ESM |
| CLI | Commander.js + @inquirer/prompts |
| HTTP / WS | Hono + ws |
| Database | better-sqlite3 (SQLite, WAL) |
| UI | Lit web components + Vite |
| Build | tsdown (CLI) + Vite (UI) |
| LLM SDK | Vercel AI SDK v6 |
| Tests | Vitest |
| Lint | oxlint + Prettier + lefthook |

---

## License

MIT — see [LICENSE](LICENSE)
