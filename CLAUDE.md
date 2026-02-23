# CLAUDE.md — claw-pilot

Guidance for Claude Code when working in this repository.

## What this project is

`claw-pilot` is a **CLI + web dashboard** that orchestrates multiple [OpenClaw](https://docs.openclaw.ai) instances on a single Linux server. It handles discovery, provisioning, lifecycle management (via systemd), Nginx config generation, and device pairing.

Not published on npm — installed from source only (`/opt/claw-pilot`).

## Tech stack

- **Runtime**: Node.js >= 22.12.0, ESM, pnpm
- **CLI**: Commander.js + @inquirer/prompts
- **HTTP/WS**: Hono + ws
- **DB**: better-sqlite3 (SQLite, WAL mode)
- **UI**: Lit web components + Vite
- **Build**: tsdown (CLI) + vite (UI)
- **Tests**: Vitest
- **Lint**: oxlint

## Key commands

```sh
pnpm build:cli     # Build CLI only (dist/)
pnpm build         # Build CLI + UI
pnpm test:run      # Run tests once
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint src/
```

## Architecture

```
src/
  index.ts          # CLI entry point (Commander root)
  commands/         # 14 commands — thin wrappers over core/
  core/             # All business logic
  dashboard/        # HTTP server (Hono) + WebSocket monitor
  db/               # SQLite schema + migrations (schema.ts)
  lib/              # Shared utilities (logger, constants, errors, platform, poll, xdg, shell...)
  server/           # ServerConnection interface + LocalConnection impl
  wizard/           # Interactive creation wizard (@inquirer/prompts)
ui/src/             # Frontend (Lit components, built to dist/ui/)
templates/          # Workspace bootstrap files + systemd/nginx templates
docs/SPEC-MVP.md    # Full technical spec — read this before major changes
```

## Data model (SQLite `~/.claw-pilot/registry.db`)

| Table | Role |
|---|---|
| `servers` | Physical servers (V1: always 1 local row) |
| `instances` | OpenClaw instances — slug, port, state, config_path, nginx_domain |
| `agents` | Agents per instance |
| `ports` | Port reservation registry (anti-conflict) |
| `config` | Global key-value config |
| `events` | Audit log per instance |

Schema lives in `src/db/schema.ts`. Migrations run on DB open.

## Important conventions

### withContext pattern
Every command wraps its logic in `withContext()` (`src/commands/_context.ts`):
- Opens DB + registry
- Resolves `XDG_RUNTIME_DIR`
- Guarantees DB close in finally block

Never open the DB manually in a command — always use this pattern.

### ServerConnection abstraction
All shell/filesystem ops go through `ServerConnection` (`src/server/connection.ts`), not raw `child_process` or `fs` calls. Current impl: `LocalConnection` (`src/server/local.ts`). SSH impl is planned — keep this interface intact.

### Systemd user services
All instances run as `systemd --user` services. `XDG_RUNTIME_DIR` is required for non-root systemd. Use `src/lib/xdg.ts` to resolve it — never hardcode it.

### Port allocation
Default range: **18789–18799** (11 instances max). Dashboard: **19000**. Always allocate via `src/core/port-allocator.ts` — it checks both the registry and actual system port usage.

### Secrets
Gateway tokens and dashboard tokens are auto-generated (`src/core/secrets.ts`). API keys go in `.env` per instance (never in `openclaw.json`). Never commit secrets.

## Test coverage

Tests are under `src/core/__tests__/` and `src/db/__tests__/`. Run them with `pnpm test:run` before submitting changes to core logic.

## What NOT to do

- Do not modify `src/server/connection.ts` interface without updating `LocalConnection` and all callers
- Do not add raw `exec`/`fs` calls in `src/commands/` — go through `conn` from context
- Do not hardcode paths — use `src/lib/platform.ts` and `src/lib/constants.ts`
- Do not add new DB tables without a corresponding migration in `src/db/schema.ts`
