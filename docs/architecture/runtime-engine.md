# claw-runtime Engine

> Part of [claw-pilot Functional Architecture](README.md)

---

## Config (`RuntimeConfig`)

> **Deprecated since v0.59.3**: The file `runtime.json` is now a read-only debug snapshot.
> The source of truth is the database: `agents.config_json` (per-agent) and
> `instances.runtime_config_json` (global). Do not edit runtime.json directly.

Zod schema `RuntimeConfig`:

```typescript
{
  defaultModel: "anthropic/claude-sonnet-4-5",  // "provider/model"
  defaultInternalModel?: "anthropic/claude-haiku-3-5",
  models?: { [alias]: "provider/model" },
  providers?: { [providerId]: { apiKeyEnvVar } },
  agents: RuntimeAgentConfig[],
  globalPermissions?: PermissionRule[],
  mcpEnabled: boolean,
  mcpServers: RuntimeMcpServerConfig[],
  webChat: { enabled: boolean, port: number },
  telegram: { enabled: boolean, botToken?: string, ... },
  compaction?: { threshold, reservedTokens },
  subagents?: { maxSpawnDepth, maxActiveChildren },
}
```

## Supported providers

12 static models across 8 providers + dynamic model discovery (see `src/runtime/provider/models.ts` + `src/core/model-discovery/`):

| Provider | ID | API | Static Models |
|---|---|---|---|
| Anthropic | `anthropic` | anthropic-messages | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5 |
| OpenAI | `openai` | openai-completions | gpt-4o, gpt-4o-mini, o3-mini |
| Google | `google` | google-generative-ai | gemini-2.0-flash, gemini-2.5-pro |
| Ollama | `ollama` | ollama | llama3.2, qwen2.5-coder (local, no cost) |
| OpenRouter | `openrouter` | openrouter | any OpenRouter model (pass-through) |
| Mistral | `mistral` | openai-completions | (dynamic discovery only) |
| xAI / Grok | `xai` | openai-completions | (dynamic discovery only) |
| OpenCode Zen | `opencode` | openai-completions | (dynamic discovery only, no auth) |

**Dynamic model discovery** (v0.63.0): `ModelDiscoveryService` polls provider APIs every 24h to discover available models. Results are cached in `discovered_models` table and merged with the static catalog. Stale cache is kept on error (better than empty list). Discovery is triggered on named key CRUD.

## Daemon lifecycle

```
runtime start --daemon <slug>
  → spawn(process.execPath, ["runtime", "start", slug], { detached: true })
  → child writes PID to <stateDir>/runtime.pid
  → parent polls PID file (5s timeout)

runtime stop <slug>
  → read PID file → process.kill(pid, "SIGTERM")
  → poll until process disappears (5s timeout)
  → delete PID file if still present

runtime start (foreground)
  → write PID file on startup
  → delete PID file on exit (SIGTERM/SIGINT)
```

## Channels

| Channel | Protocol | Config |
|---|---|---|
| Web Chat | WebSocket | `webChat.enabled`, `webChat.port` |
| Telegram | HTTPS polling | `telegram.enabled`, `telegram.botToken` |

## Built-in tools (12 + 1 dynamic)

| Tool | Profiles | Description |
|---|---|---|
| `read` | coding, full | Read files |
| `write` | coding, full | Write files |
| `edit` | coding, full | Edit file sections |
| `multiedit` | coding, full | Multi-section editing |
| `bash` | coding, full | Shell command execution |
| `glob` | coding, full | File search by pattern |
| `grep` | coding, full | Search file content |
| `webfetch` | messaging, coding, full | Fetch web content |
| `question` | minimal, messaging, coding, full | Ask user question (multi-question cards with tabs since v0.72.0) |
| `todowrite` | coding, full | Todo list management (write) |
| `todoread` | coding, full | Todo list management (read) |
| `skill` | coding, full | Execute named skill |
| `task` | full only | Spawn subagent (removed for subagents) |

## Plugin system

8 hooks: `agent.beforeStart`, `agent.end`, `tool.beforeCall`, `tool.afterCall`, `message.received`, `message.sending`, `session.start`, `session.end`.

Plugins can expose `tools()`, `routes()`, and tool definition transforms.

**system-tools plugin** (v0.72.5): 22 `cp_*` admin tools that query `registry.db` directly via Registry, Lifecycle, Provisioner, and Destroyer. No dependency on dashboard REST API — each component connects to the DB independently.

**workspace-knowledge plugin** (v0.73.5): auto-registered for all instances, exposing 2 tools with zero permanent token cost in the system prompt:

| Tool | Args | Description |
|---|---|---|
| `ws_list_files(dir?)` | optional subdirectory | Lists user-created workspace files with extracted H1 title / frontmatter `description:` and size. Excludes identity/memory whitelisted files. |
| `ws_search_files(query, dir?)` | FTS5 query + optional dir | Full-text BM25 search with snippet highlighting (top 10 results, ~300 tokens/call). |

Workspace files are indexed via SQLite FTS5 (`agent_files_fts`, schema v36). Files stored at relative paths under `workspaces/<agentId>/` (e.g., `memory/facts.md`). Path validation via `validateWorkspaceRelativePath()` — allows `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`, `.log`; rejects path traversal and reserved segments.

## Event bus (26 types)

The bus is instance-scoped (`getBus(slug)`). 26 typed event types (typed via `EventDef<T, P>`):

