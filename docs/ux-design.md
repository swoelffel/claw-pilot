# UX Design — claw-pilot

Visual and behavioral reference for all screens and components of the application.
Serves as the foundation for interface evolution discussions.

> **Source components**: `ui/src/components/`
> **Shared styles**: `ui/src/styles/tokens.ts` + `ui/src/styles/shared.ts`
> **Stack**: Lit web components, dark theme, CSS custom properties
> **Reference screenshots**: `screen1.png` (Agent Builder), `screen2.png` (Instances View)

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

Since v0.7.1, navigation uses hash URLs (`#/...`). Browser back/forward and page refresh work correctly.

| Hash URL | Rendered view | Component |
|---|---|---|
| `#/home` | Home screen (default) | `cp-home-screen` |
| `#/` or `#/instances` | Instances view | `cp-cluster-view` |
| `#/instances/:slug/dashboard` | Instance dashboard (synthetic overview) | `cp-instance-dashboard` |
| `#/instances/:slug/builder` | Agent builder | `cp-agents-builder` |
| `#/instances/:slug/settings` | Instance settings | `cp-instance-settings` |
| `#/instances/:slug/pilot` | Interactive chat + LLM context panel | `cp-runtime-pilot` |
| `#/instances/:slug/costs` | Cost analytics dashboard | `cp-costs-dashboard` |
| `#/instances/:slug/activity` | Event browser + filters | `cp-activity-console` |
| `#/instances/:slug/memory` | Memory file browser + search | `cp-memory-browser` |
| `#/instances/:slug/heartbeat` | Heartbeat heatmap visualization | `cp-heartbeat-heatmap` |
| `#/instances/:slug/session-logs` | Session log viewer | `cp-session-logs` |
| `#/instances/:slug/tasks` | Task board (Kanban) | `cp-task-board` |
| `#/instances/:slug/flows` | Workflow editor + run history | `cp-flow-list` |
| `#/instances/:slug/flows/runs/:runId` | Flow execution detail | `cp-flow-run-detail` |
| `#/blueprints` | Blueprints view | `cp-blueprints-view` |
| `#/blueprints/:id/builder` | Blueprint builder | `cp-blueprint-builder` |
| `#/agent-templates` | Agent templates (reusable agent blueprints) | `cp-agent-templates-view` |
| `#/agent-templates/:id` | Agent template detail + file editing | `cp-agent-template-detail` |
| `#/profile` | User profile settings | `cp-profile-settings` |

Navigation between views emits `navigate { view, slug?, blueprintId?, templateId? }` events captured by `app.ts`, which updates the hash URL and renders the corresponding component.

---

## Global navigation (`app.ts`)

Fixed navigation bar at top of page (`height: 56px`, `background: --bg-surface`).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ClawPilot   Instances [2]   Blueprints [3]   Templates [5]   👤  ● Live [3]  [Sign out]│
└──────────────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **Logo** | "Claw**Pilot**" (accent span on "Pilot") — click → Instances view |
| **Instances** | Active tab if cluster view, agents-builder, or instance-settings. Numeric badge if `instanceCount > 0`. |
| **Blueprints** | Active tab if blueprints or blueprint-builder view. Numeric badge if `blueprintCount !== null && blueprintCount > 0`. |
| **Templates** | Active tab if agent-templates or agent-template-detail view. Numeric badge if `agentTemplateCount !== null && agentTemplateCount > 0`. Links to `#/agent-templates`. |
| **Profile** | 👤 emoji button, transparent border default, accent border on hover, accent fill when `#/profile` is active. Click → `#/profile`. |
| **Live Stream** | `cp-live-stream-widget` — button with status dot + "Live"/"Offline" label + unread badge. Click opens dropdown panel with real-time SSE events (see [comp-live-stream-widget.md](ux-components/comp-live-stream-widget.md)). |
| **Sign out** | Gray outline button, red hover (`--state-error`). Calls `POST /api/auth/logout` then resets local state. |

**Footer** (`height: 48px`, `background: --bg-surface`):

```
┌─────────────────────────────────────────────────────────────────┐
│  ClawPilot  [v0.41.24]  ·  GitHub  ·  Issues    🌐 EN ▾  ·  © 2026 SWO — MIT License │
└─────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---|---|
| **ClawPilot** | Brand with accent span, `font-weight: 600` |
| **[vX.Y.Z]** | Accent monospace version badge (`--accent-subtle`, `--accent-border`) |
| **GitHub** | Link `https://github.com/swoelffel/claw-pilot`, `target="_blank"` |
| **Issues** | Link `https://github.com/swoelffel/claw-pilot/issues`, `target="_blank"` |
| **Language selector** | Button `🌐 XX ▾` — opens dropdown above with 6 available languages. Outside click closes dropdown. |
| **© year SWO** | Muted text with "MIT License" |

