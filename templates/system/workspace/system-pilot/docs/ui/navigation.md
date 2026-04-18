# Dashboard Navigation

The ClawPilot Dashboard is a hash-based single-page application built with Lit web components. All routing uses the URL hash fragment for client-side navigation without server round-trips.

## Route Map

### Global Routes

| Route | Screen | Description |
|-------|--------|-------------|
| `#/home` | Home Screen | Default landing page with system overview, recent activity, and quick actions |
| `#/instances` | Cluster View | Grid of all instances with status indicators, search, and bulk actions |
| `#/blueprints` | Blueprints Gallery | Browse and manage reusable instance blueprints |
| `#/blueprints/:id/builder` | Blueprint Builder | Visual editor for blueprint configuration and tool profiles |
| `#/agent-templates` | Agent Templates | Library of shareable agent templates with import/export |
| `#/agent-templates/:id` | Template Detail | View and edit a specific agent template |
| `#/profile` | User Profile Settings | Account settings, password change, theme preferences |

### Instance Routes

All instance routes are prefixed with `#/instances/:slug/` where `:slug` is the instance identifier.

| Route | Screen | Description |
|-------|--------|-------------|
| `#/instances/:slug/pilot` | Pilot Chat | Real-time conversation interface with tool call visualization |
| `#/instances/:slug/builder` | Agent Builder | Visual canvas for configuring agent tools, model, and behavior |
| `#/instances/:slug/settings` | Instance Settings | Instance configuration: model, named key, prompt mode, channels |
| `#/instances/:slug/costs` | Cost Dashboard | Token usage charts, cost breakdown by model and time period |
| `#/instances/:slug/activity` | Activity Console | Live event stream showing tool calls, messages, and system events |
| `#/instances/:slug/memory` | Memory Browser | Browse and edit workspace files (SOUL.md, docs/, memory/) |
| `#/instances/:slug/heartbeat` | Heartbeat Heatmap | Calendar heatmap of heartbeat check results over time |
| `#/instances/:slug/session-logs` | Session Logs | Searchable log viewer for all session messages and tool calls |
| `#/instances/:slug/tasks` | Task Board | Kanban board with backlog, in-progress, done, and blocked columns |
| `#/instances/:slug/flows` | Flow List | Manage flows assigned to this instance with run history |
| `#/instances/:slug/flows/runs/:runId` | Flow Run Detail | Step-by-step view of a flow execution with outcomes and timing |

## Command Palette

Press **Cmd+K** (macOS) or **Ctrl+K** (Windows/Linux) to open the global command palette.

The command palette provides **FTS5 full-text search** across:

- Instance names and slugs
- Agent display names
- Task titles and descriptions
- Blueprint names
- Agent template names

Search results are ranked by relevance with type-ahead suggestions. Selecting a result navigates directly to the corresponding screen.

## Navigation Components

### Top Navigation Bar

The top bar is present on all screens and contains:

- ClawPilot logo (links to `#/home`)
- Global navigation tabs: Home, Instances, Blueprints, Templates
- Command palette trigger (Cmd+K)
- User avatar with profile dropdown
- Language selector

### Instance Sidebar

When viewing an instance route, a sidebar appears with tabs for all instance-specific screens: Pilot, Builder, Settings, Costs, Activity, Memory, Heartbeat, Session Logs, Tasks, Flows.

### Breadcrumbs

Breadcrumb navigation is displayed below the top bar on nested routes, showing the path from root to current screen (e.g., Instances > my-agent > Pilot).

## Internationalization

The Dashboard supports 6 languages with full UI translation:

| Code | Language |
|------|----------|
| `en` | English |
| `fr` | French |
| `de` | German |
| `es` | Spanish |
| `it` | Italian |
| `pt` | Portuguese |

Language preference is stored per user in the profile settings and persisted in the `users` table. The default language is determined by the browser's `navigator.language` setting.

## Deep Linking

All routes are deep-linkable. Sharing a URL like `https://host:port/#/instances/my-agent/pilot` opens the Pilot chat for the `my-agent` instance directly. Authentication is required before the route is rendered.

## Responsive Layout

The Dashboard adapts to screen size:

- **Desktop** (>1024px): full sidebar + main content area
- **Tablet** (768-1024px): collapsible sidebar, touch-friendly controls
- **Mobile** (<768px): bottom navigation bar replaces sidebar, simplified layouts

*ClawPilot v0.74.1*
