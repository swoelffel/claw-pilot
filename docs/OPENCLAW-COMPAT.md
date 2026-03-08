# OpenClaw Compatibility Reference

This document tracks the OpenClaw version claw-pilot is aligned with, the sources used to
derive provider/model catalogs, and the procedure to update them on each OpenClaw release.

---

## Reference version

**OpenClaw `2026.3.7`** (latest stable tag)

---

## openclaw.json format (v2026.3.7)

### Required top-level keys

| Key | Notes |
|-----|-------|
| `meta.lastTouchedVersion` | Must match the installed OpenClaw version |
| `meta.lastTouchedAt` | ISO 8601 timestamp (numeric Unix ms also accepted since 2026.2.24) |
| `agents.defaults.model` | Object `{ primary: "provider/model" }` — **not** a string |
| `gateway.bind` | `"loopback"`, `"lan"`, `"auto"`, `"custom"`, or `"tailnet"` — `"all"` removed in 2026.3.x |
| `gateway.auth.mode` | `"token"` — **not** `type` |

### Removed / renamed keys (do NOT use)

| Old key | Replacement |
|---------|-------------|
| `meta.slug` | removed |
| `meta.name` | removed |
| `meta.version` | removed |
| `agents.defaults.model` (string) | `{ primary: "..." }` object |
| `agents.defaults.cache` | removed |
| `agents.defaults.heartbeat` (boolean) | `agents.defaults.heartbeat.directPolicy` object |
| `tools.agentToAgent.agents` | `tools.agentToAgent.allow` (array of IDs) |
| `bindings[].type` | removed |
| `bindings[].path` | removed |
| `bindings[].match.channel` + `match.accountId` | new format |
| `gateway.host` | `gateway.bind` |
| `gateway.auth.type` | `gateway.auth.mode` |
| `gateway.bind: "all"` | removed in 2026.3.x — use `"lan"` for equivalent behavior |
| `env.file` (top-level) | removed |

### New optional keys (since 2026.2.23 through 2026.3.7)

These are additive — no impact on existing configs, but claw-pilot should not generate them
unless explicitly needed.

| Key | Added in | Notes |
|-----|----------|-------|
| `sessions.runLog.maxBytes` | 2026.2.23 | Cap run log size (e.g. `"10mb"`) |
| `sessions.runLog.keepLines` | 2026.2.23 | Keep last N lines of run log |
| `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork` | 2026.2.23 | Replaces legacy `allowPrivateNetwork` |
| `talk.provider` | 2026.2.24 | Provider-agnostic TTS provider ID |
| `talk.providers.<id>` | 2026.2.24 | Per-provider TTS config block |
| `gateway.control.dangerouslyAllowHostHeaderOriginFallback` | 2026.2.24 | Break-glass for Host-header origin matching |
| `gateway.http.securityHeaders.strictTransportSecurity` | 2026.2.23 | Optional HSTS for direct HTTPS deployments |
| `secrets` | 2026.2.26 | External secrets management (audit/configure/apply/reload workflow) |
| `agents.defaults.heartbeat.directPolicy` | 2026.2.25 | `"allow"` or `"block"` — replaces heartbeat DM toggle |
| `cli.banner.taglineMode` | 2026.3.2 | `"random" \| "default" \| "off"` — controls CLI banner tagline |
| `browser.cdpPortRangeStart` | 2026.3.2 | Starting port for CDP port range |
| `browser.instances[].attachOnly` | 2026.3.2 | Per-instance attach-only mode |
| `browser.extraArgs` | 2026.3.2 | Extra Chrome launch arguments |
| `sessions.retry` | 2026.3.2 | Object `{ maxAttempts, backoffMs, retryOn }` — retry policy for sessions |
| `sessions.webhookToken` | 2026.3.2 | Now accepts `SecretRef` in addition to plain string — additive, existing string configs still valid |
| `sessions.failureAlert` | 2026.3.2 | Alert config on cron session failures |
| `sessions.failureDestination` | 2026.3.2 | Destination for cron failure messages |
| `acp` | 2026.3.2 | New ACP (Agent Communication Protocol) config block — `acp.dispatch.enabled` defaults to `true` |
| `tools.media.audio.echoTranscript` | 2026.3.2 | Echo audio transcription to chat |
| `tools.media.audio.echoFormat` | 2026.3.2 | Format for echoed transcription |
| `tools.sessions_spawn.attachments` | 2026.3.2 | Inline attachments for subagent spawn |
| `plugins.slots.contextEngine` | 2026.3.7 | New plugin slot for context engine |
| `plugins.entries.<id>.hooks.allowPromptInjection` | 2026.3.7 | Allow prompt injection per plugin entry |
| `agents.defaults.compaction.postCompactionSections` | 2026.3.7 | Sections to append after compaction |
| `messages.tts.openai.baseUrl` | 2026.3.7 | Custom base URL for OpenAI TTS |
| `channels.slack.typingReaction` | 2026.3.7 | Emoji reaction while typing in Slack |
| `channels.discord.allowBots` | 2026.3.7 | `"mentions"` — allow bot mentions in Discord |
| `cron.retry.retryOn` | 2026.3.7 | `"overloaded"` — retry cron sessions on overload |