---

## Screens

| # | Screen | Tag | Route | Components used | Doc |
|---|--------|-----|-------|-----------------|-----|
| 0 | Login | `cp-login-view` | — (pre-auth) | — | [screen-login.md](ux-screens/screen-login.md) |
| — | Home Screen | `cp-home-screen` | `#/home` | cp-home-wizard, cp-home-chat | [screen-home.md](ux-screens/screen-home.md) |
| 1 | Instances | `cp-cluster-view` | `#/instances` | instance-card, create-dialog, delete-instance-dialog, discover-dialog | [screen-instances.md](ux-screens/screen-instances.md) |
| 2a | Instance Dashboard | `cp-instance-dashboard` | `#/instances/:slug/dashboard` | — (self-contained) | [screen-instance-dashboard.md](ux-screens/screen-instance-dashboard.md) |
| 2b | Instance Settings | `cp-instance-settings` | `#/instances/:slug/settings` | channels, mcp, permissions, config, skills (inline) | [screen-instance-settings.md](ux-screens/screen-instance-settings.md) |
| 2c | Runtime Pilot | `cp-runtime-pilot` | `#/instances/:slug/pilot` | 22+ sub-components (inline) | [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md) |
| 2d | Cost Dashboard | `cp-costs-dashboard` | `#/instances/:slug/costs` | cp-budget-settings, cp-budget-alert-banner | [screen-costs-dashboard.md](ux-screens/screen-costs-dashboard.md) |
| 2e | Activity Console | `cp-activity-console` | `#/instances/:slug/activity` | — (self-contained) | [screen-activity-console.md](ux-screens/screen-activity-console.md) |
| — | Memory Browser | `cp-memory-browser` | `#/instances/:slug/memory` | — | [screen-memory-browser.md](ux-screens/screen-memory-browser.md) |
| — | Heartbeat Heatmap | `cp-heartbeat-heatmap` | `#/instances/:slug/heartbeat` | — | [screen-heartbeat-heatmap.md](ux-screens/screen-heartbeat-heatmap.md) |
| — | Session Logs | `cp-session-logs` | `#/instances/:slug/session-logs` | session-tree | [screen-session-logs.md](ux-screens/screen-session-logs.md) |
| 3 | Agent Builder | `cp-agents-builder` | `#/instances/:slug/builder` | agent-card-mini, agent-detail-panel, agent-links-svg | [screen-agent-builder.md](ux-screens/screen-agent-builder.md) |
| 4 | Blueprints | `cp-blueprints-view` | `#/blueprints` | blueprint-card | [screen-blueprints.md](ux-screens/screen-blueprints.md) |
| 5 | Blueprint Builder | `cp-blueprint-builder` | `#/blueprints/:id/builder` | agent-card-mini, agent-detail-panel, agent-links-svg | [screen-blueprint-builder.md](ux-screens/screen-blueprint-builder.md) |
| — | Agent Templates | `cp-agent-templates-view` | `#/agent-templates` | — | [screen-agent-templates.md](ux-screens/screen-agent-templates.md) |
| — | Agent Template Detail | `cp-agent-template-detail` | `#/agent-templates/:id` | agent-file-editor | [screen-agent-template-detail.md](ux-screens/screen-agent-template-detail.md) |
| — | Task Board | `cp-task-board` | `#/instances/:slug/tasks` | task-card, task-detail, epic-tree | [screen-task-board.md](ux-screens/screen-task-board.md) |
| — | Flow List | `cp-flow-list` | `#/instances/:slug/flows` | flow-editor | [screen-flow-list.md](ux-screens/screen-flow-list.md) |
| — | Flow Run Detail | `cp-flow-run-detail` | `#/instances/:slug/flows/runs/:runId` | — | [screen-flow-run-detail.md](ux-screens/screen-flow-run-detail.md) |
| — | Profile Settings | `cp-profile-settings` | `#/profile` | — (standalone) | [screen-profile-settings.md](ux-screens/screen-profile-settings.md) |

---

## Shared components

