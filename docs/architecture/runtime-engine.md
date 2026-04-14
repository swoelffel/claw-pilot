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

## Flow engine (FLOW-001)

Declarative DAG workflow engine:

- **engine.ts**: topological sort, fan-out/fan-in, `Promise.race` parallel execution
- **step-executor.ts**: per-step timeout (1s-10min), retry (0-5), agent session
- **briefing.ts**: mission briefing builder for step prompts
- **sitrep.ts**: structured SITREP extraction from agent responses

Flow definitions are stored in `rt_flow_definitions` (steps as JSON DAG). Runs track status across 5 states: pending, running, completed, failed, cancelled.

## Heartbeat system

`HeartbeatRunner` with configurable intervals (5m-24h), active hours (timezone-aware, IANA validation). Primary agents reuse permanent sessions. Budget gate skips heartbeat if budget is exceeded.

## Reasoning and status (v0.71-0.72)

- **Live reasoning streaming**: agents emitting reasoning tokens (Anthropic extended thinking, Gemini 2.5 Pro, OpenAI o3) surface tokens in real-time via `message.part.delta` with `partType: "reasoning"`.
- **5-phase status indicator**: `sending`, `thinking`, `using <tool>`, `responding`, `idle` — driven by `tool.call.started` and `tool.call.ended` bus events.
- **Question UX**: multi-question cards with tabs (1-4 items), `answerType: single/multi/free`, `allowOther`, atomic submission.

---

*Updated: 2026-04-14 — v0.72.6: 8 providers, 12+1 tools, 26+ bus events, system-tools plugin (DB-direct), flow engine, reasoning streaming*
