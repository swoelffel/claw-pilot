# Agents — Architecture and Reference

> **Version**: 0.41.24
> **References**: `src/runtime/agent/` · `src/runtime/tool/registry.ts` · `src/runtime/permission/` · `src/core/discovery.ts` · `src/core/agent-sync.ts` · `ui/src/components/agent-detail-panel.ts`

---

## Overview

An **agent** in ClawPilot is an LLM identity associated with a file workspace, a set of tools, a set of permissions, and a session lifecycle. Multiple agents coexist within the same claw-runtime instance and can collaborate via spawn or A2A delegation mechanisms.

Each agent is described by two orthogonal axes:

| Axis | Field | Values |
|---|---|---|
| Functional role | `kind` | `"primary"` · `"subagent"` |
| Visibility/availability | `mode` | `"primary"` · `"subagent"` · `"all"` |

---

## The two kinds of agents

### `kind: "primary"` — User-facing agent

- **Permanent** session shared across all channels (web, Telegram, CLI)
- Session key: `<slug>:<agentId>` (no channel or peerId)
- Full workspace on disk: `<stateDir>/workspaces/<agentId>/`
- Can spawn subagents via the `task` tool (if `toolProfile: "full"`)
- Visible and accessible to the user
- Default promptMode: `"full"` (all workspace files injected)

### `kind: "subagent"` — Ephemeral tool agent

- **Ephemeral** session, scoped by `parentSessionId`
- Dynamically spawned by a primary agent via the `task` tool
- Can **never** re-spawn (the `task` tool is always removed, regardless of `toolProfile`)
- Minimal context — promptMode `"subagent"` (AGENTS.md + TOOLS.md only)
- Archived after task completion

---

## The two availability modes

| `mode` | Accessible via |
|---|---|
| `"primary"` | User-facing channels only |
| `"subagent"` | `task` tool only |
| `"all"` | Both — default for user-defined agents |

---

## The Pilot agent — default user-defined agent

The **Pilot** is the agent automatically created when provisioning a new instance via `createDefaultRuntimeConfig()`.

```json
{
  "id": "pilot",
  "name": "Pilot",
  "kind": "primary",
  "mode": "all",
  "isDefault": true,
  "toolProfile": "full",
  "persistence": "permanent",
  "maxSteps": 20,
  "allowSubAgents": true,
  "permissions": [
    { "permission": "*",    "pattern": "**",           "action": "allow" },
    { "permission": "read", "pattern": "*.env",        "action": "ask"   },
    { "permission": "read", "pattern": "*.env.*",      "action": "ask"   },
    { "permission": "read", "pattern": "*.env.example","action": "allow" },
    { "permission": "question", "pattern": "**",       "action": "allow" }
  ]
}
```

**Synthetic Pilot agent**: if an instance declares no agents in its `runtime.json`, `discovery.ts` and `agent-sync.ts` automatically generate a virtual Pilot agent (without writing to the file). Convention: `agentId === "pilot"` is always treated as `isDefault: true`.

---

## Built-in agents (native)

Built-in agents are defined in `src/runtime/agent/defaults.ts`. They all have `native: true` and `kind: "subagent"`.

### Visible agents (displayed in the `task` tool)

| Agent | `name` | Description |
|---|---|---|
| **Explore** | `"explore"` | Codebase search specialist. Uses Glob, Grep, and Read. Supports depth levels: `"quick"`, `"medium"`, `"very thorough"`. Read-only. |
| **General** | `"general"` | General-purpose agent for search and multi-step parallel execution. |

### Technical agents (hidden — not shown in the picker UI)

| Agent | `name` | Role |
|---|---|---|
| **Build** | `"build"` | Technical coding. Executes tools according to configured permissions. Uses workspace files (SOUL.md, IDENTITY.md) as prompt. |
| **Plan** | `"plan"` | Read-only planning. Reads the codebase, produces plans without editing files. Uses workspace files as prompt. |

