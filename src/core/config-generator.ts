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
  provider: string;   // e.g. "anthropic" | "openai" | "openrouter" | "google" | "mistral" | "xai" | "opencode"
  apiKey: string;     // literal key, "reuse", or "" for opencode
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

export const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic:  "ANTHROPIC_API_KEY",
  openai:     "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  google:     "GOOGLE_API_KEY",
  mistral:    "MISTRAL_API_KEY",
  xai:        "XAI_API_KEY",
  kilocode:   "KILOCODE_API_KEY",
  opencode:   "",
};

export function generateConfig(answers: WizardAnswers): string {
  const nonMainAgents = answers.agents.filter((a) => !a.isDefault && a.id !== "main");
  const allAgentIds = answers.agents.map((a) => a.id);

  // Build agents list (v2026.2.24 format)
  const agentsList = nonMainAgents.map((agent) => {
    const entry: Record<string, unknown> = {
      id: agent.id,
      name: agent.name,
      workspace: agent.workspace ?? `workspace-${agent.id}`,
    };
    if (agent.model) {
      // model as object: { primary: "provider/model" }
      entry["model"] = { primary: agent.model };
    }
    return entry;
  });

  // Build bindings (v2026.2.24: match.channel + match.accountId)
  const bindings: Record<string, unknown>[] = nonMainAgents.map((agent) => ({
    agentId: agent.id,
    match: {
      channel: "webchat",
      accountId: agent.id,
    },
  }));

  // Build provider config block (v2026.2.24: baseUrl + models array required)
  const envVar = PROVIDER_ENV_VARS[answers.provider] ?? "";
  const providerBlock: Record<string, unknown> = {};

  if (answers.provider === "opencode" || answers.provider === "kilocode") {
    // opencode and kilocode use auth.profiles, no providers block needed
  } else if (envVar) {
    const providerDefaults: Record<string, { baseUrl: string }> = {
      anthropic:  { baseUrl: "https://api.anthropic.com" },
      openai:     { baseUrl: "https://api.openai.com/v1" },
      openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
      google:     { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
      mistral:    { baseUrl: "https://api.mistral.ai/v1" },
      xai:        { baseUrl: "https://api.x.ai/v1" },
    };
    providerBlock[answers.provider] = {
      apiKey: `\${${envVar}}`,
      baseUrl: providerDefaults[answers.provider]?.baseUrl ?? "",
      models: [],
    };
  }

  // model default as object (v2026.2.24)
  const defaultModelObj = { primary: answers.defaultModel };

  // auth block: opencode and kilocode use profiles, others use providers
  const authBlock: Record<string, unknown> = answers.provider === "opencode"
    ? {
        profiles: {
          "opencode:default": {
            provider: "opencode",
            mode: "api_key",
          },
        },
      }
    : answers.provider === "kilocode"
    ? {
        profiles: {
          "kilocode:default": {
            provider: "kilocode",
            mode: "api_key",
          },
        },
      }
    : {};

  const config: Record<string, unknown> = {
    meta: {
      lastTouchedVersion: "2026.2.24",
      lastTouchedAt: new Date().toISOString(),
    },
    ...(Object.keys(authBlock).length > 0 ? { auth: authBlock } : {}),
    ...(Object.keys(providerBlock).length > 0 ? { models: { providers: providerBlock } } : {}),
    agents: {
      defaults: {
        model: defaultModelObj,
        workspace: "workspace",
        subagents: {
          maxConcurrent: 4,
          archiveAfterMinutes: 60,
        },
      },
      ...(agentsList.length > 0 ? { list: agentsList } : {}),
    },
    tools: {
      profile: "coding",
      agentToAgent: {
        enabled: true,
        allow: allAgentIds,
      },
    },
    ...(bindings.length > 0 ? { bindings } : {}),
    gateway: {
      port: answers.port,
      mode: "local",
      bind: "loopback",
      auth: {
        mode: "token",
        token: "${OPENCLAW_GW_AUTH_TOKEN}",
      },
      trustedProxies: ["127.0.0.1"],
    },
  };

  // Telegram
  if (answers.telegram.enabled && answers.telegram.botToken) {
    config["channels"] = {
      telegram: {
        enabled: true,
        dmPolicy: "pairing",
        botToken: "${TELEGRAM_BOT_TOKEN}",
        groupPolicy: "allowlist",
        streamMode: "partial",
      },
    };
  }

  // mem0
  if (answers.mem0.enabled) {
    config["plugins"] = {
      "@mem0/openclaw-mem0": {
        enabled: true,
        ollama: {
          url: answers.mem0.ollamaUrl ?? "http://127.0.0.1:11434",
          embeddingModel: "nomic-embed-text",
        },
        qdrant: {
          host: answers.mem0.qdrantHost ?? "127.0.0.1",
          port: answers.mem0.qdrantPort ?? 6333,
          collectionName: `openclaw-mem0-${answers.slug}`,
        },
        mem0Config: {
          version: "v1.1",
        },
      },
    };
  }

  return JSON.stringify(config, null, 2);
}

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
