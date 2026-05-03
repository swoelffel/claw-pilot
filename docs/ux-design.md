# UX Design — claw-pilot

Visual and behavioral reference for all screens and components of the application.
Serves as the foundation for interface evolution discussions.

> **Source components**: `ui/src/components/`
> **Routing**: `ui/src/services/router.ts`
> **Shared styles**: `ui/src/styles/tokens.ts` + `ui/src/styles/shared.ts`
> **Stack**: Lit web components, dark theme, CSS custom properties

> Individual screen docs live in [`ux-screens/`](ux-screens/) and component docs in [`ux-components/`](ux-components/).

---

## Global style tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0f1117` | Page background |
| `--bg-surface` | `#1a1d27` | Cards, panels, dialogs |
| `--bg-hover` | `#1e2130` | Hover on items |
| `--bg-border` | `#2a2d3a` | Borders |
| `--text-primary` | `#e2e8f0` | Headings, important values |
| `--text-secondary` | `#94a3b8` | Body text |
| `--text-muted` | `#64748b` | Labels, metadata |
| `--font-ui` | `Geist`, `-apple-system`, `sans-serif` | Primary font |
| `--font-mono` | `Geist Mono`, `monospace` | Technical values |
| `--accent` | `#4f6ef7` | Primary blue (CTA, selection) |
| `--accent-hover` | `#6b85f8` | Blue hover |
| `--accent-subtle` | `rgba(79,110,247,0.08)` | Light accent background |
| `--accent-border` | `rgba(79,110,247,0.25)` | Accent border |
| `--state-running` | `#10b981` | Running, success |
| `--state-stopped` | `#64748b` | Stopped |
| `--state-error` | `#ef4444` | Error, danger |
| `--state-warning` | `#f59e0b` | Amber — warning |
| `--state-info` | `#0ea5e9` | Cyan — info |
| `--archetype-planner` | `#8b5cf6` | Purple — strategic planner |
| `--archetype-generator` | `#10b981` | Green — productive generator |
| `--archetype-evaluator` | `#f59e0b` | Amber — quality evaluator |
| `--archetype-orchestrator` | `#4f6ef7` | Blue — coordination orchestrator |
| `--archetype-analyst` | `#0ea5e9` | Cyan — data analyst |
| `--archetype-communicator` | `#ec4899` | Pink — communicator |
| `--focus-ring` | `0 0 0 2px rgba(79,110,247,0.5)` | Focus outline |
| `--radius-sm` | `4px` | Badges, small elements |
| `--radius-md` | `8px` | Buttons, inputs |
| `--radius-lg` | `12px` | Cards, dialogs |

---

## Hash-based routing

Navigation uses hash URLs (`#/...`). Browser back/forward and page refresh work correctly. Routes are produced and parsed by `ui/src/services/router.ts` (`Route` discriminated union, `hashToRoute`, `routeToHash`).

| Hash URL | Route view | Component |
|---|---|---|
| `#/` (default) | `home` | `cp-home-screen` |
| `#/home` | `home` | `cp-home-screen` |
| `#/instances` | `cluster` | `cp-cluster-view` |
| `#/instances/:slug/dashboard` | `instance-dashboard` | `cp-instance-dashboard` |
| `#/instances/:slug/builder` | `agents-builder` | `cp-agents-builder` |
| `#/instances/:slug/settings` | `instance-settings` | `cp-instance-settings` |
| `#/instances/:slug/pilot` | `pilot` | `cp-runtime-pilot` |
| `#/instances/:slug/costs` | `costs` | `cp-costs-dashboard` |
| `#/instances/:slug/activity` | `activity` | `cp-activity-console` |
| `#/instances/:slug/memory` | `memory` | `cp-memory-browser` |
| `#/instances/:slug/heartbeat` | `heartbeat` | `cp-heartbeat-heatmap` |
| `#/instances/:slug/session-logs` | `session-logs` | `cp-session-logs` |
| `#/instances/:slug/tasks` | `tasks` | `cp-task-board` |
| `#/instances/:slug/triggers` | `triggers` | `cp-triggers-view` |
| `#/instances/:slug/flows` | `flows` | `cp-flow-list` |
| `#/instances/:slug/flows/:flowId/sessions` | `flow-sessions` | `cp-flow-sessions` |
| `#/instances/:slug/flows/runs/:runId` | `flow-run` | `cp-flow-run-detail` |
| `#/blueprints` | `blueprints` | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | `blueprint-builder` | `cp-blueprint-builder` |
| `#/agent-templates` | `agent-templates` | `cp-agent-templates-view` |
| `#/agent-templates/:id` | `agent-template-detail` | `cp-agent-template-detail` |
| `#/profile` | `profile` | `cp-profile-settings` |

