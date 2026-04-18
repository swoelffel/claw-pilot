# Doctor Diagnostics

System health checker for ClawPilot installations. The `claw-pilot doctor` command runs a series of diagnostic checks and reports issues with suggested fixes.

## Running Diagnostics

```
claw-pilot doctor
```

The command exits with code 0 if all checks pass, or non-zero if any check fails.

## Diagnostic Checks

| Check | What It Verifies | Minimum Requirement |
|-------|-----------------|---------------------|
| Node.js version | Node.js is installed and meets version requirement | >= 22.12.0 |
| pnpm availability | pnpm is available via corepack or global install | Any supported version |
| Service status | Dashboard system service state (systemd/launchd) | Running if installed |
| Database integrity | SQLite database is accessible and not corrupted | Valid schema, no WAL errors |
| Instance consistency | Running instances have live PIDs, stopped instances have no orphan processes | All instances in consistent state |

### Node.js Version Check

Verifies that Node.js is installed and the version is at least 22.12.0. This is the minimum required version for ClawPilot's runtime features including native fetch, WebSocket, and module resolution.

If the check fails, install or update Node.js via nvm, fnm, or the official installer.

### pnpm Availability

Checks that pnpm is available in the PATH. ClawPilot uses pnpm as its package manager, bootstrapped via the `packageManager` field in `package.json` through corepack.

If the check fails, enable corepack: `corepack enable`.

### Service Status

Checks whether the dashboard system service is registered and running. Reports the service manager type (systemd, launchd, or PID file) and current state.

If the service is registered but not running, suggests restarting it.

### Database Integrity

Opens the SQLite registry database and verifies:
- The database file is readable
- The schema matches the expected version
- WAL (Write-Ahead Log) is not corrupted
- Required tables exist

If the check fails, the database may need repair or the installation may be incomplete.

### Instance Consistency

For each registered instance, verifies:
- Instances marked as running have a live process at the recorded PID
- Instances marked as stopped do not have orphan processes
- Instance workspace directories exist on disk

Inconsistencies indicate a crash or unclean shutdown. The doctor suggests corrective commands for each inconsistency found.

## Health API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None (public) | Basic health check |

The health endpoint requires no authentication and returns:

| Field | Description |
|-------|-------------|
| version | ClawPilot version string |
| uptime | Dashboard server uptime in seconds |
| databaseSize | SQLite database file size in bytes |

This endpoint is suitable for external monitoring tools, load balancers, and uptime checkers.

## When to Run Doctor

- After initial installation to verify setup
- After upgrading ClawPilot to a new version
- When instances fail to start or behave unexpectedly
- After system restarts to check service recovery
- As a first step in any troubleshooting workflow

## Troubleshooting

If doctor itself fails to run, ensure:
1. The `claw-pilot` binary is in PATH
2. `~/.claw-pilot/` directory exists (run `claw-pilot init` if not)
3. Node.js is available in the current shell

*ClawPilot v0.74.1*
