# claw-pilot

**Orchestrator for OpenClaw multi-instance clusters**

`claw-pilot` is a CLI + web dashboard that automates provisioning, managing, and monitoring
[OpenClaw](https://docs.openclaw.ai) instances on a Linux server. It handles discovery of
existing instances, full creation wizard, systemd integration, Nginx config generation,
and device pairing bootstrapping.

## Requirements

- Node.js >= 22.12.0
- pnpm >= 9
- Linux (Ubuntu/Debian recommended) with systemd user services enabled
- OpenClaw CLI (auto-installed if missing — `claw-pilot init` will offer to install it)

> **Note:** The OpenClaw install URL defaults to `https://openclaw.ai/install.sh`.
> Override with `OPENCLAW_INSTALL_URL=<url>` if you use a mirror or a specific version.

## Quick install

```sh
curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
```

Or via npm/pnpm:

```sh
pnpm install -g claw-pilot
claw-pilot init
```

## Usage

```
claw-pilot [command]

Commands:
  init              Initialize Claw Pilot & discover existing instances
  create            Create a new OpenClaw instance (interactive wizard)
  destroy <slug>    Destroy an instance (stops service, removes files)
  list              List all instances with status
  start <slug>      Start an instance
  stop <slug>       Stop an instance
  restart <slug>    Restart an instance
  status <slug>     Show detailed status of an instance
  logs <slug>       View gateway logs (with -f for live tail)
  dashboard         Start the web dashboard (default port 19000)
  doctor [slug]     Diagnose instance health
```

## Development

```sh
# Clone
git clone https://github.com/swoelffel/claw-pilot.git
cd claw-pilot

# Install dependencies (requires node-gyp for better-sqlite3)
pnpm install
# If better-sqlite3 native bindings are missing:
# cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npx node-gyp rebuild

# Build CLI
pnpm build:cli

# Run tests
pnpm test:run

# Type check
pnpm typecheck
```

## Architecture

```
claw-pilot/
  src/
    commands/       CLI commands (init, create, destroy, list, ...)
    core/           Business logic (registry, discovery, provisioner, ...)
    dashboard/      Web dashboard (Hono HTTP + WebSocket)
    db/             SQLite schema and migrations
    lib/            Utilities (logger, errors, constants, platform)
    server/         Server abstraction (LocalConnection, future SSHConnection)
    wizard/         Interactive creation wizard
  templates/        Workspace bootstrap files
  docs/
    SPEC-MVP.md     Technical specifications
```

See `docs/SPEC-MVP.md` for full technical specifications.

## License

MIT — see [LICENSE](LICENSE)