Unknown hashes resolve to `home`. Navigation events emitted by children (`navigate { view, slug?, blueprintId?, templateId?, runId?, flowId?, section? }`) are captured by `app.ts`, which updates `_route`, and `_syncHashFromRoute` then writes the hash.

---

## Global navigation (`app.ts`)

Sticky header (`height: 56px`, `background: --bg-surface`).

```
+---------------------------------------------------------------------------------------+
|  ClawPilot   Home   Instances [2]   Blueprints [3]   Templates [5]                     |
|                                       [Search Ctrl+K] [Bell ●]  [User v]  [Live]  [Sign out] |
+---------------------------------------------------------------------------------------+
```

| Element | Description |
|---|---|
| **Logo** | "Claw**Pilot**" (accent span on "Pilot") — click → `home` route. |
| **Home tab** | Active when route is `home`. |
| **Instances tab** | Active for any route in the instance subtree (`cluster`, `agents-builder`, `instance-settings`, `instance-dashboard`, `pilot`, `costs`, `activity`, `memory`, `heartbeat`, `session-logs`, `tasks`, `flows`, `flow-run`). Numeric badge if `_instances.length > 0`. Note: `triggers` and `flow-sessions` do not currently mark this tab active — see "Notes" below. |
| **Blueprints tab** | Active for `blueprints` / `blueprint-builder`. Badge if `_blueprintCount > 0`. |
| **Templates tab** | Active for `agent-templates` / `agent-template-detail`. Badge if `_agentTemplateCount > 0`. |
| **Search button** | Opens `cp-command-palette` (also bound to ⌘/Ctrl+K). |
| **Notification bell** | `cp-notification-inbox` — bell icon with unread count, dropdown panel. |
| **Profile button** | SVG user icon + `_username`, transparent border default, accent border on hover, accent fill when route is `profile`. Click → `#/profile`. |
| **Live Stream Widget** | `cp-live-stream-widget` — status dot + "Live"/"Offline" + unread badge. Dropdown shows real-time SSE events. Hidden under 640px. |
| **Sign out** | Gray outline button, red hover. Calls `POST /api/auth/logout`, clears local token. |

Below the header, `cp-self-update-banner` renders inline when an update is available or in progress.

**Footer** (`min-height: 48px`, `background: --bg-surface`):

```
+---------------------------------------------------------------------+
|  ClawPilot  [vX.Y.Z]  ·  GitHub  ·  Issues       [Globe EN v]  ·  © year SWO — MIT License |
+---------------------------------------------------------------------+
```

| Element | Description |
|---|---|
| **ClawPilot** | Brand with accent span. |
| **Version badge** | `v${__APP_VERSION__}` — Vite `define` injects from `package.json`. Reads dynamically per build. |
| **GitHub / Issues** | External links to `swoelffel/claw-pilot`. |
| **Language selector** | Globe + locale label + chevron. Dropdown opens upward, shows all locales from `localization`. Outside-click closes. |
| **Copyright line** | `© ${currentYear} SWO — MIT License`. |

Persistent overlays rendered at the root regardless of route:

- `cp-permission-request-overlay` — when current route has a `slug`.
- `cp-bus-alerts` — instance-scoped runtime alerts.
- `cp-command-palette` — when `_commandPaletteOpen`.
- `cp-create-agent-dialog` — when a "Use template" flow is in progress.

---

## Screens

