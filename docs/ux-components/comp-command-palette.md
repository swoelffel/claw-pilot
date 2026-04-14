# Component — Command Palette (`cp-command-palette`)

> **Source**: `ui/src/components/command-palette.ts`
> **Used in**: Global (`app.ts`) — triggered by Cmd+K / Ctrl+K

Global full-text search dialog. Searches across all entity types using FTS5 BM25 ranking.

## Mockup

```
┌─ Overlay (blur backdrop) ────────────────────────────────────┐
│                                                               │
│  ┌─ Palette (480px) ────────────────────────────────────────┐ │
│  │  🔍 [Search ClawPilot...                              ]  │ │
│  │                                                           │ │
│  │  INSTANCES                                                │ │
│  │    default — Multi-agent development cluster              │ │
│  │    staging — Staging environment                          │ │
│  │                                                           │ │
│  │  AGENTS                                                   │ │
│  │    pilot (default) — Primary chat agent                   │ │
│  │    analyst (default) — Data analysis agent                │ │
│  │                                                           │ │
│  │  TASKS                                                    │ │
│  │    Fix login timeout — in_progress                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Trigger

- **Keyboard**: `Cmd+K` (macOS) / `Ctrl+K` (other)
- **Escape**: Close palette

## Search

| Feature | Detail |
|---|---|
| **Engine** | FTS5 BM25 ranking via `GET /api/search?q=&limit=` |
| **Debounce** | 300ms after typing stops |
| **Entity types** | instance, agent, task, blueprint, agent_blueprint |
| **Max per group** | 5 results |
| **Group order** | Instances → Agents → Tasks → Blueprints → Templates |

## Result Card

Each result shows:
- **Title** — entity name or title
- **Subtitle** — context info (instance slug for agents, status for tasks)
- **Entity type badge** — colored group label

## Navigation

Clicking a result navigates to the entity:
- Instance → `#/instances/:slug/pilot`
- Agent → `#/instances/:slug/builder`
- Task → `#/instances/:slug/tasks`
- Blueprint → `#/blueprints/:id/builder`
- Agent template → `#/agent-templates/:id`

## Data Fetching

| Endpoint | Description |
|---|---|
| `GET /api/search?q=&limit=` | FTS5 search across all entity types |

## States

| State | Display |
|---|---|
| **Empty input** | Placeholder text, no results |
| **Loading** | Spinner in input |
| **Results** | Grouped result list |
| **No results** | "No results found" message |

## i18n

Group labels use `msg("...", { id: "search-group-*" })`.

---

*Since v0.67.0 (SEARCH-001)*
