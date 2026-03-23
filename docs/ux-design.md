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
| `--focus-ring` | `0 0 0 2px rgba(79,110,247,0.5)` | Focus outline |
| `--radius-sm` | `4px` | Badges, small elements |
| `--radius-md` | `8px` | Buttons, inputs |
| `--radius-lg` | `12px` | Cards, dialogs |

---

## Hash-based routing

Since v0.7.1, navigation uses hash URLs (`#/...`). Browser back/forward and page refresh work correctly.

| Hash URL | Rendered view | Component |
|---|---|---|
| `#/` or `#/instances` | Instances view (home) | `cp-cluster-view` |
| `#/instances/:slug/builder` | Agent builder | `cp-agents-builder` |
| `#/instances/:slug/settings` | Instance settings | `cp-instance-settings` |
| `#/instances/:slug/pilot` | Interactive chat + LLM context panel | `cp-runtime-pilot` |
| `#/instances/:slug/costs` | Cost analytics dashboard | `cp-costs-dashboard` |
| `#/instances/:slug/activity` | Event browser + filters | `cp-activity-console` |
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
| 1 | Instances | `cp-cluster-view` | `#/instances` | instance-card, create-dialog, delete-instance-dialog, discover-dialog | [screen-instances.md](ux-screens/screen-instances.md) |
| 2b | Instance Settings | `cp-instance-settings` | `#/instances/:slug/settings` | channels, mcp, permissions, config (inline) | [screen-instance-settings.md](ux-screens/screen-instance-settings.md) |
| 2c | Runtime Pilot | `cp-runtime-pilot` | `#/instances/:slug/pilot` | 18 sub-components (inline) | [screen-runtime-pilot.md](ux-screens/screen-runtime-pilot.md) |
| 2d | Cost Dashboard | `cp-costs-dashboard` | `#/instances/:slug/costs` | — (self-contained: summary cards, SVG chart, table, donut) | [screen-costs-dashboard.md](ux-screens/screen-costs-dashboard.md) |
| 2e | Activity Console | `cp-activity-console` | `#/instances/:slug/activity` | — (self-contained: filters, event table, detail panel) | [screen-activity-console.md](ux-screens/screen-activity-console.md) |
| 3 | Agent Builder | `cp-agents-builder` | `#/instances/:slug/builder` | agent-card-mini, agent-detail-panel, agent-links-svg | [screen-agent-builder.md](ux-screens/screen-agent-builder.md) |
| 4 | Blueprints | `cp-blueprints-view` | `#/blueprints` | blueprint-card | [screen-blueprints.md](ux-screens/screen-blueprints.md) |
| 5 | Blueprint Builder | `cp-blueprint-builder` | `#/blueprints/:id/builder` | agent-card-mini, agent-detail-panel, agent-links-svg | [screen-blueprint-builder.md](ux-screens/screen-blueprint-builder.md) |
| — | Agent Templates | `cp-agent-templates-view` | `#/agent-templates` | — | [screen-agent-templates.md](ux-screens/screen-agent-templates.md) |
| — | Agent Template Detail | `cp-agent-template-detail` | `#/agent-templates/:id` | agent-file-editor | [screen-agent-template-detail.md](ux-screens/screen-agent-template-detail.md) |
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
