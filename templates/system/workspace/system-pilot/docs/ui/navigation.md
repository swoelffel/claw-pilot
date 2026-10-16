# Dashboard Navigation

Reviewed against Community 0.84.13. The dashboard uses pathname routing and browser history. Old hash bookmarks have a compatibility path, but new links should use these paths.

| Path | Purpose |
|---|---|
| / | Home / cp-system chat when available to the user |
| /instances | Visible instances |
| /blueprints | Team blueprints |
| /blueprints/:id/builder | Blueprint editor |
| /agent-templates | Agent template catalog |
| /agent-templates/:id | Agent template detail |
| /profile | User profile and installed profile extensions |
| /instances/:slug/pilot | Instance chat |
| /instances/:slug/builder | Agent builder |
| /instances/:slug/settings | Instance settings, including Skills and MCP sections |
| /instances/:slug/costs | Cost analytics |
| /instances/:slug/activity | Event activity |
| /instances/:slug/memory | Workspace files |
| /instances/:slug/heartbeat | Heartbeat history |
| /instances/:slug/session-logs | Session logs |
| /instances/:slug/tasks | Task board |
| /instances/:slug/requests | Durable request history |
| /instances/:slug/flows | Flow definitions and runs |
| /instances/:slug/flows/runs/:runId | Flow run detail |
| /instances/:slug/triggers | Cron and incoming webhooks |

Extension views use /ext/<extension-id>/... when registered by the installed edition. They are not guaranteed on every installation. Profile/admin navigation and instance visibility depend on actual permissions; a hidden or denied screen is not an empty resource list.

Cmd+K / Ctrl+K opens the command palette. Use real instance/resource identifiers from query tools or the authorized UI; do not invent routes or IDs. A working deep link or loaded page is not proof its live stream is healthy.