### Internal agents (hidden — system infrastructure)

| Agent | `name` | Role | Temperature |
|---|---|---|---|
| **Compaction** | `"compaction"` | Structured conversation summary for context compaction (5 sections: Active Goals, Key Constraints, Current State, Open Items, Working Context). | — |
| **Title** | `"title"` | Generates a short title (≤ 50 characters) for the conversation in the conversation language. | 0.5 |
| **Summary** | `"summary"` | PR description-style summary of what was done (2-3 sentences, first person). | — |

> **Note**: `build` and `plan` have no inline prompt — they load their workspace files (SOUL.md, IDENTITY.md) from `<stateDir>/workspaces/<agentId>/`. The agents `compaction`, `title`, `summary`, `explore`, and `general` have inline prompts that are not editable by the user.

---

## Tool profiles

An agent's `toolProfile` determines the set of available tools. Defined in `src/runtime/tool/registry.ts`.

| Profile | Available tools | Typical usage |
|---|---|---|
| `minimal` | `question` | Pure conversational agents, no file access |
| `messaging` | `question`, `webfetch` | Communication or web monitoring agents |
| `coding` | `read`, `write`, `edit`, `multiedit`, `bash`, `glob`, `grep`, `webfetch`, `question`, `todowrite`, `todoread`, `skill` | Development agents (default for built-ins) |
| `full` | All `coding` + `task` | Orchestrators — can spawn subagents |

**Absolute rule**: the `task` tool is **always removed** for agents with `kind: "subagent"`, regardless of the `toolProfile` value. A subagent can never spawn other agents.

---

## Permissions and rulesets

Permissions control which operations an agent can perform. The evaluation rule is **last-match-wins** — if no rule matches, the default action is `"ask"`.

### Predefined rulesets

**`DEFAULT_RULESET`** — used for Pilot and `build` and `general` agents:
```
*       **             allow   (everything allowed by default)
read    *.env          ask     (.env files: ask)
read    *.env.*        ask
read    *.env.example  allow   (examples: allow)
```

**`EXPLORE_AGENT_RULESET`** — read-only with conditional bash:
```
read    **   allow
glob    **   allow
grep    **   allow
bash    **   ask
write   **   deny
edit    **   deny
task    **   deny
```

**`PLAN_AGENT_RULESET`** — read-only, no execution:
```
read    **   allow
glob    **   allow
grep    **   allow
write   **   deny
edit    **   deny
bash    **   ask
```

**`INTERNAL_AGENT_RULESET`** — no tools (compaction, title, summary):
```
*       **   deny
```

### Permission rule structure

```typescript
{
  permission: string;   // "read" | "write" | "edit" | "bash" | "glob" | "grep" | "task" | "*"
  pattern:    string;   // glob pattern (e.g., "**", "*.env", "src/**/*.ts")
  action:     "allow" | "deny" | "ask";
}
```

---

## Session persistence

Persistence is resolved by `resolveEffectivePersistence()` according to the following priority order:

| Priority | Rule |
|---|---|
| 1 | Explicit `persistence` value in `runtime.json` (absolute override) |
| 2 | Inferred from `kind`: `"primary"` → `"permanent"`, `"subagent"` → `"ephemeral"` |
| 3 | Secure default: `"ephemeral"` |

| Value | Behavior |
|---|---|
| `"permanent"` | One session per agent, shared cross-channel. Key: `<slug>:<agentId>` |
| `"ephemeral"` | One session per task/conversation. Key: `<slug>:<agentId>:<channel>:<peerId>` |

---

## promptMode — workspace injection

The `promptMode` controls which workspace files are loaded into the system prompt. It is automatically inferred from `kind` if not specified.

| Mode | Files loaded |
|---|---|
| `"full"` | SOUL, BOOTSTRAP, AGENTS, TOOLS, IDENTITY, USER, HEARTBEAT + `memory/*.md` |
| `"minimal"` | SOUL, AGENTS, TOOLS, IDENTITY, USER (no HEARTBEAT or memory) |
| `"subagent"` | AGENTS.md and TOOLS.md only |

