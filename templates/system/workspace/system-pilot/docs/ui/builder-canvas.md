# Agent Builder Canvas

The Agent Builder is a visual editor for configuring agents within an instance or blueprint. It provides a 2D canvas where agents are displayed as draggable cards and spawn links are drawn as SVG arrows between them.

## Routes

| Route | Context |
|---|---|
| `#/instances/:slug/builder` | Instance agent builder — edit agents in a running or stopped instance |
| `#/blueprints/:id/builder` | Blueprint builder — edit agents in a reusable team template |

Both routes render the same canvas component (`cp-builder-canvas`) with the same features.

## Canvas Features

### Agent Cards

Each agent is displayed as a card on the canvas showing:

| Field | Description |
|---|---|
| Name | Agent display name |
| Model | Assigned LLM model (e.g., claude-sonnet-4-20250514) |
| Role | Agent archetype or custom role label |
| Tool count | Number of tools available from the agent's tool profile |
| Status indicator | Running/stopped badge (instance builder only) |

Cards are freely draggable on the 2D canvas. Position is persisted in the `agents.position` field (JSON with x/y coordinates). Card placement is restored when the builder is reopened.

### Spawn Links

Spawn links define which agents can spawn or delegate to other agents. Links are visualized as directional SVG arrows from source agent to target agent.

| Action | How |
|---|---|
| Create link | Click the output port on a source agent card, drag to the input port on a target agent card |
| Delete link | Click the link arrow, then press Delete or click the remove button |
| View link type | Hover over the arrow to see the link type (a2a or spawn) |

Links are stored in the `agent_links` table with `source_agent_id`, `target_agent_id`, and `link_type`.

### Create Agent

Click the **+** button on the canvas to open the agent creation dialog.

| Dialog Field | Description |
|---|---|
| Agent ID | Unique identifier within the instance (kebab-case) |
| Agent name | Human-readable display name |
| Model | LLM model selection (filtered by available providers) |
| Tool profile | Select from: minimal, messaging, coding, full, pilot |
| Archetype | Optional preset: coder, researcher, orchestrator, reviewer |

The new agent card appears on the canvas at the click position.

### Delete Agent

Select an agent card and press Delete, or right-click and choose "Delete agent" from the context menu. A confirmation dialog prevents accidental deletion. Deleting an agent also removes all its spawn links and workspace files.

## Agent Detail Panel

Click an agent card to open the detail side panel. The panel contains:

| Tab | Content |
|---|---|
| Config | Model, tool profile, archetype, prompt mode, persistence mode |
| Workspace | File tree viewer and editor (SOUL.md, AGENTS.md, docs/, skills/) |
| Skills | List of available skills from the workspace with enable/disable toggles |
| Links | Inbound and outbound spawn links for this agent |

Editing configuration fields in the detail panel updates the agent record in real time.

## Blueprint Builder

The blueprint builder (`#/blueprints/:id/builder`) uses the same canvas component. Differences from the instance builder:

| Aspect | Instance Builder | Blueprint Builder |
|---|---|---|
| Agent state | Shows running/stopped status | No runtime status (template only) |
| Live testing | Can open pilot chat from card | No pilot access |
| Deploy action | N/A | "Deploy as instance" button in toolbar |
| Source data | `agents` table (instance scope) | `agents` table (blueprint scope) |

## Canvas Toolbar

| Button | Action |
|---|---|
| **+** (Add) | Open create agent dialog |
| Zoom in/out | Adjust canvas zoom level |
| Fit to screen | Auto-zoom to show all agents |
| Grid toggle | Show/hide alignment grid |
| Export | Save team configuration as YAML |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Delete / Backspace | Delete selected agent or link |
| Ctrl+A / Cmd+A | Select all agents |
| Escape | Deselect all, close detail panel |
| Ctrl+Z / Cmd+Z | Undo last action |

*ClawPilot v0.74.1*
