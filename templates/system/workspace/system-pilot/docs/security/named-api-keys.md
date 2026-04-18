# Named API Keys

Centralized, encrypted API key management for LLM providers. Named API Keys store provider credentials globally and assign them to instances or individual agents, eliminating the need to configure API keys per instance.

## Key Concepts

- **Global scope**: Named keys are not tied to a single instance. One key can serve multiple instances.
- **Encrypted storage**: Keys are encrypted at rest using AES-256-GCM via the `MASTER_ENCRYPTION_KEY`.
- **Assignment hierarchy**: A default key is set on the instance; individual agents can override with a different key.

## Supported Providers

| Provider | Provider ID | Models |
|----------|-------------|--------|
| Anthropic | `anthropic` | Claude family (Haiku, Sonnet, Opus) |
| OpenAI | `openai` | GPT-4o, GPT-4, GPT-3.5, o1, o3 |
| Google | `google` | Gemini family |
| Mistral | `mistral` | Mistral, Mixtral, Codestral |
| xAI | `xai` | Grok family |
| OpenRouter | `openrouter` | Multi-provider routing |
| Ollama | `ollama` | Local models (no API key required) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/named-keys` | Create a new named key |
| GET | `/api/named-keys` | List all named keys (values masked) |
| PUT | `/api/named-keys/:id` | Update a named key |
| DELETE | `/api/named-keys/:id` | Delete a named key |

### Create Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Human-readable key name (e.g., "Production Anthropic") |
| providerId | string | yes | Provider identifier from the table above |
| apiKey | string | yes | The actual API key value |
| defaultModel | string | no | Default model to use with this key |

### List Response

The GET endpoint returns all named keys with the `apiKey` field masked (only last 4 characters visible). Full key values are never exposed through the API after creation.

## Encryption

Named API Keys are encrypted using AES-256-GCM symmetric encryption. The encryption key is the `MASTER_ENCRYPTION_KEY` generated during `claw-pilot init` and stored in `~/.claw-pilot/`.

Each key record stores:
- Encrypted API key ciphertext
- Initialization vector (IV)
- Authentication tag
- Provider ID and metadata (unencrypted)

The master key never leaves the server. API key values are decrypted in memory only when needed for provider authentication.

## Assignment

### Instance Default

Set a default named key for an instance by configuring `default_named_key_id` on the instance record. All agents in the instance use this key unless overridden.

### Agent Override

Override the instance default for a specific agent by setting `named_key_id` in the agent configuration. This allows different agents to use different providers or different API keys for the same provider.

### Resolution Order

When an agent makes an LLM request, the key is resolved as:

1. Agent-level `named_key_id` (if set)
2. Instance-level `default_named_key_id` (if set)
3. Error: no key configured

## Dashboard UI

The Named Keys panel in the dashboard provides:

- List view of all named keys with provider, name, and masked key value
- Create dialog with provider selection and key input
- Edit dialog to update key name, provider, API key, or default model
- Delete confirmation dialog
- Assignment UI on instance and agent configuration panels

## Security Considerations

- API key values are encrypted at rest and masked in all API responses
- The `MASTER_ENCRYPTION_KEY` should be backed up securely; losing it means named keys cannot be decrypted
- Rotate API keys by updating the named key record (all instances using that key pick up the change immediately)
- Deleting a named key that is assigned to instances will cause LLM requests to fail until a new key is assigned

## Troubleshooting

If agents fail with authentication errors:
1. Verify the named key exists and is assigned to the instance or agent
2. Check that the API key value is valid with the provider
3. Ensure the provider ID matches the model being requested
4. Verify the `MASTER_ENCRYPTION_KEY` file exists in `~/.claw-pilot/`

*ClawPilot v0.74.1*