---

## Links between agents

Agents can be linked via two types of links (`AgentLinkRecord`):

| `link_type` | Semantic | Direction |
|---|---|---|
| `"spawn"` | Source agent can spawn target via the `task` tool | Hierarchical (parent → child) |
| `"a2a"` | Peer-to-peer delegation between primary agents | Bidirectional or directional |

`spawn` links are automatically extracted from `agents[].subagents.allowAgents[]` in `runtime.json` during synchronization (`agent-sync.ts`). `a2a` links are declared explicitly.

A2A policy is also controlled by `agentToAgent.allowList` in the source agent's config.

---

## Blueprint agent vs Instance agent

| Type | DB table | Linked to | Role |
|---|---|---|---|
| **Blueprint agent** | `agents` (`blueprint_id != null`, `instance_id = null`) | A blueprint | Reusable template. Workspace files are stored in the DB (`agent_files`). |
| **Instance agent** | `agents` (`instance_id != null`, `blueprint_id = null`) | An active instance | Concrete agent with physical workspace on disk. Synchronized from `runtime.json` by `AgentSync`. |

The `BlueprintDeployer` materializes blueprint agents into instance agents: it copies workspace files from the DB to disk and updates `runtime.json`.

---

## Agent lifecycle

```
Provisioning a new instance
  └─> createDefaultRuntimeConfig()        → runtime.json with default Pilot agent

InstanceDiscovery.scan()
  └─> parse runtime.json agents[]         → if empty → synthetic Pilot agent
  └─> adopt()                             → registry.createAgent() + AgentSync.sync()

AgentSync.sync() (on each instance startup)
  └─> 1. Read runtime.json
  └─> 2. Build expected agent list (with synthetic pilot fallback)
  └─> 3. Reconcile with DB (add/update/remove based on config_hash SHA-256)
  └─> 4. Sync workspace files (DISCOVERABLE_FILES)
  └─> 5. Extract and replace agent-to-agent links (replaceAgentLinks())

AgentProvisioner.createAgent()            → add an agent to an existing instance
  └─> mkdir workspaces/<agentId>/
  └─> write template files
       - primary : SOUL, BOOTSTRAP, AGENTS, TOOLS, IDENTITY, USER, HEARTBEAT + memory/*.md
       - subagent : AGENTS.md + TOOLS.md only
  └─> update runtime.json agents[]
  └─> registry.upsertAgent()

BlueprintDeployer.deploy()                → deploy a blueprint to an instance
  └─> copy workspace files from DB
  └─> update runtime.json agents[]
  └─> registry.upsertAgent()
```

---

## Agent Card — Configuration Tabs (Dashboard UI)

The `cp-agent-detail-panel` component (`ui/src/components/agent-detail-panel.ts`) exposes agent configuration via three tabs.

---

### Info Tab

Displays agent metadata and delegation links. The following fields are editable via the form (pencil icon) on instances only.

| UI Field | Storage | Key | Notes |
|---|---|---|---|
| **Name** | `runtime.json` | `agents[].name` | Display name in UI |
| **Provider / Model** | `runtime.json` | `agents[].model` | Two-step selection: provider → model. Stored as `"provider/model"` |
| **Role** | DB only | `agents.role` | Free-form, not synced to `runtime.json` |
| **Tags** | DB only | `agents.tags` | CSV, not synced to `runtime.json` |
| **Notes** | DB only | `agents.notes` | Free-form text, not synced to `runtime.json` |
| **Skills** | DB + `runtime.json` | `agents.skills` / `agents[].skills` | `null` = all available skills; `[]` = none; array = explicit list. On running instance: toggle All/None/Custom + checkboxes |
| **Delegates to** | DB (`agent_links`) | `link_type: "spawn"`, `source_agent_id` | Badges + dropdown to add/remove spawn targets |
| **Delegated by** | DB (`agent_links`) | `link_type: "spawn"`, `target_agent_id` | Read-only — agents that can spawn this agent |

