# CLAUDE.md — claw-pilot

Guidance for Claude Code when working in this repository.

## What this project is

`claw-pilot` v0.28.4-beta — **CLI + web dashboard** that orchestrates multiple agent instances on a Linux server. It handles discovery, provisioning, lifecycle management, Nginx config generation, and device pairing.

All instances use the **claw-runtime** engine — a native Node.js engine (`src/runtime/`), managed via PID file daemon.

Not published on npm — installed from source only (`/opt/claw-pilot`).
GitHub: https://github.com/swoelffel/claw-pilot

## Tech stack

- **Runtime**: Node.js >= 22.12.0, ESM, pnpm
- **CLI**: Commander.js + @inquirer/prompts
- **HTTP/WS**: Hono + ws
- **DB**: better-sqlite3 (SQLite, WAL mode, schema v11)
- **UI**: Lit web components + Vite
- **Build**: tsdown (CLI) + vite (UI)
- **Tests**: Vitest
- **Lint**: oxlint
- **LLM SDK**: Vercel AI SDK `ai` v6.x

## Key commands

```sh
pnpm build:cli     # Build CLI only (dist/)
pnpm build         # Build CLI + UI
pnpm test:run      # Run tests once
pnpm test:e2e      # Run e2e tests (real HTTP server, in-memory DB)
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint src/
```

## Architecture

```
src/
  index.ts          # CLI entry point (Commander root)
  commands/         # CLI commands — thin wrappers over core/
  core/             # All business logic
  dashboard/        # HTTP server (Hono) + WebSocket monitor
  db/               # SQLite schema + migrations (schema.ts) — current version: 11
  lib/              # Shared utilities (logger, constants, errors, platform, poll, xdg, shell...)
  runtime/          # claw-runtime engine (bus, provider, session, tool, agent, plugin, mcp, channel, engine)
  server/           # ServerConnection interface + LocalConnection impl
  wizard/           # Interactive creation wizard (@inquirer/prompts)
ui/
  src/              # Frontend — Lit web components, built to dist/ui/
    components/     # Reusable UI components (cards, dialogs, status badges...)
    services/       # API client, WebSocket monitor, state management
    localization/   # i18n via @lit/localize (6 languages)
    styles/         # Design tokens, shared CSS
templates/          # Workspace bootstrap files + systemd/nginx templates
docs/main-doc.md    # Functional architecture — read this before major changes
```

## Data model (SQLite `~/.claw-pilot/registry.db`)

| Table | Role |
|---|---|
| `servers` | Physical servers (V1: always 1 local row) |
| `instances` | Instances — slug, port, state, config_path |
| `agents` | Agents per instance or blueprint |
| `ports` | Port reservation registry (anti-conflict) |
| `config` | Global key-value config |
| `events` | Audit log per instance |
| `agent_files` | Workspace files per agent |
| `agent_links` | Agent links (a2a / spawn) |
| `blueprints` | Reusable team templates |
| `rt_sessions` | claw-runtime sessions |
| `rt_messages` | Messages per session |
| `rt_parts` | Message parts (text, tool-call, tool-result) |
| `rt_pairing_codes` | Device pairing codes (8-char) |

Schema lives in `src/db/schema.ts`. Migrations run on DB open. **Always additive** — never DROP COLUMN/TABLE.

## Important conventions

### withContext pattern
Every command wraps its logic in `withContext()` (`src/commands/_context.ts`):
- Opens DB + registry
- Resolves `XDG_RUNTIME_DIR`
- Guarantees DB close in finally block

Never open the DB manually in a command — always use this pattern.

**Exception**: `runtime.ts` commands open the DB directly (no `withContext`) because they manage their own lifecycle.

### ServerConnection abstraction
All shell/filesystem ops go through `ServerConnection` (`src/server/connection.ts`). Current impl: `LocalConnection`. SSH impl is planned — keep this interface intact.

### claw-runtime PID helpers (src/lib/platform.ts)
```typescript
getRuntimePidPath(stateDir)   // <stateDir>/runtime.pid
getRuntimePid(stateDir)       // PID number or null (checks process.kill(pid, 0))
isRuntimeRunning(stateDir)    // boolean
```

### Port allocation
Default range: **18789–18799** (11 instances max). Dashboard: **19000**. Always allocate via `src/core/port-allocator.ts`.

### Secrets
Dashboard tokens are auto-generated (`src/core/secrets.ts`). API keys go in `.env` per instance (never in `runtime.json`). Never commit secrets.

### Vercel AI SDK v6
Breaking changes vs v5:
- `CoreMessage` → `ModelMessage`
- `maxSteps` → `stopWhen: stepCountIs(n)`
- `inputTokens`/`outputTokens` are objects: `{ total, noCache, cacheRead, cacheWrite }` / `{ total, text, reasoning }`
- `finishReason` is an object: `{ unified, raw }` (not a string)
- `zodSchema()` instead of `zod-to-json-schema`
- `resolveModel(providerId, modelId)` — 2 separate args, NOT `"provider/model"`

### exactOptionalPropertyTypes
Use conditional spread for optional fields: `...(val !== undefined ? { key: val } : {})`

## Test coverage

849 tests passing (+ 102 e2e). Tests are under `src/core/__tests__/`, `src/db/__tests__/`, `src/runtime/__tests__/`, `src/runtime/session/__tests__/`, `src/dashboard/__tests__/`. Run with `pnpm test:run` before submitting changes.

## UI development

The dashboard UI uses **Lit** web components with **@lit/localize** for i18n (6 languages).
Built by Vite into `dist/ui/`, served by the Hono dashboard server on port 19000.

Reference docs:

| Document | Content |
|----------|---------|
| `docs/main-doc.md` | Functional architecture overview |
| `docs/ux-design.md` | All screens, components, visual behaviors |
| `docs/design-rules.md` | Design system, anti-patterns, delivery checklist |
| `docs/i18n.md` | i18n architecture, adding languages/features |

## What NOT to do

- Do not modify `src/server/connection.ts` interface without updating `LocalConnection` and all callers
- Do not hardcode paths — use `src/lib/platform.ts` and `src/lib/constants.ts`
- Do not add new DB tables without a corresponding migration in `src/db/schema.ts`
- Do not use `"provider/model"` string format with `resolveModel()` — pass 2 separate args
- Do not call `createBus()` — use `getBus(slug)` and `disposeBus(slug)`