### Breaking changes in 2026.2.25 (not affecting claw-pilot generated configs)

- **Heartbeat `directPolicy` default**: changed to `"allow"` in 2026.2.25 (was `"block"` in
  2026.2.24). To keep DM-blocked behavior, set
  `agents.defaults.heartbeat.directPolicy: "block"` explicitly.

### Breaking changes in 2026.2.26 / 2026.2.27 (not affecting claw-pilot generated configs)

- **Node exec approvals**: structured `commandArgv` approvals now required for `host=node`
  — claw-pilot does not generate node exec config, so no impact.
- **Sandbox path alias guard**: broken symlink targets now rejected — no impact on
  claw-pilot generated workspace paths.

### Breaking changes in 2026.3.x

#### Port reservation per instance

OpenClaw 2026.3.x automatically reserves **4 ports** per instance on startup:

| Offset | Port | Role |
|--------|------|------|
| P | gateway principal (configured port) |
| P+1 | internal bridge |
| P+2 | browser control server (`DEFAULT_BROWSER_CONTROL_PORT`) |
| P+4 | canvas host (`DEFAULT_CANVAS_HOST_PORT`) |

Note: P+3 is intentionally not reserved.

**Impact on claw-pilot**: the port allocator now uses a minimum step of 5 between instances
and reserves P+1, P+2, P+4 in the `ports` table. The default port range has been extended
from 18789–18799 to 18789–18838 (10 instances).

#### `gateway.bind: "all"` removed

The Zod schema in 2026.3.x no longer accepts `"all"` as a value for `gateway.bind`.

Valid values: `"auto" | "lan" | "loopback" | "custom" | "tailnet"`

Migration: replace `"all"` with `"lan"` for equivalent behavior (bind to all LAN interfaces).
claw-pilot generated configs use `"loopback"` — no change needed.

#### New native health endpoints

The gateway now exposes health probe endpoints natively (no auth required):

- `GET /health` — returns `{"ok":true}`
- `GET /healthz` — alias
- `GET /ready` — returns `{"ok":true}` when gateway is ready
- `GET /readyz` — alias

These are available without authentication and suitable for systemd `ExecStartPost=` probes,
load balancers, and monitoring.

#### New CLI commands

- `openclaw config validate [--json]` — validate `openclaw.json` against the Zod schema
- `openclaw config file` — print the path to the active config file

These can be used from claw-pilot via `conn.exec()` for config validation workflows.

### Breaking changes in 2026.3.7 (not affecting claw-pilot generated configs)

- **Google default model renamed**: `gemini-3-pro-preview` → `gemini-3.1-pro-preview` (runtime
  alias, not in pi-ai catalog). claw-pilot's `provider-catalog.ts` updated accordingly.
- **MiniMax model removed**: `MiniMax-M2.5-Lightning` removed from MiniMax catalog. Not exposed
  in claw-pilot — no action required.

### Breaking changes in 2026.3.2 (not affecting claw-pilot generated configs)

- **`tools.profile` default changed**: the interactive onboarding default changed from
  `"coding"` to `"messaging"`. claw-pilot explicitly generates `"coding"` — no change needed,
  but note that OpenClaw's own onboarding now defaults differently.
- **`acp.dispatch.enabled` defaults to `true`**: ACP dispatch is now on by default. claw-pilot
  does not generate `acp` config — existing configs without this key will inherit the new default.
- **Plugin SDK**: `api.registerHttpHandler(...)` removed — no impact on claw-pilot.
- **Zalo Personal plugin**: migrated to `zca-js` native — no impact on claw-pilot.

### Minimal valid config skeleton