| # | Screen | Tag | Route | Doc |
|---|--------|-----|-------|-----|
| 0 | Login | `cp-login-view` | — (pre-auth) | [screen-login.md](ux-screens/screen-login.md) |
| — | Home | `cp-home-screen` | `#/home`, `#/` | [screen-home.md](ux-screens/screen-home.md) |
| 1 | Instances | `cp-cluster-view` | `#/instances` | [screen-instances.md](ux-screens/screen-instances.md) |
| 2a | Instance Dashboard | `cp-instance-dashboard` | `#/instances/:slug/dashboard` | — (see [comp-instance-dashboard.md](ux-components/comp-instance-dashboard.md)) |
| 2b | Instance Settings | `cp-instance-settings` | `#/instances/:slug/settings` | [screen-instance-settings.md](ux-screens/screen-instance-settings.md) |
| 2c | Runtime Pilot | `cp-runtime-pilot` | `#/instances/:slug/pilot` | [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md) |
| 2d | Cost Dashboard | `cp-costs-dashboard` | `#/instances/:slug/costs` | [screen-costs-dashboard.md](ux-screens/screen-costs-dashboard.md) |
| 2e | Activity Console | `cp-activity-console` | `#/instances/:slug/activity` | [screen-activity-console.md](ux-screens/screen-activity-console.md) |
| 2f | Triggers | `cp-triggers-view` | `#/instances/:slug/triggers` | [screen-triggers.md](ux-screens/screen-triggers.md) |
| — | Memory Browser | `cp-memory-browser` | `#/instances/:slug/memory` | [screen-memory-browser.md](ux-screens/screen-memory-browser.md) |
| — | Heartbeat Heatmap | `cp-heartbeat-heatmap` | `#/instances/:slug/heartbeat` | [screen-heartbeat-heatmap.md](ux-screens/screen-heartbeat-heatmap.md) |
| — | Session Logs | `cp-session-logs` | `#/instances/:slug/session-logs` | [screen-session-logs.md](ux-screens/screen-session-logs.md) |
| 3 | Agent Builder | `cp-agents-builder` | `#/instances/:slug/builder` | [screen-agent-builder.md](ux-screens/screen-agent-builder.md) |
| 4 | Blueprints | `cp-blueprints-view` | `#/blueprints` | [screen-blueprints.md](ux-screens/screen-blueprints.md) |
| 5 | Blueprint Builder | `cp-blueprint-builder` | `#/blueprints/:id/builder` | [screen-blueprint-builder.md](ux-screens/screen-blueprint-builder.md) |
| — | Agent Templates | `cp-agent-templates-view` | `#/agent-templates` | [screen-agent-templates.md](ux-screens/screen-agent-templates.md) |
| — | Agent Template Detail | `cp-agent-template-detail` | `#/agent-templates/:id` | [screen-agent-template-detail.md](ux-screens/screen-agent-template-detail.md) |
| — | Task Board | `cp-task-board` | `#/instances/:slug/tasks` | [screen-task-board.md](ux-screens/screen-task-board.md) |
| — | Flow List | `cp-flow-list` | `#/instances/:slug/flows` | [screen-flow-list.md](ux-screens/screen-flow-list.md) |
| — | Flow Sessions | `cp-flow-sessions` | `#/instances/:slug/flows/:flowId/sessions` | — (see [comp-flow-sessions.md](ux-components/comp-flow-sessions.md)) |
| — | Flow Run Detail | `cp-flow-run-detail` | `#/instances/:slug/flows/runs/:runId` | [screen-flow-run-detail.md](ux-screens/screen-flow-run-detail.md) |
| — | Profile Settings | `cp-profile-settings` | `#/profile` | [screen-profile-settings.md](ux-screens/screen-profile-settings.md) |

---

## Shared components

Top-level Lit elements under `ui/src/components/` that are not pages/dialogs.