| Category | Events |
|---|---|
| Runtime | `runtime.started`, `runtime.stopped`, `runtime.state_changed`, `runtime.error` |
| Session | `session.created`, `session.updated`, `session.ended`, `session.status`, `session.system_prompt` |
| Message | `message.created`, `message.updated`, `message.part.delta` |
| Permission | `permission.asked`, `permission.replied` |
| Provider | `provider.auth_failed`, `provider.failover` |
| Subagent | `subagent.completed`, `agent.timeout` |
| Heartbeat | `heartbeat.tick`, `heartbeat.alert` |
| MCP | `mcp.server.reconnected`, `mcp.tools.changed` |
| Tool | `tool.doom_loop`, `llm.chunk_timeout`, `tool.call.started`, `tool.call.ended` |
| Channel | `channel.message.received`, `channel.message.sent` |
| Question | `question.asked` |
| Suggestions | `suggestions.generated` |

For real-time delivery to the browser, see [SSE Architecture](../sse-architecture.md).

## Memory system

Separate SQLite FTS5 index in `memory-index.db`. Chunks MEMORY.md and memory/*.md (500 chars, 100 overlap). BM25 search. Temporal decay scoring. `memory_search` tool for agents.

## Flow engine (FLOW-001, v0.73+)

Declarative DAG workflow engine:

- **engine.ts**: topological sort, fan-out/fan-in, `Promise.race` parallel execution, outcome-driven control flow
- **step-executor.ts**: per-step timeout (1s-10min), retry (0-5), configurable `maxSteps` (default 50), dynamic soft/hard cap extension
- **briefing.ts**: mission briefing builder — `includeLastN` defaults to 0 (no cross-run context contamination)
- **sitrep.ts**: structured SITREP extraction; `complete_step` tool (v0.73.2) writes directly to `rt_flow_step_runs.sitrep_json`
- **complete-step-tool.ts**: mandatory tool injected into flow step sessions only (not permanent/Telegram/web-chat sessions)
- **step-extension-tool.ts**: `request_step_extension` tool for dynamically extending the step limit without restarting the SDK

Flow definitions are stored in `rt_flow_definitions` (steps as JSON DAG). Runs track status across 5 states: pending, running, completed, failed, cancelled.

### SITREP schema (v0.73.2+)

```typescript
{
  outcome: "success" | "failure" | "partial",
  summary: string,          // 1-2000 chars
  keyFindings: string[],    // optional, defaults to []
}
```

### Outcome-driven control flow (v0.73.0+)

- `outcome: "failure"` or `"partial"` (or missing/malformed SITREP) propagates `skipped` status to all downstream dependent steps
- `FlowStepDef.continueOnFailure?: boolean` — opt-in flag for steps that must run regardless (e.g., notification or cleanup steps)
- Overall run status: `failed` when any step has a non-success outcome, `completed` only when all steps succeed
- Helper: `hasUnsuccessfulSteps(runId)` in `flow-repository.ts`

### Configurable step limits (v0.73.4+)

- Default: 50 LLM steps per flow step (vs 20 for interactive sessions)
- Soft cap: system reminder injected 2 steps before limit, offering `complete_step` or `request_step_extension`
- Hard cap: `softCap × 2`, absolute maximum 200
- `FlowStepDef.maxSteps?: number` overrides per step (serialized in flow JSON only when non-default)

## Heartbeat system

`HeartbeatRunner` with configurable intervals (5m-24h), active hours (timezone-aware, IANA validation). Primary agents reuse permanent sessions. Budget gate skips heartbeat if budget is exceeded.

## Reasoning and status (v0.71-0.72)

- **Live reasoning streaming**: agents emitting reasoning tokens (Anthropic extended thinking, Gemini 2.5 Pro, OpenAI o3) surface tokens in real-time via `message.part.delta` with `partType: "reasoning"`.
- **5-phase status indicator**: `sending`, `thinking`, `using <tool>`, `responding`, `idle` — driven by `tool.call.started` and `tool.call.ended` bus events.
- **Question UX**: multi-question cards with tabs (1-4 items), `answerType: single/multi/free`, `allowOther`, atomic submission.

## Tool reliability (v0.73.3+)

**Automatic tool call repair** (`experimental_repairToolCall` on Vercel AI SDK `streamText`):
- Heuristic: markdown bullet lists → JSON array (common LLM malformation for `keyFindings`-style fields)
- Pattern: `"fieldName":\n  - item1\n  - item2` → `"fieldName":["item1", "item2"]`
- If local heuristic fails, returns `null` to let the SDK surface the error to the model for self-correction
- Global scope: applies to all session types (permanent, Telegram, web-chat, flow steps, subagent delegations)

## Prompt caching (v0.73.x)

Anthropic prefix caching is applied transparently via `applyCaching()` in `message-builder.ts`:
- Cache control point 1: system prompt (`cacheControl: { type: "ephemeral" }`) — rare change across steps
- Cache control point 2: last 2 non-system messages — caches recent context
- Only active for Anthropic provider (`providerId === "anthropic"`)
- Reduces effective token cost on long sessions and flow runs

---

*Updated: 2026-04-16 — v0.73.5: 8 providers, 12+3 tools (flow-step-only: complete_step, request_step_extension; plugin: ws_*), 43+ bus events, system-tools + workspace-knowledge plugins, outcome-driven flow control, tool repair, prompt caching*
