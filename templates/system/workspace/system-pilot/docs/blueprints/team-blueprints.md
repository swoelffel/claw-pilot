# Team Blueprints

Team blueprints are reusable templates that capture an instance's complete agent configuration. They allow you to define a team of agents once and deploy it as many times as needed, each deployment creating a fully configured instance.

## What a Blueprint Contains

| Component | Description |
|---|---|
| Agents | List of agent definitions (id, name, model, tool profile, archetype, config) |
| Workspace files | SOUL.md, AGENTS.md, docs/, skills/, and other workspace files per agent |
| Spawn links | Agent-to-agent relationships (a2a and spawn link types) |
| Default model | Fallback model for agents that do not specify one |
| Metadata | Blueprint name, description, category, creation timestamp |

## Creating Blueprints

### From an Existing Instance

Save the current agent setup of a running or stopped instance as a new blueprint. All agents, their workspace files, and spawn links are copied into the blueprint.

| Method | Command |
|---|---|
| Dashboard | Instance detail page > Actions > "Save as Blueprint" |
| API | `POST /api/blueprints` with `{ source_instance: "<slug>" }` |
| CLI | `claw-pilot blueprint create --from-instance <slug> --name "My Team"` |

### From Scratch

Build a blueprint without an existing instance using the blueprint builder canvas or the API.

| Method | Command |
|---|---|
| Dashboard | Blueprints page > "New Blueprint" > Builder canvas |
| API | `POST /api/blueprints` with agent definitions in the request body |

## Deploying a Blueprint

Create a new instance from a blueprint. All agents, workspace files, and spawn links are copied into the new instance.

| Method | Command |
|---|---|
| Dashboard | Blueprint detail page > "Deploy" button |
| API | `POST /api/instances` with `{ blueprint_id: "<id>" }` |
| CLI | `claw-pilot instance create --blueprint <id> --slug <name>` |

Deployment creates independent copies. Changes to the blueprint after deployment do not affect existing instances.

## Built-in Blueprints

ClawPilot ships with 3 built-in blueprints ready to deploy.

| Blueprint | Description | Agents |
|---|---|---|
| `dev-harness` | Coding team for software development | Lead coder, reviewer, researcher, tester |
| `design-studio` | UX design team | UX designer, UI developer, accessibility reviewer |
| `team-architect` | Team design and planning team | Architect, planner, documentation writer |

Built-in blueprints cannot be deleted but can be cloned and customized.

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/blueprints` | Create a new blueprint |
| `GET` | `/api/blueprints` | List all blueprints |
| `GET` | `/api/blueprints/:id` | Get blueprint details including agents and links |
| `PUT` | `/api/blueprints/:id` | Update blueprint metadata |
| `DELETE` | `/api/blueprints/:id` | Delete a blueprint (built-in blueprints protected) |

### Create Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Blueprint display name |
| `description` | string | No | Blueprint description |
| `source_instance` | string | No | Instance slug to copy agents from |
| `agents` | array | No | Agent definitions (if not copying from instance) |
| `default_model` | string | No | Default model for agents without an explicit model |

## Blueprint Builder

The blueprint builder uses the same canvas component as the instance agent builder. Route: `#/blueprints/:id/builder`.

| Feature | Description |
|---|---|
| Add agents | Click + to create new agents with the creation dialog |
| Drag positioning | Arrange agent cards on the 2D canvas |
| Spawn links | Draw connections between agents |
| Agent detail panel | Click an agent to edit config, workspace files, skills |
| Deploy button | Create a new instance from this blueprint |

## Database Schema

| Table | Description |
|---|---|
| `blueprints` | Blueprint metadata (id, name, description, default model, timestamps) |
| `agents` | Agent records scoped to a blueprint (blueprint_id column) |
| `agent_files` | Workspace files per agent within the blueprint |
| `agent_links` | Spawn and A2A links between agents in the blueprint |

## Blueprint Lifecycle

1. **Create** blueprint (from instance, from scratch, or from import)
2. **Edit** agents, links, and workspace files via builder or API
3. **Deploy** to create new instances as needed
4. **Update** the blueprint to reflect improved team configurations
5. **Delete** when the blueprint is no longer needed

*ClawPilot v0.74.1*
