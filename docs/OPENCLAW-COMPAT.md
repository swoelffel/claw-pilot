# OpenClaw Compatibility Reference

This document tracks the OpenClaw version claw-pilot is aligned with, the sources used to
derive provider/model catalogs, and the procedure to update them on each OpenClaw release.

---

## Reference version

**OpenClaw `2026.2.14`**

---

## openclaw.json format (v2026.2.14)

### Required top-level keys

| Key | Notes |
|-----|-------|
| `meta.lastTouchedVersion` | Must match the installed OpenClaw version |
| `meta.lastTouchedAt` | ISO 8601 timestamp |
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
| `agents.defaults.heartbeat` | removed |
| `tools.agentToAgent.agents` | `tools.agentToAgent.allow` (array of IDs) |
| `bindings[].type` | removed |
| `bindings[].path` | removed |
| `bindings[].match.channel` + `match.accountId` | new format |
| `gateway.host` | `gateway.bind` |
| `gateway.auth.type` | `gateway.auth.mode` |
| `env.file` (top-level) | removed |

### Minimal valid config skeleton

```json
{
  "meta": { "lastTouchedVersion": "2026.2.14", "lastTouchedAt": "<ISO>" },
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
      "model": { "primary": "anthropic/claude-sonnet-4-6" },
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

---

## Provider catalog

Derived from:
- `src/openclaw/node_modules/@mariozechner/pi-ai/dist/models.generated.js` — Anthropic, OpenAI, Google model lists
- `src/openclaw/src/agents/opencode-zen-models.ts` — OpenCode Zen static fallback models
- `src/openclaw/src/commands/onboard-auth.models.ts` — Mistral, xAI default models
- `src/openclaw/src/agents/defaults.ts` — `DEFAULT_PROVIDER`, `DEFAULT_MODEL`

### Provider IDs and env vars

| Provider ID | Env var | Base URL |
|-------------|---------|----------|
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `google` | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com/v1beta` |
| `mistral` | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1` |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `opencode` | *(none)* | *(uses auth.profiles)* |

> **Note:** Google's provider ID is `google` (not `gemini`). Models are referenced as
> `google/gemini-...`. The env var is `GOOGLE_API_KEY` (not `GEMINI_API_KEY`).

### Model catalog (as of 2026.2.14)

#### Anthropic
- `anthropic/claude-opus-4-6` *(default)*
- `anthropic/claude-opus-4-5`
- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-haiku-4-5`

#### OpenAI
- `openai/gpt-5.1-codex` *(default)*
- `openai/gpt-5.2`
- `openai/gpt-5.1`
- `openai/gpt-5`
- `openai/gpt-4.1`
- `openai/o3`
- `openai/o4-mini`

#### Google
- `google/gemini-3-pro-preview` *(default)*
- `google/gemini-3-flash-preview`
- `google/gemini-2.5-pro`
- `google/gemini-2.5-flash`

#### Mistral
- `mistral/mistral-large-latest` *(default)*

#### xAI
- `xai/grok-4` *(default)*

#### OpenRouter
- `openrouter/auto` *(default)*

#### OpenCode Zen
- `opencode/claude-opus-4-6` *(default)*
- `opencode/gpt-5.1-codex`
- `opencode/claude-opus-4-5`
- `opencode/gemini-3-pro`
- `opencode/gpt-5.1-codex-mini`
- `opencode/gpt-5.1`
- `opencode/glm-4.7`
- `opencode/gemini-3-flash`
- `opencode/gpt-5.2`

---

## Files to update on each OpenClaw release

| File | What to update |
|------|---------------|
| `src/dashboard/server.ts` | `PROVIDER_CATALOG` — models arrays + defaultModel per provider |
| `src/core/config-generator.ts` | `PROVIDER_ENV_VARS` + `providerDefaults` (baseUrl) |
| `docs/OPENCLAW-COMPAT.md` | This file — version, model lists, format changes |

### Update procedure

1. Check the OpenClaw changelog for breaking config changes (`zod-schema.ts` diff).
2. Re-read `models.generated.js` for updated model IDs.
3. Re-read `onboard-auth.models.ts` for new providers or default model changes.
4. Update the three files above.
5. Run `pnpm test` — all tests must pass.
6. Bump `version` in `package.json` if the catalog change is user-visible.