| Component | Tag | Doc |
|-----------|-----|-----|
| Update Banner Base | `cp-update-banner-base` | [comp-update-banner-base.md](ux-components/comp-update-banner-base.md) |
| Self Update Banner | `cp-self-update-banner` | [comp-self-update-banner.md](ux-components/comp-self-update-banner.md) |
| Instance Card | `cp-instance-card` | [comp-instance-card.md](ux-components/comp-instance-card.md) |
| Blueprint Card | `cp-blueprint-card` | [comp-blueprint-card.md](ux-components/comp-blueprint-card.md) |
| Agent Card Mini | `cp-agent-card-mini` | [comp-agent-card-mini.md](ux-components/comp-agent-card-mini.md) |
| Agent Detail Panel | `cp-agent-detail-panel` | [comp-agent-detail-panel.md](ux-components/comp-agent-detail-panel.md) |
| Agent Links SVG | `cp-agent-links-svg` | [comp-agent-links-svg.md](ux-components/comp-agent-links-svg.md) |
| Agent File Editor | `cp-agent-file-editor` | [comp-agent-file-editor.md](ux-components/comp-agent-file-editor.md) |
| Session Tree | `cp-session-tree` | [comp-session-tree.md](ux-components/comp-session-tree.md) |
| Live Stream Widget | `cp-live-stream-widget` | [comp-live-stream-widget.md](ux-components/comp-live-stream-widget.md) |
| Permission Overlay | `cp-permission-request-overlay` | [comp-permission-overlay.md](ux-components/comp-permission-overlay.md) |
| Bus Alerts | `cp-bus-alerts` | [comp-bus-alerts.md](ux-components/comp-bus-alerts.md) |
| Canvas Legend | `cp-canvas-legend` | [comp-canvas-legend.md](ux-components/comp-canvas-legend.md) |
| Budget Alert Banner | `cp-budget-alert-banner` | [comp-budget-alert-banner.md](ux-components/comp-budget-alert-banner.md) |
| Budget Settings | `cp-budget-settings` | [comp-budget-settings.md](ux-components/comp-budget-settings.md) |
| Named Keys Panel | `cp-named-keys-panel` | [comp-named-keys-panel.md](ux-components/comp-named-keys-panel.md) |
| Home Chat | `cp-home-chat` | [comp-home-chat.md](ux-components/comp-home-chat.md) |
| Home Wizard | `cp-home-wizard` | [comp-home-wizard.md](ux-components/comp-home-wizard.md) |
| Command Palette | `cp-command-palette` | [comp-command-palette.md](ux-components/comp-command-palette.md) |
| Task Card | `cp-task-card` | [comp-task-card.md](ux-components/comp-task-card.md) |
| Task Detail | `cp-task-detail` | [comp-task-detail.md](ux-components/comp-task-detail.md) |
| Epic Tree | `cp-epic-tree` | [comp-epic-tree.md](ux-components/comp-epic-tree.md) |
| Flow Editor | `cp-flow-editor` | [comp-flow-editor.md](ux-components/comp-flow-editor.md) |
| Pilot Part: Reasoning | `cp-pilot-part-reasoning` | [comp-pilot-part-reasoning.md](ux-components/comp-pilot-part-reasoning.md) |
| Pilot Part: Delegation Expand | `cp-pilot-part-delegation-expand` | [comp-pilot-part-delegation-expand.md](ux-components/comp-pilot-part-delegation-expand.md) |
| Agent File Tree | `cp-agent-file-tree` | [comp-agent-file-tree.md](ux-components/comp-agent-file-tree.md) |

---

## Dialogs

| Dialog | Tag | Triggered from | Doc |
|--------|-----|----------------|-----|
| New Instance | `cp-create-dialog` | Instances view | [dialog-create-instance.md](ux-components/dialog-create-instance.md) |
| New Agent | `cp-create-agent-dialog` | Agent Builder | [dialog-create-agent.md](ux-components/dialog-create-agent.md) |
| Delete Agent | `cp-delete-agent-dialog` | Agent Builder | [dialog-delete-agent.md](ux-components/dialog-delete-agent.md) |
| Delete Instance | `cp-delete-instance-dialog` | Instances view | [dialog-delete-instance.md](ux-components/dialog-delete-instance.md) |
| Team Import | `cp-import-team-dialog` | Agent/Blueprint Builder | [dialog-import-team.md](ux-components/dialog-import-team.md) |
| Instance Discovery | `cp-discover-dialog` | Instances view (empty) | [dialog-discover.md](ux-components/dialog-discover.md) |
| New Blueprint | `cp-create-blueprint-dialog` | Blueprints view | [dialog-create-blueprint.md](ux-components/dialog-create-blueprint.md) |
| New Agent Template | `cp-create-agent-template-dialog` | Agent Templates view | [dialog-create-agent-template.md](ux-components/dialog-create-agent-template.md) |
| New Workspace File | `cp-new-file-dialog` | Agent Detail Panel (Files tab) | — |
| Delete Workspace File | `cp-delete-file-dialog` | Agent Detail Panel (Files tab) | — |
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
