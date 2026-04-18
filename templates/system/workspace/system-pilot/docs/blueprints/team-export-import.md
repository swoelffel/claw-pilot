# Team Export and Import

Team export and import allows sharing complete team configurations as YAML files. Export captures all agents, workspace files, and links from an instance or blueprint. Import reconstructs the team in a target instance or blueprint.

## Export

Export produces a YAML file containing the full team definition.

### Methods

| Method | Command |
|---|---|
| API | `GET /api/instances/:slug/team/export` |
| CLI | `claw-pilot team export <slug> --output team.yaml` |
| Dashboard | Instance detail > Actions > "Export Team" |
| Blueprint API | `GET /api/blueprints/:id/team/export` |

### Response

```
Content-Type: application/x-yaml
Content-Disposition: attachment; filename="team-<slug>.yaml"
```

## YAML Format

The export file uses format version "2".

| Top-Level Field | Type | Description |
|---|---|---|
| `format_version` | string | Schema version, currently `"2"` |
| `agents` | array | Agent definitions with configuration and files |
| `links` | array | Agent-to-agent relationships (a2a and spawn) |
| `defaults` | object | Default settings for the team |

### Agent Fields

Each entry in the `agents` array contains:

| Field | Type | Description |
|---|---|---|
| `id` | string | Agent identifier (unique within the team) |
| `name` | string | Display name |
| `config` | object | Agent configuration (model, tool profile, archetype, prompt mode) |
| `meta` | object | Metadata (kind, position, description) |
| `files` | array | Workspace files (path + content pairs) |

### Link Fields

Each entry in the `links` array contains:

| Field | Type | Description |
|---|---|---|
| `source` | string | Source agent ID |
| `target` | string | Target agent ID |
| `type` | string | Link type: `a2a` or `spawn` |

### Defaults Fields

| Field | Type | Description |
|---|---|---|
| `model` | string | Default model for agents without explicit model |
| `subagents` | object | Default subagent configuration (maxSteps, timeout) |

## Import

Import reads a YAML file and reconstructs the team in the target instance or blueprint.

### Methods

| Method | Command |
|---|---|
| API | `POST /api/instances/:slug/team/import` |
| CLI | `claw-pilot team import <slug> --file team.yaml` |
| Dashboard | Instance detail > Actions > "Import Team" > file upload |
| Blueprint API | `POST /api/blueprints/:id/team/import` |

### Request Body

```
Content-Type: application/x-yaml
Body: <YAML file content>
```

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `dry_run` | boolean | `false` | Preview changes without applying them |

## Dry Run

When `dry_run=true`, the import endpoint parses the YAML, validates the structure, and returns a preview of what would change without modifying any data.

### Dry Run Response

| Field | Type | Description |
|---|---|---|
| `valid` | boolean | Whether the YAML is valid and importable |
| `agents_to_create` | array | Agents that will be added |
| `agents_to_remove` | array | Existing agents that will be removed |
| `links_to_create` | array | Links that will be added |
| `links_to_remove` | array | Existing links that will be removed |
| `warnings` | array | Non-blocking issues (e.g., unknown model, missing provider) |
| `errors` | array | Blocking issues that prevent import |

## Destructive Behavior

Import replaces the entire team configuration in the target. All existing agents, workspace files, and links are removed before the imported team is created. This is a destructive operation.

| Before Import | After Import |
|---|---|
| Existing agents | Deleted |
| Existing workspace files | Deleted |
| Existing agent links | Deleted |
| Existing sessions | Preserved (orphaned sessions are cleaned up later) |
| Instance configuration | Unchanged (slug, port, Named API Key) |

Use dry run to preview changes before committing. There is no undo for a team import.

## Validation Rules

The import process validates the YAML before applying changes.

| Rule | Error if Violated |
|---|---|
| `format_version` must be "2" | `UNSUPPORTED_FORMAT_VERSION` |
| Agent IDs must be unique | `DUPLICATE_AGENT_ID` |
| Link source and target must reference defined agents | `INVALID_LINK_REFERENCE` |
| Link type must be "a2a" or "spawn" | `INVALID_LINK_TYPE` |
| Agent config must include required fields | `INVALID_AGENT_CONFIG` |
| File paths must be relative (no absolute paths) | `INVALID_FILE_PATH` |

## Blueprint Export and Import

Blueprints support the same export/import format and endpoints.

| Operation | Endpoint |
|---|---|
| Export | `GET /api/blueprints/:id/team/export` |
| Import | `POST /api/blueprints/:id/team/import` |

The YAML format is identical. A team exported from an instance can be imported into a blueprint and vice versa.

## CLI Usage

### Export

```bash
claw-pilot team export my-instance --output team.yaml
claw-pilot team export my-instance  # prints to stdout
```

### Import

```bash
claw-pilot team import my-instance --file team.yaml
claw-pilot team import my-instance --file team.yaml --dry-run
```

### Common Workflows

| Workflow | Commands |
|---|---|
| Copy team between instances | `export` from source, `import --file` to target |
| Backup before changes | `export` to file, make changes, `import --file` to restore |
| Share with others | `export` to file, send file, recipient runs `import --file` |
| Create blueprint from file | Create empty blueprint, `import` the team YAML |

*ClawPilot v0.74.1*