```json
{
  "meta": { "lastTouchedVersion": "2026.3.7", "lastTouchedAt": "<ISO>" },
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "baseUrl": "https://api.anthropic.com",
        "models": []
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-opus-4-5" },
      "workspace": "workspace",
      "subagents": { "maxConcurrent": 4, "archiveAfterMinutes": 60 }
    }
  },
  "tools": {
    "profile": "coding",
    "agentToAgent": { "enabled": true, "allow": ["main"] }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token", "token": "${OPENCLAW_GW_AUTH_TOKEN}" },
    "trustedProxies": ["127.0.0.1"]
  }
}
```

### opencode provider (no API key)

Uses `auth.profiles` instead of `models.providers`:

```json
{
  "auth": {
    "profiles": {
      "opencode:default": { "provider": "opencode", "mode": "api_key" }
    }
  }
}
```

### kilocode provider (API key required)

Uses `auth.profiles` with `provider: "kilocode"`. Added in 2026.2.23.

```json
{
  "auth": {
    "profiles": {
      "kilocode:default": { "provider": "kilocode", "mode": "api_key" }
    }
  }
}
```

---

## Provider catalog

Derived from:
- `src/openclaw/node_modules/@mariozechner/pi-ai/dist/models.generated.js` — Anthropic, OpenAI, Google, Mistral, xAI model lists
- `src/openclaw/src/agents/opencode-zen-models.ts` — OpenCode Zen static fallback models
- `src/openclaw/src/commands/onboard-auth.models.ts` — Mistral, xAI, MiniMax, Moonshot, Qianfan, z-ai default models
- `src/openclaw/src/providers/kilocode-shared.ts` — Kilocode model catalog
- `src/openclaw/src/secrets/provider-env-vars.ts` — Provider env var names
- `src/openclaw/src/commands/google-gemini-model-default.ts` — Google default model
- `src/openclaw/src/commands/openai-model-default.ts` — OpenAI default model
- `src/openclaw/src/agents/defaults.ts` — `DEFAULT_PROVIDER`, `DEFAULT_MODEL`

### Provider IDs and env vars

| Provider ID | Env var | Base URL |
|-------------|---------|----------|
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `google` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta` |
| `mistral` | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1` |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `kilocode` | `KILOCODE_API_KEY` | `https://api.kilo.ai/api/gateway/` |
| `opencode` | *(none — uses auth.profiles)* | `https://opencode.ai/zen/v1` |
| `minimax` | `MINIMAX_API_KEY` | `https://api.minimax.io/v1` |
| `minimax-cn` | `MINIMAX_API_KEY` | `https://api.minimaxi.com/anthropic` |
| `moonshot` | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` |
| `kimi-coding` | `KIMI_API_KEY` or `KIMICODE_API_KEY` | *(Kimi coding endpoint)* |
| `zai` | `ZAI_API_KEY` or `Z_AI_API_KEY` | `https://api.z.ai/api/paas/v4` |
| `qianfan` | `QIANFAN_API_KEY` | *(Baidu Qianfan endpoint)* |
| `volcengine` | `VOLCANO_ENGINE_API_KEY` | *(ByteDance Volcano Engine)* |
| `byteplus` | `BYTEPLUS_API_KEY` | *(BytePlus endpoint)* |

> **Note:** Google's env var is `GEMINI_API_KEY` (not `GOOGLE_API_KEY`). Models are
> referenced as `google/gemini-...`. The provider ID is `google` (not `gemini`).

> **Note:** `minimax`, `moonshot`, `kimi-coding`, `zai`, `qianfan`, `volcengine`, and
> `byteplus` are available since 2026.2.25/2026.2.26 — claw-pilot's wizard does not
> expose them yet (Anthropic, OpenAI, Google, Mistral, xAI, OpenRouter, Kilocode,
> OpenCode are the supported onboarding paths).

### Model catalog (as of 2026.3.7)

#### Anthropic
*(from `@mariozechner/pi-ai` catalog — use `anthropic/<id>` in config)*
- `anthropic/claude-opus-4-5` *(default — latest Opus)*
- `anthropic/claude-opus-4-5-20251101`
- `anthropic/claude-opus-4-1`
- `anthropic/claude-opus-4-1-20250805`
- `anthropic/claude-opus-4-0`
- `anthropic/claude-opus-4-20250514`
- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-sonnet-4-5-20250929`
- `anthropic/claude-sonnet-4-0`
- `anthropic/claude-sonnet-4-20250514`
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-haiku-4-5-20251001`

