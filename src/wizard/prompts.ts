// src/wizard/prompts.ts
import { input, select, confirm, password } from "@inquirer/prompts";
import type { Registry, InstanceRecord } from "../core/registry.js";
import type { PortAllocator } from "../core/port-allocator.js";
import type { AgentDefinition } from "../core/config-generator.js";
import { PROVIDER_ENV_VARS } from "../core/config-generator.js";

export async function promptSlug(
  registry: Registry,
): Promise<{ slug: string; displayName: string }> {
  const slug = await input({
    message: "Instance slug (lowercase, no spaces):",
    validate: (value) => {
      if (!/^[a-z][a-z0-9-]*$/.test(value))
        return "Slug must be lowercase alphanumeric with hyphens";
      if (value.length < 2 || value.length > 30)
        return "Slug must be 2-30 characters";
      if (registry.getInstance(value))
        return `Instance "${value}" already exists`;
      return true;
    },
  });

  const displayName = await input({
    message: "Display name:",
    default: slug.charAt(0).toUpperCase() + slug.slice(1),
  });

  return { slug, displayName };
}

export async function promptPort(
  portAllocator: PortAllocator,
  serverId: number,
): Promise<number> {
  const suggested = await portAllocator.findFreePort(serverId);

  const portStr = await input({
    message: `Gateway port (auto: ${suggested}):`,
    default: String(suggested),
    validate: async (value) => {
      const port = parseInt(value);
      if (isNaN(port) || port < 1024 || port > 65535)
        return "Invalid port number";
      const free = await portAllocator.verifyPort(serverId, port);
      if (!free) return `Port ${port} is already in use`;
      return true;
    },
  });

  return parseInt(portStr);
}

export async function promptAgents(): Promise<{
  mode: "custom" | "minimal";
  agents: AgentDefinition[];
}> {
  const mode = await select<"custom" | "minimal">({
    message: "How do you want to configure agents?",
    choices: [
      { value: "custom", name: "Custom (define agents one by one)" },
      { value: "minimal", name: "Minimal (main agent only)" },
    ],
  });

  if (mode === "minimal") {
    return {
      mode,
      agents: [{ id: "main", name: "Main", isDefault: true }],
    };
  }

  // Custom mode: loop to add agents
  const agents: AgentDefinition[] = [
    { id: "main", name: "Main", isDefault: true },
  ];
  let addMore = true;

  while (addMore) {
    const agentId = await input({
      message: "Agent ID (e.g., pm, dev-back):",
      validate: (v) => {
        if (!/^[a-z][a-z0-9-]*$/.test(v))
          return "Must be lowercase alphanumeric with hyphens";
        if (agents.some((a) => a.id === v)) return "Agent ID already used";
        return true;
      },
    });

    const name = await input({ message: "Agent name:" });

    const modelOverride = await input({
      message: "Model override (enter to use default):",
      default: "",
    });

    agents.push({
      id: agentId,
      name,
      model: modelOverride || undefined,
    });

    addMore = await confirm({ message: "Add another agent?", default: true });
  }

  return { mode, agents };
}

