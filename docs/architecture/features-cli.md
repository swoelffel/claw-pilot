# CLI Features

> Part of [claw-pilot Functional Architecture](README.md)

---

## 1. Initialization (`init`)

Checks prerequisites, creates `~/.claw-pilot/`, initializes DB, generates dashboard token, creates admin user, registers local server.

## 2. Instance creation (`create`)

Interactive wizard:

1. Slug, display name, port, AI provider, API key, initial agents, optional blueprint
2. Generate `runtime.json` debug snapshot in state directory (`~/.claw-pilot/instances/<slug>/`) — the DB is the source of truth
3. Lifecycle via PID file

## 3. Lifecycle (`start`, `stop`, `restart`, `destroy`)

The `Lifecycle` manages claw-runtime instances via PID file daemon:

| Action | Behavior |
|---|---|
| start | spawn daemon + poll PID file |
| stop | SIGTERM + poll process disappearance |
| restart | stop + start |

```bash
claw-pilot start default
claw-pilot stop default
claw-pilot restart default
claw-pilot destroy default
```

## 4. Health (`status`, `list`)

The `HealthChecker` verifies state via PID file — instance is `running` if PID process is alive.

## 5. claw-runtime commands (`runtime`)

```bash
claw-pilot runtime start <slug>              # foreground (SIGTERM to stop)
claw-pilot runtime start <slug> --daemon     # detached daemon (writes PID file)
claw-pilot runtime stop <slug>               # SIGTERM + poll stop
claw-pilot runtime restart <slug>            # stop + start --daemon
claw-pilot runtime status <slug>             # state + config
claw-pilot runtime chat <slug>               # interactive REPL
claw-pilot runtime chat <slug> --once "msg"  # non-interactive mode (CI/scripts)
claw-pilot runtime config init <slug>        # create runtime.json debug snapshot with defaults (DB is source of truth)
claw-pilot runtime config show <slug>        # display runtime.json debug snapshot
claw-pilot runtime config edit <slug>        # edit runtime.json debug snapshot (prefer DB/dashboard for persistent changes)
claw-pilot runtime mcp add <slug>            # add MCP server
claw-pilot runtime mcp remove <slug>         # remove MCP server
claw-pilot runtime mcp list <slug>           # list MCP servers
```

## 6. Instance token (`token`)

```bash
claw-pilot token default          # raw token
claw-pilot token default --url    # URL with #token=
claw-pilot token default --open   # open browser
```

## 7. Team export/import (`team`)

```bash
claw-pilot team export default --output team.yaml
claw-pilot team import default --file team.yaml
```

## 8. Diagnostics (`doctor`)

Checks Node.js, systemd/launchd, DB, instances in consistent state.

## 9. Dashboard service (`service`)

```bash
claw-pilot service install
claw-pilot service uninstall
claw-pilot service status
```

## 10. Auto-update (`update`)

```bash
claw-pilot update              # update from GitHub (git pull + build)
```

Self-updater bootstraps pnpm via corepack (reads `packageManager` field from `package.json`).

---

*Updated: 2026-04-14 — v0.72.6*
