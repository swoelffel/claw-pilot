# AI Provider Catalog

ClawPilot supports 8 AI providers out of the box. Each provider connects to one or more large language models and is configured through Named API Keys in the dashboard or CLI. Providers are dynamically discovered and their model lists refreshed every 24 hours.

## Supported Providers

| Provider ID | Display Name | Models (examples) | Auth Method |
|---|---|---|---|
| `anthropic` | Anthropic | claude-sonnet-4-20250514, claude-haiku-4-5-20251001, claude-opus-4-20250514 | API key |
| `openai` | OpenAI | GPT-4o, GPT-4o-mini, o1, o3, o3-mini | API key |
| `google` | Google AI | Gemini 2.5 Pro, Gemini 2.5 Flash | API key |
| `mistral` | Mistral AI | Mistral Large, Mistral Medium, Mistral Small | API key |
| `xai` | xAI | Grok-2, Grok-3 | API key |
| `openrouter` | OpenRouter | Any model (multi-provider proxy) | API key |
| `ollama` | Ollama | Llama 3, Qwen 2, Mistral (local) | None (localhost) |
| `opencode` | OpenAI-compatible | Any OpenAI-compatible endpoint | API key + base URL |

## Dynamic Model Discovery

The runtime polls each configured provider every 24 hours to refresh the list of available models. The model catalog is stored in memory and served through the dashboard API. When a provider is unreachable during polling, the last known model list is retained until the next successful poll.

Endpoints used for discovery:

| Provider | Discovery Endpoint |
|---|---|
| `anthropic` | `GET /v1/models` |
| `openai` | `GET /v1/models` |
| `google` | `GET /v1beta/models` |
| `mistral` | `GET /v1/models` |
| `xai` | `GET /v1/models` |
| `openrouter` | `GET /api/v1/models` |
| `ollama` | `GET /api/tags` (localhost) |
| `opencode` | `GET /v1/models` (custom base URL) |

## Named API Keys

API keys are stored in the `named_api_keys` table, encrypted at rest with AES-256-GCM. Each key has a label, provider ID, and optional model filter. Keys are assigned to instances via `default_named_key_id` or overridden per agent via `named_key_id`.

| Field | Description |
|---|---|
| `id` | Unique identifier (UUID) |
| `label` | Human-readable label (e.g., "Production Anthropic") |
| `provider` | Provider ID from the table above |
| `api_key` | Encrypted API key value |
| `base_url` | Custom endpoint URL (opencode provider only) |
| `created_at` | Timestamp of creation |

## Auth Profiles and Key Rotation

Auth profiles allow multiple API keys per provider with priority-based rotation. When a key encounters an authentication failure or rate limit, it enters a cooldown period and the next key in priority order is used automatically.

| Feature | Description |
|---|---|
| Priority ordering | Keys are tried in descending priority order |
| Cooldown on failure | Failed keys are temporarily disabled (configurable duration) |
| Failure tracking | Consecutive failures tracked per key in `rt_auth_profiles` |
| Automatic recovery | Cooled-down keys are retried after the cooldown window expires |
| Provider failover | `provider.auth_failed` and `provider.failover` bus events emitted |

## Ollama (Local Models)

Ollama requires no API key. It connects to a local Ollama server running on `http://localhost:11434` by default. Models must be pulled locally before use (`ollama pull llama3`). The base URL can be overridden in the Named API Key configuration for remote Ollama servers.

## OpenCode (OpenAI-Compatible)

The `opencode` provider supports any endpoint that implements the OpenAI chat completions API. Configure with both an API key and a custom base URL. Common use cases include Azure OpenAI, LiteLLM proxies, and self-hosted inference servers.

## Provider Selection

Instances inherit the default Named API Key from their configuration. Individual agents can override the provider by setting their own `named_key_id`. The model specified in an agent's config must be available from the provider associated with the assigned key.

## User Model Aliases

Users can define model aliases in the `user_model_aliases` table, mapping a short name (e.g., "fast") to a specific provider and model combination. Aliases are resolved at message-send time and allow quick switching between models without editing agent configuration.

| Column | Type | Description |
|---|---|---|
| `user_id` | TEXT | User who owns the alias |
| `alias` | TEXT | Short name (e.g., "fast", "cheap", "smart") |
| `provider` | TEXT | Provider ID to resolve to |
| `model` | TEXT | Full model identifier |

## Provider Health Monitoring

Provider connectivity is monitored at runtime. When all keys for a provider fail, the runtime emits a `provider.auth_failed` bus event and the dashboard displays a warning badge on affected instances. Recovery is automatic once a key exits its cooldown window or a new valid key is added.

*ClawPilot v0.74.1*
