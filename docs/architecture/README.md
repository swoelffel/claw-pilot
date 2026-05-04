# claw-pilot — Functional Architecture

> **Version**: 0.73.5
> **Stack**: TypeScript ~6.0 / Node.js ESM, Lit ^3, SQLite (schema v36), Hono ^4.12
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
| **[Data Model](data-model.md)** | SQLite tables (36), migrations, columns, port range | Touching the database |
| **[Code Structure](code-structure.md)** | Full `src/` directory layout (CLI, Core, Runtime, Dashboard, Lib) | Before coding — find where things live |
| **[CLI Features](features-cli.md)** | 10 CLI commands with usage examples | Working on CLI |
| **[Dashboard](dashboard.md)** | Security, auth, rate limiting, WebSocket monitor | Dashboard/API work |
| **[API Reference](api-reference.md)** | 18 hash routes + ~150 REST endpoints by domain | Building integrations or UI |
| **[Runtime Engine](runtime-engine.md)** | Config, 8 providers, daemon, channels, 12+3 tools, 43+ bus events, flows, workspace-knowledge | Runtime changes |
| **[Capability Registry](capability-registry.md)** | Community/Enterprise differentiation hook, `capabilities.has(...)` contract | Adding enterprise-gated features or writing a consumer hook |
| **[Auth Providers](auth-providers.md)** | Pluggable authentication backends, `AuthProvider` contract, `PasswordProvider` default | Adding a new auth backend (SSO) or touching the login route |
| **[Public Auth Paths](public-auth-paths.md)** | `registerPublicAuthPath(prefix)` registry — extension point for SSO callback URLs that must bypass the auth middleware | Wiring an SSO backend whose flow endpoints live under `/api/auth/<provider>/...` |
| **[Server Registry](server-registry.md)** | `ServerRegistry` abstraction, `SingleServerRegistry` default, capability gate for `multi-server` | Adding multi-server routing or touching `src/server/*` |
| **[Secret Provider](secret-provider.md)** | `SecretProvider` abstraction, `EnvSecretProvider` default, `vault-secrets` capability gate, R5 single read path | Reading or persisting a secret, or porting a consumer to R5 |
| **[Permission Middleware](permission-middleware.md)** | Pluggable `PermissionChecker` extension point, `permission()` Hono factory, ACTIONS catalogue, auth context wiring | Dashboard route access control, H1 Enterprise hook |
| **[Audit Event Bus](audit-event-bus.md)** | Structured `emitAudit()` taxonomy, file + DB default sinks, `audit-siem` capability gate for SIEM sinks, canonical `argsHash` | Instrumenting a new security event or plugging a SIEM sink |
| **[Plugin Signature](plugin-signature.md)** | `PluginVerifier` extension point, `NullPluginVerifier` default, `plugin-signature` capability gate, pre-import hash-and-verify contract | Adding a signature backend (CA, cosign) or touching `loadPluginFromFile()` |
| **[Plugin API](plugin-api.md)** | Hook catalogue, `ToolCallDecision` contract (allow / deny / modify-args / require-approval), `dispatchToolBeforeCall`, audit events `tool.denied` / `tool.approval_required` / `tool.args_modified` | Writing a plugin, enforcing policy/approval/DLP on tool calls |
| **[Discipline Gates](discipline-gates.md)** | Automated R1/R2/R3/R5 enforcement — ESLint plugin + R2 schema script + R3 commit-trailer script + sync-main-to-develop workflow | Touching Community ↔ Enterprise firewall rules, adding new tables or frozen-path changes |
| **[SSE Architecture](../sse-architecture.md)** | Real-time streaming (3 SSE + 1 WS), reconnection, auth | Live features |
| **[Flow Triggers](flow-triggers.md)** | Cron + webhook trigger system, scheduler, `/api/triggers/*` and `/webhooks/triggers/*` route families, secret rotation/reveal | Working on automation triggers (TRIGGER-001) |

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

*Updated: 2026-04-16 — v0.73.5: schema v36, 20 repositories, ~160 API endpoints, 89 UI components, 18 routes*
