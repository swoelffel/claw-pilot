# claw-pilot — Functional Architecture

> **Version**: 0.72.6
> **Stack**: TypeScript ~6.0 / Node.js ESM, Lit ^3, SQLite (schema v34), Hono ^4.12
> **Repo**: https://github.com/swoelffel/claw-pilot

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
                <stateDir>/workspaces/<agentId>/
```

---

## Documentation index

| Document | Content | When to read |
|---|---|---|
| **[Data Model](data-model.md)** | SQLite tables (34), migrations, columns, port range | Touching the database |
| **[Code Structure](code-structure.md)** | Full `src/` directory layout (CLI, Core, Runtime, Dashboard, Lib) | Before coding — find where things live |
| **[CLI Features](features-cli.md)** | 10 CLI commands with usage examples | Working on CLI |
| **[Dashboard](dashboard.md)** | Security, auth, rate limiting, WebSocket monitor | Dashboard/API work |
| **[API Reference](api-reference.md)** | 18 hash routes + ~150 REST endpoints by domain | Building integrations or UI |
| **[Runtime Engine](runtime-engine.md)** | Config, 8 providers, daemon, channels, 12 tools, 26 bus events, flows | Runtime changes |
| **[SSE Architecture](../sse-architecture.md)** | Real-time streaming (3 SSE + 1 WS), reconnection, auth | Live features |

### Related docs

| Document | Content |
|---|---|
| [UX Design](../ux-design.md) | Routes, tokens, screen/component index |
| [Design Rules](../design-rules.md) | Visual system, anti-patterns, delivery checklist |
| [i18n](../i18n.md) | Localization architecture (6 languages) |
| [Registry DB](../registry-db.md) | Full SQLite schema reference (all tables, columns, migrations) |
| [Screen docs](../ux-screens/) | One file per screen (18 screens) |
| [Component docs](../ux-components/) | One file per component (30+ components) |

---

*Updated: 2026-04-14 — v0.72.6: schema v34, 20 repositories, ~150 API endpoints, 86 UI components, 18 routes*
