# Instance Lifecycle Management

How to start, stop, restart, and monitor ClawPilot instances, including state transitions, health checks, PID file management, and troubleshooting.

## Instance States

| State | Description |
|---|---|
| `running` | Daemon process is alive and responding |
| `stopped` | No process running, clean shutdown |
| `error` | Process exited unexpectedly or failed to start |
| `unknown` | State cannot be determined (e.g. stale PID file) |

Transitioning states (`starting`, `stopping`) are tracked in-memory by the dashboard and are not persisted to the database.

## Starting an Instance

**CLI:**
```bash
claw-pilot start <slug>
```

**Dashboard API:**
```
POST /api/instances/<slug>/start
```

**What happens:**
1. Dashboard reads instance config from `registry.db`
2. Spawns a `claw-runtime` daemon process with the instance configuration
3. Writes a PID file to `~/.claw-pilot/instances/<slug>/pid`
4. Polls the runtime until it reports ready (health endpoint responds)
5. Updates instance state to `running`

If the process fails to start or the health check times out, state moves to `error`.

## Stopping an Instance

**CLI:**
```bash
claw-pilot stop <slug>
```

**Dashboard API:**
```
POST /api/instances/<slug>/stop
```

**What happens:**
1. Reads PID from the PID file
2. Sends `SIGTERM` to the daemon process
3. Polls until the process exits (with timeout)
4. Removes the PID file
5. Updates instance state to `stopped`

If the process does not exit within the timeout, a `SIGKILL` may be sent as a fallback.

## Restarting an Instance

**CLI:**
```bash
claw-pilot restart <slug>
```

**Dashboard API:**
```
POST /api/instances/<slug>/restart
```

Restart is a sequential stop followed by start. The instance briefly passes through `stopped` state.

## Health Checking

The dashboard monitors instance health using PID file validation:

1. Read the PID from `~/.claw-pilot/instances/<slug>/pid`
2. Call `process.kill(pid, 0)` — this checks if the process exists without sending a signal
3. If the process exists, the instance is considered alive
4. If the process does not exist, the PID file is stale and the state is `unknown` or `error`

The dashboard also performs periodic health polling of running instances via their HTTP health endpoint.

## Viewing Instance Status

**Single instance:**
```bash
claw-pilot status <slug>
```

Shows: state, PID, port, uptime, agent count, model, last activity timestamp.

**All instances:**
```bash
claw-pilot list
```

Shows a table of all instances with their state, port, and agent count.

**Dashboard API:**
```
GET /api/instances              # list all
GET /api/instances/<slug>       # single instance detail
GET /api/instances/<slug>/health  # health check response
```

## PID File Management

| Path | Purpose |
|---|---|
| `~/.claw-pilot/instances/<slug>/pid` | Contains the daemon process ID |

The PID file is:
- **Created** when an instance starts successfully
- **Removed** when an instance stops cleanly
- **Stale** if the process crashed without cleanup

If a PID file exists but the process is dead, the dashboard detects this and marks the instance as `unknown`. You can safely start the instance again — the stale PID file is cleaned up automatically.

## State Transitions

```
stopped ──start──► starting ──ready──► running
running ──stop───► stopping ──exited─► stopped
running ──crash──► error
error   ──start──► starting ──ready──► running
unknown ──start──► starting ──ready──► running
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Instance stuck in `starting` | Port conflict or config error | Check logs, verify port is free |
| State shows `unknown` | Stale PID file after crash | Run `start` — stale PID is cleaned up |
| State shows `error` | Runtime process exited | Check instance logs in state directory |
| Cannot stop instance | Process unresponsive | Dashboard escalates to SIGKILL after timeout |
| Port already in use | Another process on that port | Change port in instance config or free the port |

## Logs

Instance runtime logs are stored in the state directory:
```
~/.claw-pilot/instances/<slug>/logs/
```

Use `claw-pilot logs <slug>` to tail the latest log output.

*ClawPilot v0.74.1*
