# claw-pilot

> **Self-hosted multi-agent orchestration runtime — task board, flow engine, budget control, real-time dashboard.**

[![version](https://img.shields.io/github/v/tag/swoelffel/claw-pilot?label=release)](https://github.com/swoelffel/claw-pilot/releases)
[![ci](https://github.com/swoelffel/claw-pilot/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/swoelffel/claw-pilot/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node: >=22.12](https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![website](https://img.shields.io/badge/site-clawpilot.eu-blue)](https://clawpilot.eu)

Run a team of LLM agents on your own server. Wire them together with A2A messaging, schedule them with heartbeats, orchestrate them with DAG flows, cap their spend with budgets, watch them work in a real-time dashboard.

**[📖 Documentation](docs/main-doc.md)** · **[🌐 Website](https://clawpilot.eu)** · **[💬 Discussions](https://github.com/swoelffel/claw-pilot/discussions)** · **[🐛 Issues](https://github.com/swoelffel/claw-pilot/issues)**

---

## What you can build in an afternoon

### 🤖 A 3-agent ops team with spending cap
Provision an instance, drop three archetypes on the canvas (analyst, communicator, orchestrator), wire A2A links, set a `$50/month` hard-stop budget. The orchestrator delegates via `send_message`; if the cap hits 80% you get a Telegram alert, at 100% the instance auto-pauses.

### 📅 A daily maintenance flow
Declare a DAG (`check-site → run-audit → post-report`), schedule it on a cron trigger, let the flow engine fan out steps in parallel, collect structured SITREPs at each completion, stream the whole run live to the dashboard. Failed step? Automatic retry with backoff, then inbox notification.

### 💬 A chat-first assistant with persistent memory
Pair a primary agent with a permanent cross-channel session (web, Telegram, CLI), give it workspace tools (`ws_search_files`, memory with decay scoring), expose MCP servers for domain tools. Same conversation whether you ping it from your phone or your terminal.

---

## Quickstart

**Requirements:** Node.js ≥ 22.12, pnpm ≥ 9, Linux (systemd) or macOS (launchd), Bash ≥ 5.

```sh
curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
```

Then:

```sh
claw-pilot init           # discover / bootstrap
claw-pilot create         # interactive wizard → first instance
claw-pilot dashboard      # http://localhost:19000
```

Override the install path with `CLAW_PILOT_INSTALL_DIR`. For production setup (systemd / launchd service, reverse proxy, SSL), see [`docs/main-doc.md`](docs/main-doc.md).

---

## What's inside

### Runtime engine (`claw-runtime`)
| Capability | What it does |
|---|---|
| **Flow engine** | Declarative DAG workflows — fan-out/fan-in, per-step timeout & retry, structured SITREP outcomes, automatic tool-call repair |
| **Task board** | Kanban with 5 states, drag & drop, epic hierarchy, agent auto-assignment with wakeup, activity timeline |
| **A2A messaging** | `send_message` tool for persistent sync or fire-and-forget cross-agent communication |
| **Permanent sessions** | One session per primary agent, shared across web / Telegram / CLI channels |
| **Heartbeat scheduler** | Per-agent background ticks, timezone-aware active hours, session reuse |
| **Budget enforcement** | Monthly or lifetime limits, soft alerts (80%), hard stop (100%), auto-pause, Telegram notifications |
| **MCP integration** | Per-instance MCP server registry, live tool discovery, stdio + HTTP transports |
| **Memory** | Context compaction, FTS5 search on workspace files, decay scoring |
| **Middleware** | Pre/post message pipeline (guardrail, tool error recovery), extensible via plugins |
| **Permissions** | Interactive approval for filesystem, bash, agent spawning — wildcard rules persisted |

### Dashboard & tooling
| Screen | What it's for |
|---|---|
| **Home (HOMEBOT)** | Chatbot entry point with admin plugin (22 tools), setup wizard |
| **Instances** | Live status cards, lifecycle actions, health widgets |
| **Task Board** | Kanban + epics + timeline |
| **Flows** | Editor, run history, live SSE step-by-step detail |
| **Agent Builder** | Drag-and-drop canvas per instance, A2A/spawn links, blueprints |
| **Runtime Pilot** | Multi-agent chat with tool calls, token/cost tracking, session tree |
| **Cost Dashboard** | Per-agent spend charts, budget management |
| **Command Palette** | Cmd+K global search (FTS5 BM25) across instances/agents/tasks/blueprints |
| **Activity Console** | Live event stream (SSE) with filters |
| **Memory Browser** | Browse/search agent memory with decay scores |
| **Inbox** | Persistent notification feed, bell badge, 6 event types |
| **Named Keys** | AES-256-GCM encrypted API keys, assignable per instance/agent |
| **i18n** | UI in 6 languages (EN, FR, DE, ES, IT, PT) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Dashboard (Hono + Lit)         :19000  (SSE + WS)  │
└───────────────┬─────────────────────────────────────┘
                │
       ┌────────▼─────────┐      ┌─────────────────┐
       │  claw-pilot CLI  │──────│  registry.db    │
       │  (provisioner)   │      │  (SQLite WAL)   │
       └────────┬─────────┘      └─────────────────┘
                │
    ┌───────────┼───────────┬─────────────┐
    │           │           │             │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐     ┌───▼───┐
│ inst1 │   │ inst2 │   │ inst3 │ ... │ instN │   claw-runtime instances
└───┬───┘   └───────┘   └───────┘     └───────┘   (multi-agent, A2A, flows)
    │
    ├── Agent(main)  ──┐
    ├── Agent(ops)    ─┼── bus + middleware + permissions
    └── Agent(analyst)─┘
         └── MCP tools, memory, heartbeat, budget
```

Single `~/.claw-pilot/registry.db` (schema v41) is the source of truth for instances, agents, blueprints, flows, tasks, budgets, and conversation history. See [`docs/main-doc.md`](docs/main-doc.md) for the full architecture and [`docs/registry-db.md`](docs/registry-db.md) for the data model (40 tables, 23 repositories).

---

## CLI at a glance

```
claw-pilot init | create | list | status | destroy
claw-pilot start | stop | restart <slug>
claw-pilot runtime start|stop|restart|logs|config|chat <slug>
claw-pilot dashboard | token | doctor | logs | update | team
claw-pilot auth | service | config
```

Run `claw-pilot --help` for the full reference.

---

## Development

```sh
git clone https://github.com/swoelffel/claw-pilot.git
cd claw-pilot && pnpm install
pnpm build                 # CLI + UI
pnpm test:run              # ~2400 unit/integration tests
pnpm test:e2e              # ~100 e2e
pnpm typecheck:all lint:all format:check spellcheck
```

**Tech stack** — Node 22+, TypeScript ~6, Hono + Lit + Vite, better-sqlite3 WAL, Vercel AI SDK ^6, MCP SDK ^1.28, Vitest ^4, oxlint + Prettier + cspell + lefthook, conventional commits.

Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md) — strict develop-first gitflow, PRs target `develop`, never bump version in feature PRs.

---

## Documentation

| | |
|---|---|
| [`docs/main-doc.md`](docs/main-doc.md) | Architecture index |
| [`docs/registry-db.md`](docs/registry-db.md) | Database schema + migration history |
| [`docs/ux-design.md`](docs/ux-design.md) | Dashboard UX — screens, components, patterns |
| [`docs/design-rules.md`](docs/design-rules.md) | Design system, anti-patterns, delivery checklist |
| [`docs/i18n.md`](docs/i18n.md) | i18n workflow |
| [`docs/sse-architecture.md`](docs/sse-architecture.md) | Real-time streaming (3 SSE + 1 WS) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |
| [`CLAUDE.md`](CLAUDE.md) | Development conventions for AI coding assistants |

---

## License

MIT — see [LICENSE](LICENSE).
