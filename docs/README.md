# ClawPilot Documentation

> **v0.83.2** — CLI + Web Dashboard for multi-agent AI orchestration

## Quick orientation

ClawPilot orchestrates multiple AI agent instances on a Linux or macOS server. It exposes a **CLI** (`claw-pilot <command>`) and a **web dashboard** (port 19000), both sharing the same business logic and SQLite database. Agents run inside **instances** powered by the claw-runtime engine (Node.js daemon).

## Documentation map

| Document | Content | When to read |
|---|---|---|
| [Architecture overview](architecture/README.md) | System diagram, how pieces fit together | First read |
| [Code structure](architecture/code-structure.md) | Where to find things in `src/` | Before coding |
| [Data model](architecture/data-model.md) | SQLite tables and migrations (schema v41) | Touching the database |
| [API reference](architecture/api-reference.md) | 18 hash routes + ~150 REST endpoints | Building integrations or UI |
| [Runtime engine](architecture/runtime-engine.md) | Config, providers, tools, bus events, flows | Runtime changes |
| [CLI features](architecture/features-cli.md) | 10 CLI commands with examples | Working on CLI |
| [Dashboard](architecture/dashboard.md) | Security, auth, rate limiting, WS monitor | Dashboard/API work |
| [SSE architecture](sse-architecture.md) | Real-time streaming (3 SSE + 1 WS), reconnection | Live features |
| [UX design](ux-design.md) | Routes, style tokens, screen/component index | UI work |
| [Design rules](design-rules.md) | Visual system, anti-patterns, delivery checklist | Creating UI |
| [i18n](i18n.md) | Localization architecture (6 languages) | Adding translations |
| [Registry DB](registry-db.md) | Full SQLite schema reference (all columns) | Schema queries |

## Screen and component docs

Each screen and reusable component has its own documentation file:

- [ux-screens/](ux-screens/) — one file per screen (18 screens)
- [ux-components/](ux-components/) — one file per component (30+ components and dialogs)

## Getting started

1. Read [Architecture overview](architecture/README.md) for the big picture
2. Read [Code structure](architecture/code-structure.md) to navigate the repo
3. Read [UX design](ux-design.md) for the UI route map
4. Dive into the specific area you are working on

For code conventions, build commands, and test setup, see `CLAUDE.md` at the repo root.

---

*Updated: 2026-05-05 — v0.83.2*
