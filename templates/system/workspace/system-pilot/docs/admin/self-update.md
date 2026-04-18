# Self-Update

Keep ClawPilot up to date with the latest version from GitHub. Self-update is available via the CLI and the dashboard UI.

## CLI Update

```
claw-pilot update
```

The update command performs three steps in sequence:

1. **git pull** -- Fetches and merges the latest code from the GitHub repository
2. **pnpm install** -- Installs any new or updated dependencies
3. **pnpm build** -- Rebuilds the TypeScript source and web UI

### pnpm Bootstrap

pnpm is bootstrapped via corepack, which reads the `packageManager` field from `package.json` to ensure the correct pnpm version is used. This guarantees consistent dependency resolution across environments.

## Rate Limiting

Self-update is rate limited to one update per 5 minutes. Repeated update requests within the cooldown window are rejected. This prevents accidental rapid-fire updates during automated workflows.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/self/update-status` | Check for available updates |
| POST | `/api/self/update` | Launch the update process |

### Update Status Response

The status endpoint returns:

| Field | Description |
|-------|-------------|
| currentVersion | Currently installed version |
| latestVersion | Latest version available on GitHub |
| updateAvailable | Boolean indicating if an update exists |
| lastChecked | Timestamp of last update check |
| lastUpdated | Timestamp of last successful update |

## Dashboard UI

The dashboard displays an update banner when a new version is detected. The banner shows the available version and provides a one-click update button.

Update progress is shown in real time. After the update completes, the dashboard prompts to restart the service for changes to take effect.

## Post-Update

After running an update, restart the dashboard service to load the new code:

```
claw-pilot service status    # verify service is managed
# Then restart:
claw-pilot restart <slug>    # restart individual instances
```

On macOS:
```
launchctl stop io.claw-pilot.dashboard && sleep 1 && launchctl start io.claw-pilot.dashboard
```

On Linux:
```
systemctl restart claw-pilot-dashboard
```

Instance runtimes should also be restarted to pick up any backend changes.

## Troubleshooting

If update fails during `git pull`:
- Check for uncommitted local changes that conflict with upstream
- Verify network connectivity to GitHub
- Ensure the repository remote is correctly configured

If update fails during `pnpm install`:
- Check that corepack is enabled (`corepack enable`)
- Verify disk space is available
- Clear the pnpm store if corrupted (`pnpm store prune`)

If update fails during `pnpm build`:
- Check build output for TypeScript compilation errors
- Ensure Node.js version meets the minimum requirement (>= 22.12.0)

*ClawPilot v0.74.1*
