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
  /** When set, the provisioner uses team-import instead of manual agent creation. */
  blueprintTeamFile?: import("./team-schema.js").TeamFile;
}

// Re-export for callers that import from config-generator (wizard, provisioner).
export { PROVIDER_ENV_VARS } from "../lib/providers.js";

/** Generate .env content (gateway token + optional telegram bot token) */
export function generateEnv(options: { gatewayToken: string; telegramBotToken?: string }): string {
  const lines: string[] = [];
  lines.push(`OPENCLAW_GW_AUTH_TOKEN=${options.gatewayToken}`);
  if (options.telegramBotToken) {
    lines.push(`TELEGRAM_BOT_TOKEN=${options.telegramBotToken}`);
  }
  return lines.join("\n") + "\n";
}
