// src/lib/provider-catalog.ts

export interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isDefault?: boolean;
  defaultModel: string;
  models: string[];
}

/**
 * Provider catalog — kept in sync with OpenClaw model registry.
 * Source: src/openclaw/node_modules/@mariozechner/pi-ai/dist/models.generated.js
 * OpenClaw version reference: 2026.3.2
 * Update this catalog on each OpenClaw release (see docs/OPENCLAW-COMPAT.md).
 */
export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    requiresKey: true,
    defaultModel: "anthropic/claude-haiku-4-5",
    models: [
      "anthropic/claude-opus-4-5",
      "anthropic/claude-opus-4-5-20251101",
      "anthropic/claude-opus-4-1",
      "anthropic/claude-opus-4-0",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-0",
      "anthropic/claude-haiku-4-5",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    requiresKey: true,
    defaultModel: "openai/gpt-5.1-codex",
    models: [
      "openai/gpt-5.2",
      "openai/gpt-5.1-codex",
      "openai/gpt-5.1-codex-max",
      "openai/gpt-5.1-codex-mini",
      "openai/gpt-5.1",
      "openai/gpt-5",
      "openai/gpt-5-codex",
      "openai/gpt-5-mini",
      "openai/gpt-5-chat-latest",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
      "openai/o3",
      "openai/o4-mini",
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    requiresKey: true,
    defaultModel: "google/gemini-3-pro-preview",
    models: [
      "google/gemini-3-pro-preview",
      "google/gemini-3-flash-preview",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    requiresKey: true,
    defaultModel: "mistral/mistral-large-latest",
    models: [
      "mistral/mistral-large-latest",
      "mistral/magistral-medium-latest",
      "mistral/magistral-small",
      "mistral/mistral-medium-latest",
      "mistral/mistral-small-latest",
      "mistral/devstral-medium-latest",
      "mistral/devstral-small-2507",
    ],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    requiresKey: true,
    defaultModel: "xai/grok-4",
    models: [
      "xai/grok-4",
      "xai/grok-4-fast",
      "xai/grok-4-1-fast",
      "xai/grok-code-fast-1",
      "xai/grok-3",
      "xai/grok-3-mini",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    requiresKey: true,
    defaultModel: "openrouter/auto",
    models: [
      "openrouter/auto",
    ],
  },
  {
    id: "kilocode",
    label: "Kilocode",
    requiresKey: true,
    defaultModel: "kilocode/anthropic/claude-opus-4.6",
    models: [
      "kilocode/anthropic/claude-opus-4.6",
      "kilocode/anthropic/claude-sonnet-4.5",
      "kilocode/openai/gpt-5.2",
      "kilocode/google/gemini-3-pro-preview",
      "kilocode/google/gemini-3-flash-preview",
      "kilocode/x-ai/grok-code-fast-1",
      "kilocode/moonshotai/kimi-k2.5",
      "kilocode/z-ai/glm-5:free",
      "kilocode/minimax/minimax-m2.5:free",
    ],
  },
  {
    id: "opencode",
    label: "OpenCode Zen (no key)",
    requiresKey: false,
    defaultModel: "opencode/claude-opus-4-6",
    models: [
      "opencode/gpt-5.1-codex",
      "opencode/claude-opus-4-6",
      "opencode/claude-opus-4-5",
      "opencode/gemini-3-pro",
      "opencode/gpt-5.1-codex-mini",
      "opencode/gpt-5.1-codex-max",
      "opencode/gpt-5.1",
      "opencode/glm-4.7",
      "opencode/gemini-3-flash",
      "opencode/gpt-5.2",
    ],
  },
];
