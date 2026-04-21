# Creating an Instance

How to create a new ClawPilot instance via the dashboard wizard, REST API, or CLI command, including all required and optional configuration parameters.

## Methods

### 1. Dashboard Wizard (Recommended)

The interactive wizard on the instances page walks through every step:
1. **Slug** — unique identifier (kebab-case, e.g. `my-assistant`)
2. **Display name** — human-readable label
3. **Port** — auto-allocated from range 18789–18838, or pick manually
4. **AI provider + API key** — select provider and a named key
5. **Initial agents** — optionally configure agents during creation
6. **Blueprint** — optionally deploy a blueprint to bootstrap a full team
7. **Telegram** — optionally configure a Telegram bot token and chat IDs

### 2. REST API

```
POST /api/instances
Content-Type: application/json

{
  "slug": "my-assistant",
  "displayName": "My Assistant",
  "port": 18792,
  "provider": "anthropic",
  "namedKeyId": "my-anthropic-key",
  "blueprintSlug": "researcher-team"
}
```

### 3. CLI

```bash
claw-pilot create \
  --slug my-assistant \
  --name "My Assistant" \
  --provider anthropic \
  --key my-anthropic-key
```

## Required Parameters

| Parameter | Description | Constraints |
|---|---|---|
| `slug` | Unique instance identifier | kebab-case, no spaces, must be unique across all instances |
| `displayName` | Human-readable name | Free text |
| `port` | Network port for the runtime daemon | Range 18789–18838, must be available |
| `provider` | AI provider name | One of: openai, anthropic, mistral, google, openrouter, etc. |
| `namedKeyId` | Reference to a named API key | Must exist in the database |

## Optional Parameters

| Parameter | Description | Default |
|---|---|---|
| `blueprintSlug` | Blueprint to deploy on creation | None (empty instance) |
| `agents` | Array of agent configurations | Single default agent |
| `telegramBotToken` | Telegram bot token for channel integration | None |
| `telegramChatIds` | Allowed Telegram chat IDs | None |
| `description` | Instance description | Empty |
| `tags` | Metadata tags | Empty |

## Port Allocation

Ports are allocated from the range **18789–18838**, allowing up to 50 concurrent instances. The dashboard auto-selects the next available port. You can override this with a specific port number, but it must be within range and not already in use.

## After Creation

A newly created instance starts in `stopped` state. It does not consume resources until you start it.

To launch the instance:
- **Dashboard:** Click the **Start** button on the instance card
- **CLI:** `claw-pilot start my-assistant`
- **API:** `POST /api/instances/my-assistant/start`

## Configuration Storage

Instance configuration is stored in the `instances` table of `registry.db`, specifically in the `runtime_config_json` column. This database record is the **source of truth**.

> ⚠️ **Do not read or edit `runtime.json`.** A legacy `runtime.json` file may still exist in the instance state directory (`~/.claw-pilot/instances/<slug>/`), but it is a **deprecated debug snapshot** — it is NOT kept in sync with the current state. Never grep it, never parse it, never trust it. All current configuration and state live in `registry.db` and must be queried via the `cp_*` tools, the dashboard API, or (for raw inspection) `sqlite3`. See [../reference/data-sources.md](../reference/data-sources.md) for the canonical source per concept.

## Blueprint Deployment

When you specify a blueprint during creation, ClawPilot:
1. Creates the instance with base configuration
2. Reads the blueprint definition (agents, tools, workspace files)
3. Provisions all agents defined in the blueprint
4. Copies workspace template files into the instance workspace

Blueprints are reusable — the same blueprint can be deployed to multiple instances.

## Validation Rules

- Slug must be unique across all instances
- Slug must be valid kebab-case (lowercase letters, numbers, hyphens)
- Port must be in range and available
- Named key must exist and be valid for the selected provider
- Blueprint slug (if provided) must exist in the blueprints table

*ClawPilot v0.74.1*