> **Role, Tags, Notes** are purely UI fields (table `agents` in DB). They are not written to `runtime.json` and are not read by the claw-runtime engine.

---

### Heartbeat Tab

Configures periodic autonomous tasks for the agent. The entire block is absent from `runtime.json` if heartbeat is disabled (`null`).

| UI Field | Label | `runtime.json` key | Type | Values / Constraints |
|---|---|---|---|---|
| **Enable heartbeat** | "Enable heartbeat" | presence of `heartbeat` | toggle | If disabled → `heartbeat: null` in JSON |
| **Interval** | "Interval" | `heartbeat.every` | `string` (enum) | `"5m"`, `"10m"`, `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"4h"`, `"6h"`, `"12h"`, `"24h"` |
| **Active hours start** | "Active hours" | `heartbeat.activeHours.start` | `string` HH:MM | 24h format. Also requires `end` and `tz` |
| **Active hours end** | "Active hours" | `heartbeat.activeHours.end` | `string` HH:MM | 24h format |
| **Max response chars** | "Max response chars" | `heartbeat.ackMaxChars` | `number` | min 100, max 5000. Default: `500` |
| **Prompt source** | "Use HEARTBEAT.md" / "Custom prompt" | presence of `heartbeat.prompt` | radio | `"file"` → no `prompt` field in JSON; `"custom"` → `heartbeat.prompt` = text |
| **Custom prompt** | — | `heartbeat.prompt` | `string` | Displayed only if prompt source = "Custom prompt" |
| **Tick history** | "Tick history" | read-only via API | — | Last 20 ticks. Instance only, read-only |

**Ghost fields (backend-only, not exposed in UI):**

| Field | `runtime.json` key | Notes |
|---|---|---|
| Timezone | `heartbeat.activeHours.tz` | Loaded and preserved on save, but **no UI field**. Required by schema if `activeHours` is set. Must be configured manually in `runtime.json`. |
| Model | `heartbeat.model` | Dedicated model for heartbeat ticks. Loaded and preserved, but **not editable via UI**. |

---

### Config Tab

Configures LLM behavior and timeouts for the agent. All these fields are written to `runtime.json`.

#### LLM Section

| UI Field | Label | `runtime.json` key | Type | Values / Constraints |
|---|---|---|---|---|
| **Tool profile** | "Tool profile" | `agents[].toolProfile` | `string` (enum) | `"minimal"`, `"messaging"`, `"coding"`, `"full"`. Default: `"coding"` |
| **Prompt mode** | "Prompt mode" | `agents[].promptMode` | `string` (enum) | `"full"`, `"minimal"` (UI). Backend schema also accepts `"subagent"`, not exposed in UI |
| **Max steps** | "Max steps" | `agents[].maxSteps` | `number` integer | min 1, max 100. Default: `20` |
| **Temperature** | "Temperature" | `agents[].temperature` | `number` | min 0, max 2, step 0.1. Leave empty = model default |

#### Extended thinking section (Anthropic)

| UI Field | Label | `runtime.json` key | Type | Values / Constraints |
|---|---|---|---|---|
| **Enable** | "Enable" | `agents[].thinking.enabled` | `boolean` | toggle |
| **Budget tokens** | "Budget tokens" | `agents[].thinking.budgetTokens` | `number` integer | min 1000, max 100000. Default: `15000`. Displayed only if thinking enabled |

#### Spawn Section

| UI Field | Label | `runtime.json` key | Type | Notes |
|---|---|---|---|---|
| **Allow sub-agents** | "Allow sub-agents" | `agents[].allowSubAgents` | `boolean` | Default: `true`. Globally controls spawning capability |

#### Timeouts Section

