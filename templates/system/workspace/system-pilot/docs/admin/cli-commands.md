# CLI Command Reference

Complete reference for the `claw-pilot` command-line interface. All instance management, service administration, and runtime operations are available through the CLI.

## Instance Management

| Command | Description |
|---------|-------------|
| `claw-pilot init` | First-run setup: creates `~/.claw-pilot/`, initializes database, generates dashboard token, creates admin user |
| `claw-pilot create` | Interactive wizard to create a new instance (prompts for name, slug, agents, provider) |
| `claw-pilot start <slug>` | Start an instance runtime daemon |
| `claw-pilot stop <slug>` | Stop an instance (sends SIGTERM, polls for shutdown) |
| `claw-pilot restart <slug>` | Stop and start an instance |
| `claw-pilot destroy <slug>` | Delete an instance completely (removes ports, database records, workspace files) |
| `claw-pilot list` | List all instances with their current state (running, stopped, error) |
| `claw-pilot status <slug>` | Detailed instance state: PID, uptime, agents, active sessions, memory usage |
| `claw-pilot token <slug>` | Show or open the dashboard access token for an instance |

## Team Management

| Command | Description |
|---------|-------------|
| `claw-pilot team export` | Export the full agent team configuration to YAML |
| `claw-pilot team import` | Import an agent team from a YAML file |

Team export/import enables backup, migration, and sharing of agent configurations between instances or environments.

## Diagnostics

| Command | Description |
|---------|-------------|
| `claw-pilot doctor` | Run system health diagnostics (Node.js version, DB integrity, service status, instance consistency) |

## Service Management

| Command | Description |
|---------|-------------|
| `claw-pilot service install` | Install the dashboard as a system service (systemd on Linux, launchd on macOS) |
| `claw-pilot service uninstall` | Remove the dashboard system service |
| `claw-pilot service status` | Check if the dashboard service is running |

## Self-Update

| Command | Description |
|---------|-------------|
| `claw-pilot update` | Self-update from GitHub: `git pull` + `pnpm install` + `pnpm build` |

## Runtime Subcommands

The `claw-pilot runtime` command group provides direct runtime control:

| Command | Description |
|---------|-------------|
| `claw-pilot runtime start <slug>` | Start the runtime for an instance |
| `claw-pilot runtime stop <slug>` | Stop the runtime for an instance |
| `claw-pilot runtime restart <slug>` | Restart the runtime |
| `claw-pilot runtime status <slug>` | Show runtime status (PID, uptime, sessions) |
| `claw-pilot runtime chat <slug>` | Interactive CLI chat with an instance agent |
| `claw-pilot runtime config <slug>` | View or modify runtime configuration |
| `claw-pilot runtime mcp <slug>` | Manage MCP server connections for an instance |

### Runtime Chat

`claw-pilot runtime chat <slug>` opens an interactive terminal session with the primary agent of an instance. Messages are sent directly to the agent, bypassing channels. Useful for testing and quick interactions.

### Runtime MCP

`claw-pilot runtime mcp <slug>` manages Model Context Protocol server connections. Use it to add, remove, or list MCP servers that provide additional tools and resources to the instance agents.

## Authentication

| Command | Description |
|---------|-------------|
| `claw-pilot auth` | Manage provider authentication profiles (API key configuration, default model selection) |

Provider auth profiles configure how ClawPilot authenticates with LLM providers (Anthropic, OpenAI, Google, Mistral, xAI, OpenRouter, Ollama). See Named API Keys for centralized key management through the dashboard.

## Common Workflows

### First Installation

```
claw-pilot init
claw-pilot service install
claw-pilot create
claw-pilot start <slug>
```

### Checking System Health

```
claw-pilot doctor
claw-pilot list
claw-pilot status <slug>
```

### Updating ClawPilot

```
claw-pilot update
claw-pilot service status
```

*ClawPilot v0.74.1*
