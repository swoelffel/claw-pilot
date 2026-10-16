# Dashboard Service

Reviewed against Community 0.84.13. The dashboard serves the UI, REST, health WebSocket and SSE routes, normally on port 19000. Service supervision is separate from each instance's runtime process.

Use claw-pilot service status to inspect installed/active/enabled status, PID when available and port response. A successful port check is not authentication, stream or provider acceptance. Doctor and targeted service logs can help diagnose startup failure; minimize/redact logged data.

The supported service command group includes install, uninstall, restart and status. Install/uninstall/restart are mutations and may interrupt users. Identify the current executable, service manager, account, paths and approved target before applying them.

Linux and macOS use the applicable systemd/launchd integration. Managed installations may use system services/LaunchDaemons instead of user units/LaunchAgents. Do not copy a generic unit name, plist path, privilege level or restart command onto a customer installation. Container deployments follow their supervisor/entrypoint rather than a host-service assumption.

Generated services use the running CLI entrypoint. The service PATH must provide the supported Node runtime and dependencies; an interactive shell working is not proof the service environment is correct. Node 22.23.3 is the build reference; >=22.12.0 is the declared compatibility floor.

Consult [Managed updates](self-update.md) before an upgrade. Verify all previously active runtimes and the dashboard after an approved intervention; do not restart cp-system from its own conversational agent to bypass maintenance controls.