export async function promptModel(): Promise<string> {
  return select<string>({
    message: "Default model for agents:",
    choices: [
      {
        value: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6 (recommended)",
      },
      { value: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" },
      {
        value: "anthropic/claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
      },
    ],
  });
}

export async function promptProvider(
  existingInstances: InstanceRecord[],
): Promise<{ provider: string; apiKey: string }> {
  // Build provider choices
  const providerChoices = [
    { value: "anthropic",  name: "Anthropic (Claude)" },
    { value: "openai",     name: "OpenAI (GPT)" },
    { value: "openrouter", name: "OpenRouter" },
    { value: "gemini",     name: "Google Gemini" },
    { value: "mistral",    name: "Mistral" },
    { value: "opencode",   name: "OpenCode (no API key needed)" },
  ];

  const provider = await select<string>({
    message: "AI provider:",
    choices: providerChoices,
  });

  // opencode needs no API key
  if (provider === "opencode") {
    return { provider, apiKey: "" };
  }

  const envVar = PROVIDER_ENV_VARS[provider] ?? "";

  // Offer reuse if there are existing instances
  if (existingInstances.length > 0) {
    const source = await select<"reuse" | "new">({
      message: `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key:`,
      choices: [
        {
          value: "reuse",
          name: `Reuse from existing instance (${existingInstances[0]?.slug})`,
        },
        { value: "new", name: "Enter new key" },
      ],
    });
    if (source === "reuse") return { provider, apiKey: "reuse" };
  }

  const apiKey = await password({
    message: `${envVar || "API"} key:`,
  });

  return { provider, apiKey };
}

/** @deprecated Use promptProvider instead */
export async function promptApiKey(
  existingInstances: InstanceRecord[],
): Promise<"reuse" | string> {
  if (existingInstances.length > 0) {
    const source = await select<"reuse" | "new">({
      message: "Anthropic API key:",
      choices: [
        {
          value: "reuse",
          name: `Reuse from existing instance (${existingInstances[0]?.slug})`,
        },
        { value: "new", name: "Enter new key" },
      ],
    });
    if (source === "reuse") return "reuse";
  }

  return password({ message: "Anthropic API key:" });
}

export async function promptTelegram(): Promise<{
  enabled: boolean;
  botToken?: string;
}> {
  const enabled = await confirm({
    message: "Enable Telegram bot?",
    default: false,
  });
  if (!enabled) return { enabled: false };

  const botToken = await password({ message: "Telegram bot token:" });
  return { enabled: true, botToken };
}

export async function promptNginx(): Promise<{
  enabled: boolean;
  domain?: string;
  certPath?: string;
  keyPath?: string;
}> {
  const enabled = await confirm({
    message: "Configure Nginx reverse proxy?",
    default: false,
  });
  if (!enabled) return { enabled: false };

  const domain = await input({
    message: "Domain name:",
    validate: (v) => (v.includes(".") ? true : "Must be a valid domain"),
  });

  const certPath = await input({
    message: "SSL certificate path:",
    default: "/etc/letsencrypt/live/wcasldspv54l.hunik.io/fullchain.pem",
  });

  const keyPath = await input({
    message: "SSL key path:",
    default: "/etc/letsencrypt/live/wcasldspv54l.hunik.io/privkey.pem",
  });

  return { enabled: true, domain, certPath, keyPath };
}

export async function promptMem0(
  conn: { exec: (cmd: string) => Promise<{ stdout: string }> },
): Promise<{ enabled: boolean; ollamaUrl?: string; qdrantHost?: string; qdrantPort?: number }> {
  // Auto-detect Ollama and Qdrant
  const [ollamaResult, qdrantResult] = await Promise.all([
    conn.exec("curl -s http://127.0.0.1:11434/api/version 2>/dev/null || true"),
    conn.exec("curl -s http://127.0.0.1:6333/healthz 2>/dev/null || true"),
  ]);

  const ollamaDetected = !!ollamaResult.stdout.trim();
  const qdrantDetected = qdrantResult.stdout.includes("ok");

  const autoMsg =
    ollamaDetected && qdrantDetected
      ? " (Ollama + Qdrant detected)"
      : ollamaDetected
        ? " (Ollama detected, Qdrant not found)"
        : " (Ollama + Qdrant not found)";

  const enabled = await confirm({
    message: `Enable mem0 memory plugin?${autoMsg}`,
    default: ollamaDetected && qdrantDetected,
  });

  if (!enabled) return { enabled: false };

  const ollamaUrl = await input({
    message: "Ollama URL:",
    default: "http://127.0.0.1:11434",
  });

  const qdrantHost = await input({
    message: "Qdrant host:",
    default: "127.0.0.1",
  });

  const qdrantPortStr = await input({
    message: "Qdrant port:",
    default: "6333",
  });

  return {
    enabled: true,
    ollamaUrl,
    qdrantHost,
    qdrantPort: parseInt(qdrantPortStr),
  };
}