| Component | Tag | Doc |
|-----------|-----|-----|
| Update Banner Base | `cp-update-banner-base` | [comp-update-banner-base.md](ux-components/comp-update-banner-base.md) |
| Self Update Banner | `cp-self-update-banner` | [comp-self-update-banner.md](ux-components/comp-self-update-banner.md) |
| Instance Card | `cp-instance-card` | [comp-instance-card.md](ux-components/comp-instance-card.md) |
| Instance Dashboard | `cp-instance-dashboard` | [comp-instance-dashboard.md](ux-components/comp-instance-dashboard.md) |
| Dashboard Pilot | `cp-dashboard-pilot` | [comp-dashboard-pilot.md](ux-components/comp-dashboard-pilot.md) |
| Blueprint Card | `cp-blueprint-card` | [comp-blueprint-card.md](ux-components/comp-blueprint-card.md) |
| Agent Card Mini | `cp-agent-card-mini` | [comp-agent-card-mini.md](ux-components/comp-agent-card-mini.md) |
| Agent Detail Panel | `cp-agent-detail-panel` | [comp-agent-detail-panel.md](ux-components/comp-agent-detail-panel.md) |
| Agent Links SVG | `cp-agent-links-svg` | [comp-agent-links-svg.md](ux-components/comp-agent-links-svg.md) |
| Agent File Editor | `cp-agent-file-editor` | [comp-agent-file-editor.md](ux-components/comp-agent-file-editor.md) |
| Agent File Tree | `cp-agent-file-tree` | [comp-agent-file-tree.md](ux-components/comp-agent-file-tree.md) |
| Instance Shared Files | `cp-instance-shared-files` | [comp-instance-shared-files.md](ux-components/comp-instance-shared-files.md) |
| Session Tree | `cp-session-tree` | [comp-session-tree.md](ux-components/comp-session-tree.md) |
| Live Stream Widget | `cp-live-stream-widget` | [comp-live-stream-widget.md](ux-components/comp-live-stream-widget.md) |
| Notification Inbox | `cp-notification-inbox` | [comp-notification-inbox.md](ux-components/comp-notification-inbox.md) |
| Permission Overlay | `cp-permission-request-overlay` | [comp-permission-overlay.md](ux-components/comp-permission-overlay.md) |
| Bus Alerts | `cp-bus-alerts` | [comp-bus-alerts.md](ux-components/comp-bus-alerts.md) |
| Canvas Legend | `cp-canvas-legend` | [comp-canvas-legend.md](ux-components/comp-canvas-legend.md) |
| Budget Alert Banner | `cp-budget-alert-banner` | [comp-budget-alert-banner.md](ux-components/comp-budget-alert-banner.md) |
| Budget Settings | `cp-budget-settings` | [comp-budget-settings.md](ux-components/comp-budget-settings.md) |
| Named Keys Panel | `cp-named-keys-panel` | [comp-named-keys-panel.md](ux-components/comp-named-keys-panel.md) |
| Home Chat | `cp-home-chat` | [comp-home-chat.md](ux-components/comp-home-chat.md) |
| Home Wizard | `cp-home-wizard` | [comp-home-wizard.md](ux-components/comp-home-wizard.md) |
| Command Palette | `cp-command-palette` | [comp-command-palette.md](ux-components/comp-command-palette.md) |
| Start CTA | `cp-start-cta` | [start-cta.md](ux-components/start-cta.md) |
| Task Card | `cp-task-card` | [comp-task-card.md](ux-components/comp-task-card.md) |
| Task Detail | `cp-task-detail` | [comp-task-detail.md](ux-components/comp-task-detail.md) |
| Epic Tree | `cp-epic-tree` | [comp-epic-tree.md](ux-components/comp-epic-tree.md) |
| Flow Editor | `cp-flow-editor` | [comp-flow-editor.md](ux-components/comp-flow-editor.md) |
| Flow Sessions | `cp-flow-sessions` | [comp-flow-sessions.md](ux-components/comp-flow-sessions.md) |
| Triggers View | `cp-triggers-view` | [comp-triggers-view.md](ux-components/comp-triggers-view.md) |
| Trigger List | `cp-trigger-list` | [comp-trigger-list.md](ux-components/comp-trigger-list.md) |
| Trigger Wizard | `cp-trigger-wizard` | [comp-trigger-wizard.md](ux-components/comp-trigger-wizard.md) |
| Trigger Detail | `cp-trigger-detail` | [comp-trigger-detail.md](ux-components/comp-trigger-detail.md) |
| Input Mapping Editor | `cp-input-mapping-editor` | [comp-input-mapping-editor.md](ux-components/comp-input-mapping-editor.md) |
| Pilot Header | `cp-pilot-header` | (see [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md)) |
| Pilot Filter Bar | `cp-pilot-filter-bar` | (see [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md)) |
| Pilot Input | `cp-pilot-input` | (see [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md)) |
| Pilot Messages | `cp-pilot-messages` | (see [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md)) |
| Pilot Message | `cp-pilot-message` | (see [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md)) |
| Pilot Context Panel | `cp-pilot-context-panel` | (see [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md)) |
| Pilot Part: Reasoning | `cp-pilot-part-reasoning` | [comp-pilot-part-reasoning.md](ux-components/comp-pilot-part-reasoning.md) |
| Pilot Part: Delegation Expand | `cp-pilot-part-delegation-expand` | [comp-pilot-part-delegation-expand.md](ux-components/comp-pilot-part-delegation-expand.md) |
| Pilot Part: Artifact | `cp-pilot-part-artifact` | [comp-pilot-part-artifact.md](ux-components/comp-pilot-part-artifact.md) |
| Pilot Part: Suggestion | `cp-pilot-part-suggestion` | [comp-pilot-part-suggestion.md](ux-components/comp-pilot-part-suggestion.md) |
| Pilot Part: Image | `cp-pilot-part-image` | [comp-pilot-part-image.md](ux-components/comp-pilot-part-image.md) |
| Pilot Part: Question | `cp-pilot-part-question` | [comp-pilot-part-question.md](ux-components/comp-pilot-part-question.md) |

