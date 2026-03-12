/**
 * runtime/config/index.ts
 *
 * Runtime configuration schema for claw-runtime.
 *
 * Deliberately simpler than openclaw.json — the dashboard is the primary
 * editing interface, not a hand-edited JSON file.
 *
 * Stored as JSON in the instance state directory: <stateDir>/runtime.json
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** Permission rule */
const PermissionRuleSchema = z.object({
  permission: z.string().min(1),
  pattern: z.string().min(1),
  action: z.enum(["allow", "deny", "ask"]),
});

/** Auth profile config (API key stored in .env, referenced by var name) */
const AuthProfileConfigSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  /** Name of the env var in <stateDir>/.env that holds the API key */
  apiKeyEnvVar: z.string().min(1),
  priority: z.number().int().min(0).default(0),
});

/** Provider config */
const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  /** Override base URL (required for Ollama, optional for others) */
  baseUrl: z.string().url().optional(),
  /** Auth profiles for this provider (multiple = rotation) */
  authProfiles: z.array(AuthProfileConfigSchema).default([]),
  /** Extra HTTP headers */
  headers: z.record(z.string(), z.string()).optional(),
});

/** Agent config */
const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Model in "provider/model" format, e.g. "anthropic/claude-sonnet-4-5" */
  model: z.string().refine((v) => /^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(v), {
    message: 'Must be "provider/model" format',
  }),
  /** System prompt override (if not using a .md file) */
  systemPrompt: z.string().optional(),
  /** Path to a .md file with the system prompt (relative to stateDir) */
  systemPromptFile: z.string().optional(),
  /** Permission ruleset for this agent */
  permissions: z.array(PermissionRuleSchema).default([]),
  /** Temperature (0-2) */
  temperature: z.number().min(0).max(2).optional(),
  /** Max steps before forcing text-only response */
  maxSteps: z.number().int().min(1).max(100).default(20),
  /** Whether this agent can spawn sub-agents */
  allowSubAgents: z.boolean().default(true),
  /** Tool profile */
  toolProfile: z.enum(["minimal", "coding", "messaging", "full"]).default("coding"),
  /** Whether this is the default agent for new sessions */
  isDefault: z.boolean().default(false),
});

/** Telegram channel config */
const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Bot token env var name (stored in .env) */
  botTokenEnvVar: z.string().default("TELEGRAM_BOT_TOKEN"),
  /** Polling interval in ms (0 = use webhook) */
  pollingIntervalMs: z.number().int().min(0).default(1000),
  /** Webhook URL (if using webhook mode) */
  webhookUrl: z.string().url().optional(),
  /** Allowed Telegram user IDs (empty = all paired users) */
  allowedUserIds: z.array(z.number().int()).default([]),
});

/** Web chat config (built-in dashboard channel) */
const WebChatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Max concurrent web chat sessions */
  maxSessions: z.number().int().min(1).max(100).default(10),
});

/** Compaction config */
const CompactionConfigSchema = z.object({
  /** Enable automatic compaction when context window fills */
  auto: z.boolean().default(true),
  /** Fraction of context window to use before triggering compaction (0-1) */
  threshold: z.number().min(0.5).max(0.99).default(0.85),
  /** Number of tokens to reserve for the compaction summary */
  reservedTokens: z.number().int().min(1000).max(50_000).default(8_000),
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

export const RuntimeConfigSchema = z.object({
  /** Schema version for future migrations */
  version: z.literal(1).default(1),

  /** Default model for new agents (provider/model format) */
  defaultModel: z.string().default("anthropic/claude-sonnet-4-5"),

  /** Provider configurations */
  providers: z.array(ProviderConfigSchema).default([]),

  /** Agent definitions */
  agents: z.array(AgentConfigSchema).default([]),

  /** Global permission rules (applied to all agents unless overridden) */
  globalPermissions: z.array(PermissionRuleSchema).default([]),

  /** Telegram channel */
  telegram: TelegramConfigSchema.default(() => ({
    enabled: false,
    botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
    pollingIntervalMs: 1000,
    allowedUserIds: [],
  })),

  /** Web chat channel */
  webChat: WebChatConfigSchema.default(() => ({
    enabled: true,
    maxSessions: 10,
  })),

  /** Compaction settings */
  compaction: CompactionConfigSchema.default(() => ({
    auto: true,
    threshold: 0.85,
    reservedTokens: 8_000,
  })),

  /** Whether to enable MCP tool integration */
  mcpEnabled: z.boolean().default(false),

  /** MCP server configs (stdio only in V1) */
  mcpServers: z
    .array(
      z.object({
        id: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default([]),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type RuntimeAgentConfig = z.infer<typeof AgentConfigSchema>;
export type RuntimeProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RuntimeAuthProfileConfig = z.infer<typeof AuthProfileConfigSchema>;
export type RuntimeTelegramConfig = z.infer<typeof TelegramConfigSchema>;

// ---------------------------------------------------------------------------
// Default config factory
// ---------------------------------------------------------------------------

/** Create a default runtime config for a new instance */
export function createDefaultRuntimeConfig(options: {
  defaultModel?: string;
  telegramEnabled?: boolean;
}): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    version: 1,
    defaultModel: options.defaultModel ?? "anthropic/claude-sonnet-4-5",
    agents: [
      {
        id: "main",
        name: "Main",
        model: options.defaultModel ?? "anthropic/claude-sonnet-4-5",
        isDefault: true,
        toolProfile: "coding",
        maxSteps: 20,
        allowSubAgents: true,
        permissions: [],
        temperature: undefined,
      },
    ],
    telegram: {
      enabled: options.telegramEnabled ?? false,
    },
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Parse and validate a runtime config object. Throws ZodError on failure. */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  return RuntimeConfigSchema.parse(raw);
}

/** Safe parse — returns success/error without throwing */
export function safeParseRuntimeConfig(
  raw: unknown,
): ReturnType<typeof RuntimeConfigSchema.safeParse> {
  return RuntimeConfigSchema.safeParse(raw);
}