#### OpenAI
*(from `@mariozechner/pi-ai` catalog — use `openai/<id>` in config)*
- `openai/gpt-5.1-codex` *(default)*
- `openai/gpt-5.1-codex-max`
- `openai/gpt-5.1-codex-mini`
- `openai/gpt-5.2-codex` *(new in 2026.3.7)*
- `openai/gpt-5.2-pro` *(new in 2026.3.7)*
- `openai/gpt-5.2`
- `openai/gpt-5.1`
- `openai/gpt-5`
- `openai/gpt-5-codex`
- `openai/gpt-5-mini`
- `openai/gpt-5-chat-latest`
- `openai/gpt-4.1`
- `openai/gpt-4.1-mini`
- `openai/gpt-4.1-nano`
- `openai/o3`
- `openai/o4-mini`

#### Google
*(from `@mariozechner/pi-ai` catalog — use `google/<id>` in config)*
- `google/gemini-3.1-pro-preview` *(default — renamed from gemini-3-pro-preview in 2026.3.7)*
- `google/gemini-3.1-flash-lite-preview` *(new in 2026.3.7)*
- `google/gemini-3-flash-preview`
- `google/gemini-2.5-pro`
- `google/gemini-2.5-flash`
- `google/gemini-2.5-flash-lite`

#### Mistral
*(from `@mariozechner/pi-ai` catalog — use `mistral/<id>` in config)*
- `mistral/mistral-large-latest` *(default)*
- `mistral/magistral-medium-latest`
- `mistral/magistral-small`
- `mistral/mistral-medium-latest`
- `mistral/mistral-small-latest`
- `mistral/devstral-medium-latest`
- `mistral/devstral-small-2507`

#### xAI
*(from `@mariozechner/pi-ai` catalog — use `xai/<id>` in config)*
- `xai/grok-4` *(default)*
- `xai/grok-4-fast`
- `xai/grok-4-1-fast`
- `xai/grok-code-fast-1`
- `xai/grok-3`
- `xai/grok-3-mini`

#### OpenRouter
- `openrouter/auto` *(default)*

#### Kilocode *(since 2026.2.23)*
*(from `src/openclaw/src/providers/kilocode-shared.ts` — use `kilocode/<id>` in config)*
- `kilocode/anthropic/claude-opus-4.6` *(default)*
- `kilocode/anthropic/claude-sonnet-4.5`
- `kilocode/openai/gpt-5.2`
- `kilocode/google/gemini-3-pro-preview`
- `kilocode/google/gemini-3-flash-preview`
- `kilocode/x-ai/grok-code-fast-1`
- `kilocode/moonshotai/kimi-k2.5`
- `kilocode/z-ai/glm-5:free`
- `kilocode/minimax/minimax-m2.5:free`

> Uses `auth.profiles` like opencode. No `models.providers` entry needed.
> API key env var: `KILOCODE_API_KEY`.

#### OpenCode Zen
*(static fallback catalog from `opencode-zen-models.ts` — use `opencode/<id>` in config)*
- `opencode/gpt-5.1-codex` *(default)*
- `opencode/claude-opus-4-6`
- `opencode/claude-opus-4-5`
- `opencode/gemini-3-pro`
- `opencode/gpt-5.1-codex-mini`
- `opencode/gpt-5.1`
- `opencode/glm-4.7`
- `opencode/gemini-3-flash`
- `opencode/gpt-5.1-codex-max`
- `opencode/gpt-5.2`

> Note: OpenCode Zen fetches its live catalog dynamically; the list above is the static
> fallback. Model IDs like `opencode/claude-opus-4-6` are Zen-internal aliases and do
> **not** correspond to Anthropic API model IDs.

---

## Files to update on each OpenClaw release

| File | What to update |
|------|---------------|
| `src/lib/provider-catalog.ts` | `PROVIDER_CATALOG` — providers list, models arrays, defaultModel per provider |
| `src/core/config-generator.ts` | `PROVIDER_ENV_VARS` + `providerDefaults` (baseUrl) |
| `docs/OPENCLAW-COMPAT.md` | This file — version, model lists, format changes |

### Update procedure

1. Check the OpenClaw changelog for breaking config changes (`zod-schema.ts` diff).
2. Re-read `models.generated.js` for updated model IDs.
3. Re-read `onboard-auth.models.ts` for new providers or default model changes.
4. Re-read `kilocode-shared.ts` and `opencode-zen-models.ts` for new models.
5. Re-read `secrets/provider-env-vars.ts` for new provider env var names.
6. Check `src/config/port-defaults.ts` for changes to sidecar port offsets.
7. Update the files above.
8. Run `pnpm test` — all tests must pass.
9. Bump `version` in `package.json` if the catalog change is user-visible.