---

## Dialogs

| Dialog | Tag | Triggered from | Doc |
|--------|-----|----------------|-----|
| New Instance | `cp-create-dialog` | Instances view | [dialog-create-instance.md](ux-components/dialog-create-instance.md) |
| New Agent | `cp-create-agent-dialog` | Agent Builder + Template "Use" | [dialog-create-agent.md](ux-components/dialog-create-agent.md) |
| Delete Agent | `cp-delete-agent-dialog` | Agent Builder | [dialog-delete-agent.md](ux-components/dialog-delete-agent.md) |
| Delete Instance | `cp-delete-instance-dialog` | Instances view | [dialog-delete-instance.md](ux-components/dialog-delete-instance.md) |
| Team Import | `cp-import-team-dialog` | Agent / Blueprint Builder | [dialog-import-team.md](ux-components/dialog-import-team.md) |
| Instance Discovery | `cp-discover-dialog` | Instances view (empty) | [dialog-discover.md](ux-components/dialog-discover.md) |
| New Blueprint | `cp-create-blueprint-dialog` | Blueprints view | [dialog-create-blueprint.md](ux-components/dialog-create-blueprint.md) |
| New Agent Template | `cp-create-agent-template-dialog` | Agent Templates view | [dialog-create-agent-template.md](ux-components/dialog-create-agent-template.md) |
| Workspace File Dialogs | `cp-new-file-dialog`, `cp-delete-file-dialog` (in `workspace-file-dialogs.ts`) | Agent Detail Panel (Files tab), Instance Shared Files | — |
| Accessibility | — | All dialogs | [dialog-accessibility.md](ux-components/dialog-accessibility.md) |

---

## Update history

*Updated: 2026-03-16 - v0.28.5: Instance Card redesign, expanded Settings sidebar (7 panels), added cp-instance-channels, cp-instance-mcp, cp-instance-permissions, cp-instance-config, cp-permission-request-overlay, cp-bus-alerts*

*Updated: 2026-03-17 - v0.37.0: replaced cp-runtime-chat with cp-runtime-pilot (17 components)*

*Updated: 2026-03-18 - v0.41.24: complete documentation of cp-runtime-pilot (17 components)*

*Updated: 2026-03-19 - v0.41.39: added Agent Templates section (cp-agent-templates-view, cp-agent-template-detail, cp-create-agent-template-dialog)*

*Updated: 2026-03-20 - doc cleanup: cp-runtime-chat marked deprecated*

*Updated: 2026-03-21 - restructuration: éclatement en ux-screens/ (9 fichiers) et ux-components/ (20 fichiers), suppression des sections deprecated*

*Updated: 2026-03-21 - v0.44.0: added Profile Settings screen (cp-profile-settings), 👤 button in header, #/profile route*

