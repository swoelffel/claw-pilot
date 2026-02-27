# OpenClaw Compatibility Reference

This document tracks the OpenClaw version claw-pilot is aligned with, the sources used to
derive provider/model catalogs, and the procedure to update them on each OpenClaw release.

---

## Reference version

**OpenClaw `2026.2.27`** (latest stable tag)

---

## openclaw.json format (v2026.2.27)

### Required top-level keys

| Key | Notes |
|-----|-------|
| `meta.lastTouchedVersion` | Must match the installed OpenClaw version |
| `meta.lastTouchedAt` | ISO 8601 timestamp (numeric Unix ms also accepted since 2026.2.24) |
| `agents.defaults.model` | Object `{ primary: "provider/model" }` — **not** a string |
| `gateway.bind` | `"loopback"` or `"all"` — **not** `host` |
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
| `env.file` (top-level) | removed |

### New optional keys (since 2026.2.23 through 2026.2.27)

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

### Breaking changes in 2026.2.25 (not affecting claw-pilot generated configs)

- **Heartbeat `directPolicy` default**: changed to `"allow"` in 2026.2.25 (was `"block"` in
  2026.2.24). To keep DM-blocked behavior, set
  `agents.defaults.heartbeat.directPolicy: "block"` explicitly.

### Breaking changes in 2026.2.26 / 2026.2.27 (not affecting claw-pilot generated configs)

- **Node exec approvals**: structured `commandArgv` approvals now required for `host=node`
  — claw-pilot does not generate node exec config, so no impact.
- **Sandbox path alias guard**: broken symlink targets now rejected — no impact on
  claw-pilot generated workspace paths.

### Minimal valid config skeleton

```json
{
  "meta": { "lastTouchedVersion": "2026.2.27", "lastTouchedAt": "<ISO>" },
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
    "port": 18790,
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

### Model catalog (as of 2026.2.27)

#### Anthropic
*(from `@mariozechner/pi-ai` catalog — use `anthropic/<id>` in config)*
- `anthropic/claude-opus-4-5` *(default — latest Opus)*
- `anthropic/claude-opus-4-1`
- `anthropic/claude-opus-4-1-20250805`
- `anthropic/claude-opus-4-20250514`
- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-sonnet-4-5-20250929`
- `anthropic/claude-sonnet-4-20250514`
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-haiku-4-5-20251001`

#### OpenAI
*(from `@mariozechner/pi-ai` catalog — use `openai/<id>` in config)*
- `openai/gpt-5.1-codex` *(default)*
- `openai/gpt-5.1-codex-max`
- `openai/gpt-5.1-codex-mini`
- `openai/gpt-5.2`
- `openai/gpt-5.1`
- `openai/gpt-5`
- `openai/gpt-4.1`
- `openai/o3`
- `openai/o4-mini`

#### Google
*(from `@mariozechner/pi-ai` catalog — use `google/<id>` in config)*
- `google/gemini-3-pro-preview` *(default)*
- `google/gemini-3-flash-preview`
- `google/gemini-2.5-pro`
- `google/gemini-2.5-flash`
- `google/gemini-2.5-flash-lite`

#### Mistral
*(from `@mariozechner/pi-ai` catalog — use `mistral/<id>` in config)*
- `mistral/mistral-large-latest` *(default)*
- `mistral/mistral-medium-latest`
- `mistral/mistral-small-latest`
- `mistral/devstral-medium-latest`

#### xAI
*(from `@mariozechner/pi-ai` catalog — use `xai/<id>` in config)*
- `xai/grok-4` *(default)*
- `xai/grok-4-fast`
- `xai/grok-4-1-fast`
- `xai/grok-3`
- `xai/grok-3-mini`

#### OpenRouter
- `openrouter/auto` *(default)*

#### Kilocode *(since 2026.2.23)*
- `kilocode/anthropic/claude-opus-4.6` *(default)*

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
6. Update the files above.
7. Run `pnpm test` — all tests must pass.
8. Bump `version` in `package.json` if the catalog change is user-visible.
