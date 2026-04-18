# Dashboard Service

Run the ClawPilot dashboard as a persistent system service that starts automatically on boot. The dashboard service hosts the web UI, REST API, WebSocket health monitor, and SSE event streams.

## Service Management Commands

| Command | Description |
|---------|-------------|
| `claw-pilot service install` | Create and enable the system service |
| `claw-pilot service uninstall` | Stop and remove the system service |
| `claw-pilot service status` | Check whether the service is running |

## Service Manager Detection

The service manager is auto-detected based on the platform:

| Platform | Service Manager | Configuration File |
|----------|----------------|-------------------|
| Linux | systemd | `/etc/systemd/system/claw-pilot-dashboard.service` |
| macOS | launchd | `~/Library/LaunchAgents/io.claw-pilot.dashboard.plist` |
| Docker | PID file | PID file in `~/.claw-pilot/` |

The `install` command generates the appropriate configuration file for the detected platform and enables the service for auto-start.

## Dashboard Server

The dashboard HTTP server listens on port **19000** by default. It serves:

| Component | Protocol | Description |
|-----------|----------|-------------|
| Web UI | HTTP | Lit-based single-page application |
| REST API | HTTP | Instance management, agent configuration, search |
| Health monitor | WebSocket | Real-time instance health status |
| Event streams | SSE | Live event feeds for activity console |

## Installation

Running `claw-pilot service install` performs these steps:

1. Detects the platform service manager
2. Generates the service configuration with correct paths and environment variables
3. Registers the service for auto-start on boot
4. Starts the service immediately

After installation, the dashboard is accessible at `http://localhost:19000`.

## Uninstallation

Running `claw-pilot service uninstall` performs:

1. Stops the running service
2. Removes the service configuration file
3. Disables auto-start

Instance data and configuration are not affected by service uninstallation.

## Checking Status

`claw-pilot service status` reports whether the dashboard service is currently running, including the process ID and uptime when active.

## macOS (launchd)

On macOS, the service is managed as a user-level LaunchAgent. Manual control:

```
launchctl stop io.claw-pilot.dashboard
launchctl start io.claw-pilot.dashboard
```

The plist file configures `RunAtLoad` for auto-start and `KeepAlive` for automatic restart on crash.

## Linux (systemd)

On Linux, the service is managed as a systemd user or system unit. Manual control:

```
systemctl stop claw-pilot-dashboard
systemctl start claw-pilot-dashboard
systemctl status claw-pilot-dashboard
```

The unit file configures `Restart=always` for automatic restart on crash.

## Docker

In Docker environments, the service uses PID file-based process management. The PID file is stored in `~/.claw-pilot/` and used to track the dashboard process lifecycle.

## Troubleshooting

If the service fails to start:

1. Run `claw-pilot doctor` to check system prerequisites
2. Check service logs (`journalctl` on Linux, Console.app on macOS)
3. Verify port 19000 is not already in use
4. Ensure Node.js >= 22.12.0 is available in the service environment PATH

If the dashboard is unreachable after service install, verify the service is running with `claw-pilot service status` and check firewall rules.

*ClawPilot v0.74.1*
