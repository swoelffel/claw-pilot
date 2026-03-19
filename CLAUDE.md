# CLAUDE.md — claw-pilot

Guidance for Claude Code when working in this repository.

## What this project is

`claw-pilot` v0.41.40 — **CLI + web dashboard** that orchestrates multiple claw-runtime agent instances on a Linux or macOS server. It handles discovery, provisioning, lifecycle management, and permanent cross-channel sessions.

All instances use the **claw-runtime** engine — a native Node.js engine (`src/runtime/`), managed via PID file daemon.

Not published on npm — installed from source only (`/opt/claw-pilot`).
GitHub: https://github.com/swoelffel/claw-pilot

## Tech stack

- **Runtime**: Node.js >= 22.12.0, ESM, pnpm
- **CLI**: Commander.js + @inquirer/prompts
- **HTTP/WS**: Hono + ws
- **DB**: better-sqlite3 (SQLite, WAL mode, schema v16)
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
  db/               # SQLite schema + migrations (schema.ts) — current version: 15
  lib/              # Shared utilities (logger, constants, errors, platform, poll, xdg, shell...)
  runtime/          # claw-runtime engine (bus, provider, session, tool, agent, plugin, mcp, channel, engine)
  server/           # ServerConnection interface + LocalConnection impl
  wizard/           # Interactive creation wizard (@inquirer/prompts)
ui/
  src/              # Frontend — Lit web components, built to dist/ui/
    components/     # Reusable UI components (cards, dialogs, status badges...)
    services/       # Auth state, WS monitor, router, update poller (extracted from app.ts)
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
| `agent_blueprints` | Standalone reusable agent templates (id TEXT PK, config_json, category) |
| `agent_blueprint_files` | Workspace files per agent blueprint |
| `rt_sessions` | claw-runtime sessions — permanent (one per agent, cross-channel) or ephemeral (per conversation). Key format: `<slug>:<agentId>` (permanent) or `<slug>:<agentId>:<channel>:<peerId>` (ephemeral) |
| `rt_messages` | Messages per session |
| `rt_parts` | Message parts (text, tool-call, tool-result) |
| `rt_permissions` | Persisted permission rules (allow/deny/ask per scope+pattern) |
| `rt_auth_profiles` | API key rotation per provider (priority, cooldown, failure tracking) |
| `rt_pairing_codes` | Device pairing codes (legacy, table retained for additive-only policy) |
| `users` | Dashboard auth (admin/operator/viewer roles) |
| `sessions` | Server-side dashboard sessions with TTL |

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
Default range: **18789–18838** (50 ports, 10 instances at min step 5). Dashboard: **19000**. Always allocate via `src/core/port-allocator.ts`.

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

### Permanent sessions (PLAN-16)
- Primary agents (`kind: "primary"`) get a single permanent session shared across all channels (Telegram, web, CLI)
- Session key format: `<slug>:<agentId>` — no peerId, no channel in the key
- Use `getOrCreatePermanentSession(db, { instanceSlug, agentId })` — never pass peerId for permanent keys
- Subagent sessions remain ephemeral, scoped by `parentSessionId`
- `buildPermanentSessionKey(instanceSlug, agentId)` takes exactly 2 args (no peerId)

### ClawRuntime daemon
- Constructor: `new ClawRuntime(config, db, slug, workDir?)` — 4th arg is `stateDir` for workspace file loading
- Without `workDir`, workspace files (SOUL.md, IDENTITY.md, etc.) are NOT loaded in the system prompt
- The daemon command (`runtime start --daemon`) passes `stateDir` as `workDir`

### Agent defaults (defaults.ts)
- `BUILD_AGENT` and `PLAN_AGENT` have NO inline `prompt` — they use workspace files (SOUL.md, IDENTITY.md) or `DEFAULT_INSTRUCTIONS` as fallback
- Internal agents (`COMPACTION_AGENT`, `TITLE_AGENT`, `SUMMARY_AGENT`, `EXPLORE_AGENT`, `GENERAL_AGENT`) keep their inline prompts (they are not user-configurable)

## Test coverage

~900+ tests passing (+ ~100 e2e). Tests are under `src/core/__tests__/`, `src/db/__tests__/`, `src/runtime/__tests__/`, `src/runtime/session/__tests__/`, `src/runtime/heartbeat/__tests__/`, `src/dashboard/__tests__/`, `src/lib/__tests__/`, `src/commands/__tests__/`. Run with `pnpm test:run` before submitting changes.

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
| `docs/registry-db.md` | SQLite schema reference (all tables, columns, migrations) |
| `docs/agents.md` | Agent architecture: kinds, modes, tools, permissions, UI panels |
| `docs/runbook-deploy.md` | Deployment workflow, CI/CD validation, MACMINI-INT |

## What NOT to do

- Do not modify `src/server/connection.ts` interface without updating `LocalConnection` and all callers
- Do not hardcode paths — use `src/lib/platform.ts` and `src/lib/constants.ts`
- Do not add new DB tables without a corresponding migration in `src/db/schema.ts`
- Do not use `"provider/model"` string format with `resolveModel()` — pass 2 separate args
- Do not call `createBus()` — use `getBus(slug)` and `disposeBus(slug)`
- Do not import from `"zod/v4"` — use `from "zod"` everywhere (standardized on Zod v4 main entrypoint)
- Do not use `window.__CP_TOKEN__` — use `getToken()` / `setToken()` / `clearToken()` from `ui/src/services/auth-state.ts`
- Do not add direct `readFileSync` calls in workspace hot paths — use `readWorkspaceFileCached()` from `src/runtime/session/workspace-cache.ts`
- Do not write SQL aggregations inline in route handlers — add methods to the appropriate repository in `src/core/repositories/`
- Do not add memory system reads without going through `readWorkspaceFileCached()` — the memory index (`memory-index.db`) is rebuilt from workspace files via FTS5
