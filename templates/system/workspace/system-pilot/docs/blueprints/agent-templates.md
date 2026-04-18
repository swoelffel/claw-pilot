# Agent Templates

Agent templates (also called agent blueprints) are standalone reusable agent configurations independent of team blueprints and instances. They package an agent's identity, tools, and workspace files into a shareable unit that can be deployed into any instance.

## What an Agent Template Contains

| Component | Description |
|---|---|
| `config_json` | Agent configuration: model, tool profile, archetype, prompt mode, persistence |
| Workspace files | SOUL.md, AGENTS.md, docs/, skills/, memory/ templates |
| Category | Classification: `user` (custom), `tool` (utility), `system` (platform) |
| Metadata | Name, description, version, creation timestamp |

## Creating Agent Templates

### From an Existing Agent

Save a running agent's configuration and workspace files as a reusable template.

| Method | Command |
|---|---|
| Dashboard | Agent detail panel > Actions > "Save as Template" |
| API | `POST /api/agent-blueprints` with `{ source_instance: "<slug>", source_agent: "<id>" }` |

### From Scratch

Create a template without an existing agent.

| Method | Command |
|---|---|
| Dashboard | Agent Templates gallery > "New Template" |
| API | `POST /api/agent-blueprints` with config_json and files in request body |

## Database Schema

| Table | Description |
|---|---|
| `agent_blueprints` | Template metadata and configuration (id TEXT PK, config_json, category) |
| `agent_blueprint_files` | Workspace files attached to the template |

### agent_blueprints Columns

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Unique identifier (UUID) |
| `name` | TEXT | Display name |
| `description` | TEXT | Template description |
| `config_json` | TEXT | JSON agent configuration (model, tool profile, archetype, etc.) |
| `category` | TEXT | Template category: user, tool, system |
| `created_at` | TEXT | ISO 8601 creation timestamp |
| `updated_at` | TEXT | ISO 8601 last update timestamp |

### agent_blueprint_files Columns

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Unique file identifier |
| `agent_blueprint_id` | TEXT | Foreign key to agent_blueprints |
| `file_path` | TEXT | Relative path within workspace (e.g., SOUL.md) |
| `content` | TEXT | File content |

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/agent-blueprints` | Create a new template |
| `GET` | `/api/agent-blueprints` | List all templates (filterable by category) |
| `GET` | `/api/agent-blueprints/:id` | Get template details with workspace files |
| `PUT` | `/api/agent-blueprints/:id` | Update template configuration or metadata |
| `DELETE` | `/api/agent-blueprints/:id` | Delete a template |
| `POST` | `/api/agent-blueprints/:id/clone` | Deep copy a template (new ID, all files copied) |
| `GET` | `/api/agent-blueprints/:id/export` | Export template as YAML |
| `POST` | `/api/agent-blueprints/import` | Import template from YAML |

## Clone

Cloning creates an independent deep copy of a template with a new unique ID. All workspace files are duplicated. The clone is fully independent from the original.

```
POST /api/agent-blueprints/:id/clone
Response: { id: "<new-uuid>", name: "Copy of <original-name>", ... }
```

## Export and Import

### Export Format (YAML)

Templates export as a YAML file containing the full configuration and workspace files.

| Field | Description |
|---|---|
| `format_version` | Schema version (currently "2") |
| `name` | Template display name |
| `description` | Template description |
| `category` | Template category |
| `config` | Agent configuration object (model, tool profile, etc.) |
| `files` | Array of workspace files (path + content) |

### Export

```
GET /api/agent-blueprints/:id/export
Content-Type: application/x-yaml
```

### Import

```
POST /api/agent-blueprints/import
Content-Type: application/x-yaml
Body: <YAML content>
```

Import creates a new template with a fresh ID. If a template with the same name already exists, the imported template is renamed with a numeric suffix.

## Deploy to Instance

Clone a template into an existing instance as a new agent. The template's config and workspace files are copied into the instance's agent roster.

| Method | Command |
|---|---|
| Dashboard | Template detail > "Deploy to Instance" > select target instance |
| API | `POST /api/instances/:slug/agents` with `{ template_id: "<id>" }` |

## Templates Gallery

The dashboard provides a gallery view at `#/agent-templates` for browsing and managing templates.

| Feature | Description |
|---|---|
| Category filter | Filter by user, tool, or system categories |
| Search | Full-text search across template names and descriptions |
| Preview | Click a template to view its config and workspace files |
| Actions | Clone, export, deploy, edit, delete |
| Import button | Upload a YAML file to import a new template |

## Categories

| Category | Description | Examples |
|---|---|---|
| `user` | Custom templates created by users | Project-specific agents, personal assistants |
| `tool` | Utility agents for specific tasks | Code reviewer, documentation writer, test runner |
| `system` | Platform agents (managed by ClawPilot) | system-pilot, maintenance agents |

*ClawPilot v0.74.1*
