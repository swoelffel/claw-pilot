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
  anthropicApiKey: "reuse" | string;
  telegram: {
    enabled: boolean;
    botToken?: string;
  };
  nginx: {
    enabled: boolean;
    domain?: string;
    certPath?: string;
    keyPath?: string;
  };
  mem0: {
    enabled: boolean;
    ollamaUrl?: string;
    qdrantHost?: string;
    qdrantPort?: number;
  };
}

export function generateConfig(answers: WizardAnswers): string {
  const nonMainAgents = answers.agents.filter((a) => !a.isDefault && a.id !== "main");

  // Build agents list
  const agentsList = nonMainAgents.map((agent) => {
    const entry: Record<string, unknown> = {
      id: agent.id,
      name: agent.name,
      workspace: agent.workspace ?? `workspace-${agent.id}`,
    };
    if (agent.model) {
      entry["model"] = agent.model;
    }
    return entry;
  });

  // Build agentToAgent tools (all agents can talk to each other)
  const allAgentIds = answers.agents.map((a) => a.id);
  const agentToAgentConfig = allAgentIds.reduce(
    (acc, id) => {
      acc[id] = { enabled: true };
      return acc;
    },
    {} as Record<string, { enabled: boolean }>,
  );

  // Build bindings (webchat per non-main agent)
  const bindings: Record<string, unknown>[] = nonMainAgents.map((agent) => ({
    type: "webchat",
    agentId: agent.id,
    path: `/${agent.id}`,
  }));

  const config: Record<string, unknown> = {
    meta: {
      slug: answers.slug,
      name: answers.displayName,
      version: "1",
    },
    env: {
      file: ".env",
    },
    models: {
      providers: {
        anthropic: {
          apiKey: "${ANTHROPIC_API_KEY}",
          models: [
            "claude-sonnet-4-6",
            "claude-opus-4-6",
            "claude-haiku-4-5-20251001",
          ],
        },
      },
    },
    agents: {
      defaults: {
        model: answers.defaultModel,
        workspace: "workspace",
        cache: true,
        heartbeat: {
          enabled: true,
          intervalMs: 30000,
        },
      },
      ...(agentsList.length > 0 ? { list: agentsList } : {}),
    },
    tools: {
      profile: "coding",
      agentToAgent: {
        enabled: true,
        agents: agentToAgentConfig,
      },
    },
    ...(bindings.length > 0 ? { bindings } : {}),
    gateway: {
      port: answers.port,
      host: "127.0.0.1",
      auth: {
        type: "token",
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
        botToken: "${TELEGRAM_BOT_TOKEN}",
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
  anthropicApiKey: string;
  gatewayToken: string;
  telegramBotToken?: string;
}): string {
  const lines = [
    `ANTHROPIC_API_KEY=${options.anthropicApiKey}`,
    `OPENCLAW_GW_AUTH_TOKEN=${options.gatewayToken}`,
  ];
  if (options.telegramBotToken) {
    lines.push(`TELEGRAM_BOT_TOKEN=${options.telegramBotToken}`);
  }
  return lines.join("\n") + "\n";
}