*Updated: 2026-03-22 - v0.45.0: added Cost Dashboard (cp-costs-dashboard, #/instances/:slug/costs), Activity Console (cp-activity-console, #/instances/:slug/activity), Live Stream Widget (cp-live-stream-widget replacing static WS indicator)*

*Updated: 2026-03-26 - v0.51.0: Runtime Pilot expanded to 22 components. Added 4 part components: cp-pilot-part-artifact (rich card for create_artifact tool), cp-pilot-part-suggestion (follow-up chips), cp-pilot-part-image (image viewer), cp-pilot-part-question (interactive question). Input enhanced with file upload (📎 button + drag & drop), Send/Stop toggle (streaming abort). Suggestions generated via post-middleware + SuggestionsGenerated SSE event. Artifacts delivered as Telegram documents, suggestions as inline keyboard buttons.*

*Updated: 2026-03-28 - Builder UX harness design overhaul. Agent cards: archetype color stripe (6 colors), persistence-based backgrounds (permanent=surface, ephemeral=base, default=accent), inline @archetype spawn capsules (row 4), fixed card dimensions (186×80px). SVG links: spawn=dotted with arrow, A2A messaging=dashed without arrow (bidirectional merged), ray-rectangle clipping to card edges. Canvas legend (cp-canvas-legend, collapsible). Multi-select: rubber-band rectangle selection, group drag with position persistence. Persistence guard in task.ts: permanent agents cannot be spawned. 6 archetype CSS tokens added.*

*Updated: 2026-04-03 - BUDGET-001: Budget enforcement (auto-pause). Cost Dashboard now has Analytics/Budgets tabs. New components: cp-budget-settings (budget CRUD, progress bars, event log, create/edit dialog), cp-budget-alert-banner (warning/exceeded banners on all instance pages with override button). Backend: rt_budgets + rt_budget_events tables, pre/post-LLM budget checks, heartbeat budget blocking, monthly reset, reconciliation, Telegram notifications.*

*Updated: 2026-04-13 - v0.70.0: Home screen with cp-home-chat (lean chat for cp-system) and cp-home-wizard (setup form). Question tool UX overhaul with tabs and chat lockout.*

*Updated: 2026-04-13 - v0.71.0: Live reasoning streaming (collapsible "Thinking..." card), 5-phase status indicator (sending/thinking/using tool/responding/idle), delegation drill-down (clickable traces expand nested sub-sessions).*

*Updated: 2026-04-14 - v0.72.6: SSE bridge (daemon/dashboard real-time sync), setup wizard replaced with form, system-tools plugin (DB-direct, 22 cp_* tools), zero complexity baseline. New routes: #/home, #/.../memory, #/.../heartbeat, #/.../session-logs, #/.../flows, #/.../flows/runs/:runId. New components: cp-home-chat, cp-home-wizard, cp-command-palette, cp-epic-tree, cp-flow-editor, cp-flow-list, cp-flow-run-detail, cp-pilot-part-reasoning, cp-pilot-part-delegation-expand. Total: 86 components, 18 routes.*

*Updated: 2026-04-16 - v0.73.5: Workspace file manager (Files tab in agent detail panel) — cp-agent-file-tree (collapsible tree, per-dir create, per-file delete), cp-new-file-dialog, cp-delete-file-dialog. Backend: wildcard file routes (GET/PUT/DELETE /agents/:id/files/*), path validation, agent_files_fts FTS5 index. Flow improvements: outcome-driven control flow (continueOnFailure flag), structured complete_step tool, configurable maxSteps per step (default 50) with dynamic extension. workspace-knowledge plugin (ws_list_files, ws_search_files). Tool call repair + Anthropic prompt caching. Total: 89 components, 18 routes.*

*Updated: 2026-05-03 - v0.81.2: doc refresh against current code. Drift audit since v0.73.5: added Triggers screen (`cp-triggers-view` + `cp-trigger-list` / `cp-trigger-wizard` / `cp-trigger-detail` / `cp-input-mapping-editor`, route `#/instances/:slug/triggers`, instance-card menu entry), added Flow Sessions route (`#/instances/:slug/flows/:flowId/sessions`), added per-instance Dashboard widget tiles (`cp-instance-dashboard` with embedded `cp-dashboard-pilot`, "Triggers →" link), added Notification Inbox (`cp-notification-inbox` bell in header), added Instance Shared Files panel (`cp-instance-shared-files`, sidebar entry "Shared files") + Skills panel (`cp-instance-skills`). Runtime Pilot refactored from monolith to `pilot/` subfolder (`pilot-header`, `pilot-filter-bar`, `pilot-input`, `pilot-messages`, `pilot-message`, `pilot-context-panel`, `timeline-utils`) with `pilot/parts/` (11 part renderers including `part-text`, `part-tool`, `part-file`, `part-subtask`, `part-compaction`) and `pilot/context/` (6 context tabs). Workspace file dialogs consolidated into `workspace-file-dialogs.ts`. Routes/screens/components/dialogs tables refreshed to current state.*
