# CLI Operations Reference

Reviewed against Community 0.84.13. Use the installed executable's --help for exact options; do not infer a command from an API path. Commands can read sensitive data or mutate the platform, so identify the target installation and authorization before invoking them.

| Entry point | Purpose |
|---|---|
| claw-pilot list / status <slug> | Inspect instances |
| claw-pilot doctor | Diagnose installation prerequisites and consistency |
| claw-pilot service status | Inspect the dashboard service |
| claw-pilot create | Interactive provisioning |
| claw-pilot start / stop / restart <slug> | Instance lifecycle operations |
| claw-pilot destroy <slug> | Destructive instance removal |
| claw-pilot service install / uninstall / restart | Dashboard service lifecycle; can interrupt users |
| claw-pilot runtime status <slug> | Inspect runtime state |
| claw-pilot runtime chat <slug> | Interactive chat; may call tools and incur provider cost |
| claw-pilot runtime config --help | Inspect supported configuration subcommands |
| claw-pilot update --check | Check release information without applying an update |

The runtime chat command supports selecting an agent/session and a single-message mode; inspect its help before use. Multiline terminal paste is handled as one input. Configured named credentials can be resolved for CLI chat; do not print keys or require the user to export a plaintext key as a diagnostic workaround.

A configuration export is not a full runtime/secret backup. Use [Managed updates](self-update.md) and [Dashboard service](dashboard-service.md) for maintenance boundaries. The updater may restart runtimes and the dashboard; do not present it as a harmless git pull. Managed production follows its owner's approved package/deployment procedure.

Platform-specific process-tree and service behavior must be qualified independently. Windows support fixes do not prove Unix shell cancellation or launchd/systemd procedures apply to Windows.
