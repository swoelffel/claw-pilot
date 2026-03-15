// src/core/config-generator.ts

export interface AgentDefinition {
  id: string;
  name: string;
  model?: string;
  isDefault?: boolean;
  workspace?: string;
}

export interface WizardAnswers {
  slug: string;
  displayName: string;
  port: number;
  agents: AgentDefinition[];
  defaultModel: string;
  provider: string; // e.g. "anthropic" | "openai" | "openrouter" | "google" | "mistral" | "xai" | "opencode"
  apiKey: string; // literal key, "reuse", or "" for opencode
  telegram: {
    enabled: boolean;
    botToken?: string;
  };
  mem0: {
    enabled: boolean;
    ollamaUrl?: string;
    qdrantHost?: string;
    qdrantPort?: number;
  };
}

// Re-export for backward compatibility with callers that import from config-generator.
// Also used locally in generateEnv().
export { PROVIDER_ENV_VARS } from "../lib/providers.js";
import { PROVIDER_ENV_VARS } from "../lib/providers.js";

/** Generate .env content */
export function generateEnv(options: {
  provider: string;
  apiKey: string;
  gatewayToken: string;
  telegramBotToken?: string;
}): string {
  const lines: string[] = [];
  const envVar = PROVIDER_ENV_VARS[options.provider] ?? "";
  if (envVar && options.apiKey) {
    lines.push(`${envVar}=${options.apiKey}`);
  }
  lines.push(`OPENCLAW_GW_AUTH_TOKEN=${options.gatewayToken}`);
  if (options.telegramBotToken) {
    lines.push(`TELEGRAM_BOT_TOKEN=${options.telegramBotToken}`);
  }
  return lines.join("\n") + "\n";
}
