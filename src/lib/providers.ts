// src/lib/providers.ts
// Single source of truth for provider metadata (env vars, base URLs).

/** Maps provider ID to the environment variable holding its API key. */
export const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  kilocode: "KILOCODE_API_KEY",
  opencode: "OPENCODE_API_KEY",
};

/** Maps provider ID to its API base URL. */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
};