| UI Field | Label | `runtime.json` key | Type | Values / Constraints |
|---|---|---|---|---|
| **Session timeout** | "Session timeout (ms)" | `agents[].timeoutMs` | `number` integer | min 1000. Default: `300000` (5 min). Global session timeout |
| **LLM inter-chunk timeout** | "LLM inter-chunk timeout (ms)" | `agents[].chunkTimeoutMs` | `number` integer | min 5000. Default: `120000` (2 min). Timeout between consecutive LLM chunks |

#### Instructions Section

| UI Field | Label | `runtime.json` key | Type | Notes |
|---|---|---|---|---|
| **Remote instruction URLs** | "Remote instruction URLs" | `agents[].instructionUrls` | `string[]` | URLs fetched at session startup and added to system prompt. `+ URL` button to add more |
| **Additional workspace files (globs)** | "Additional workspace files (globs)" | `agents[].bootstrapFiles` | `string[]` | Glob patterns. Matching files are injected into the system prompt in addition to standard workspace files. `+ Glob` button to add more |

> **Note on `bootstrapFiles`**: in the UI this field is named `workspaceGlobs` internally. Mapping to `bootstrapFiles` (backend schema name) is done on save.

---

## Quick reference for `runtime.json` fields

Agent configuration fields in `runtime.json` (type `RuntimeAgentConfig`):

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | required | Unique agent identifier |
| `name` | `string` | required | Display name |
| `model` | `string` | required | Format `"provider/model"` or alias |
| `isDefault` | `boolean` | `false` | Default agent for new sessions |
| `toolProfile` | `"minimal"\|"coding"\|"messaging"\|"full"` | `"coding"` | Set of available tools |
| `permissions` | `PermissionRule[]` | `[]` | Permission ruleset |
| `persistence` | `"permanent"\|"ephemeral"` | inferred | Session persistence override |
| `promptMode` | `"full"\|"minimal"\|"subagent"` | inferred | Workspace files injected (`"subagent"` not exposed in UI) |
| `maxSteps` | `number` (1–100) | `20` | Maximum number of tool-call steps |
| `temperature` | `number` (0–2) | — | LLM temperature |
| `systemPrompt` | `string` | — | Inline system prompt override |
| `systemPromptFile` | `string` | — | Path to system prompt file |
| `allowSubAgents` | `boolean` | `true` | Allows subagent spawning |
| `agentToAgent` | `{ enabled, allowList }` | — | A2A delegation policy |
| `thinking.enabled` | `boolean` | `false` | Enables extended thinking (Anthropic) |
| `thinking.budgetTokens` | `number` (1000–100000) | `15000` | Thinking token budget |
| `bootstrapFiles` | `string[]` | — | Glob patterns injected in prompt (named `workspaceGlobs` in UI) |
| `instructionUrls` | `string[]` | — | URLs fetched and added to prompt |
| `skillUrls` | `string[]` | — | Remote skill JSON index |
| `timeoutMs` | `number` | `300000` | Global session timeout (5 min) |
| `chunkTimeoutMs` | `number` | `120000` | Timeout between LLM chunks (2 min) |
| `inheritWorkspace` | `boolean` | — | Subagents inherit parent workDir |
| `heartbeat.every` | `string` (enum) | — | Interval: `"5m"` to `"24h"` |
| `heartbeat.activeHours.start` | `string` HH:MM | — | Start of active hours |
| `heartbeat.activeHours.end` | `string` HH:MM | — | End of active hours |
| `heartbeat.activeHours.tz` | `string` | — | IANA timezone (e.g., `"Europe/Paris"`). **Required** if `activeHours` is set. Not editable via UI |
| `heartbeat.ackMaxChars` | `number` (100–5000) | `500` | Max length of tick response |
| `heartbeat.prompt` | `string` | — | Custom prompt for ticks. Absent = uses HEARTBEAT.md |
| `heartbeat.model` | `string` | — | Dedicated model for ticks. Not editable via UI |
