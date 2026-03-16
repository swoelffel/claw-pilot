/**
 * runtime/config/index.ts
 *
 * Runtime configuration schema for claw-runtime.
 *
 * The dashboard is the primary editing interface, not a hand-edited JSON file.
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

/** Heartbeat config for periodic agent tasks */
const HeartbeatConfigSchema = z.object({
  /** Interval between heartbeat runs. Examples: "5m", "30m", "1h", "24h" */
  every: z.enum(["5m", "10m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "24h"]),
  /** Custom prompt sent to the agent. If absent, the agent reads HEARTBEAT.md */
  prompt: z.string().optional(),
  /** Active hours restriction */
  activeHours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
      end: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
      tz: z.string().min(1),
    })
    .optional(),
  /** Model override for heartbeat runs (e.g. a cheaper/faster model) */
  model: z
    .string()
    .refine((v) => /^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(v), {
      message: 'Must be "provider/model" format',
    })
    .optional(),
  /** Max chars for HEARTBEAT_OK acknowledgement (default: 500) */
  ackMaxChars: z.number().int().min(1).optional(),
});

/**
 * Named model alias — maps a short identifier to a provider/model pair.
 * Allows agents to reference models by alias (e.g. "fast") instead of
 * the full "provider/model" string.
 */
const ModelAliasSchema = z.object({
  /** Short identifier used in agent config (e.g. "fast", "smart", "local") */
  id: z.string().min(1),
  /** Provider ID (e.g. "anthropic", "openai", "ollama") */
  provider: z.string().min(1),
  /** Model ID (e.g. "claude-haiku-3-5", "gpt-4o-mini") */
  model: z.string().min(1),
  /** Optional context window override (tokens). Overrides the catalog value. */
  contextWindow: z.number().int().min(1).optional(),
});

/** Agent config */
const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * Model reference — either "provider/model" format (e.g. "anthropic/claude-sonnet-4-5")
   * or a named alias defined in RuntimeConfig.models (e.g. "fast", "smart").
   */
  model: z.string().min(1),
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
  /**
   * Controls which workspace files are injected into the system prompt.
   * - "full": all files including BOOTSTRAP.md and HEARTBEAT.md (default for primary agents)
   * - "minimal": core files only, excludes HEARTBEAT.md
   * - "subagent": method files only (AGENTS.md, TOOLS.md) — for ephemeral subagents
   * If omitted, inferred from kind: primary→full, subagent→subagent.
   */
  promptMode: z.enum(["full", "minimal", "subagent"]).optional(),
  /**
   * Extra URLs to fetch and append to the system prompt after workspace discovery.
   * Useful for sharing team standards or context across instances.
   * Each URL is fetched with a 5s timeout; failures are silently ignored.
   */
  instructionUrls: z.array(z.string().url()).optional(),
  /** Whether this is the default agent for new sessions */
  isDefault: z.boolean().default(false),
  /** Max duration for a single prompt loop run in ms. Default: 300000 (5 min). */
  timeoutMs: z.number().int().min(1000).optional(),
  /**
   * Max time (ms) between consecutive SSE chunks before the stream is aborted.
   * Prevents sessions from hanging when the LLM provider stalls silently.
   * Default: 120000 (2 min).
   */
  chunkTimeoutMs: z.number().int().min(5000).optional(),
  /** Heartbeat configuration for periodic autonomous tasks */
  heartbeat: HeartbeatConfigSchema.optional(),
  /**
   * If true (default), sub-agents spawned by this agent inherit the parent's workDir.
   * Set to false to give the sub-agent its own isolated workspace.
   * Defaults to true when not specified.
   */
  inheritWorkspace: z.boolean().optional(),
  /**
   * Additional files to inject into the system prompt, as glob patterns relative to
   * the agent's workspace directory. Loaded after DISCOVERY_FILES.
   * Example: ["project-context.md", "docs/architecture/*.md"]
   */
  bootstrapFiles: z.array(z.string()).optional(),
  /**
   * URLs pointing to remote skill index files (JSON).
   * Skills are downloaded and cached locally in ~/.cache/claw-pilot/skills/.
   * Index format: { "skills": [{ "name": "...", "description": "...", "url": "..." }] }
   * Failures are silently ignored — a missing URL must not block session startup.
   */
  skillUrls: z.array(z.string().url()).optional(),
  /**
   * Extended thinking configuration (Anthropic only).
   * When enabled, the model uses a dedicated reasoning phase before responding.
   * Useful for complex planning and architecture tasks.
   * Disabled by default — has higher cost and latency.
   */
  thinking: z
    .object({
      enabled: z.boolean().default(false),
      /**
       * Token budget for the thinking phase (1024–100000).
       * Default: 10000 tokens.
       */
      budgetTokens: z.number().int().min(1024).max(100_000).optional(),
    })
    .optional(),
  /**
   * Agent-to-agent spawn policy.
   * Controls which sub-agents this agent is allowed to spawn via the task tool.
   */
  agentToAgent: z
    .object({
      /** Whether this agent can spawn sub-agents at all (default: true) */
      enabled: z.boolean().default(true),
      /**
       * Whitelist of agent IDs this agent can spawn.
       * ["*"] = all agents (default behavior).
       * If absent, all agents are allowed (same as ["*"]).
       */
      allowList: z.array(z.string().min(1)).min(1).optional(),
    })
    .optional(),
  /**
   * Session lifecycle for this agent.
   * - "permanent": single long-lived session per user, maintained across restarts
   *   via intelligent compaction and long-term memory extraction.
   * - "ephemeral": new session per task, archived after completion (default for subagents).
   * If omitted, inferred from 'kind' (set in Agent.Info): primary→permanent, subagent→ephemeral.
   */
  persistence: z
    .enum(["permanent", "ephemeral"])
    .optional()
    .describe(
      "Session lifecycle for this agent. " +
        "'permanent': single long-lived session per user, maintained across restarts " +
        "via intelligent compaction and long-term memory extraction. " +
        "'ephemeral': new session per task, archived after completion (default for subagents). " +
        "If omitted, inferred from 'kind': primary→permanent, subagent→ephemeral, all→ephemeral.",
    ),
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
  /** DM policy: pairing (code approval), open (all), allowlist (static IDs), disabled */
  dmPolicy: z.enum(["pairing", "open", "allowlist", "disabled"]).default("pairing"),
  /** Group policy: open (all groups), allowlist (static IDs), disabled */
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
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

/** Sub-agents spawn limits */
const SubagentsConfigSchema = z.object({
  /** Max spawn depth (0 = root only, 1 = one level of sub-agents, etc.) */
  maxSpawnDepth: z.number().int().min(0).max(10).default(3),
  /** Max simultaneous active children per session */
  maxChildrenPerSession: z.number().int().min(1).max(20).default(5),
  /** Hours to retain archived ephemeral sessions before cleanup. 0 = keep forever (no cleanup). Default: 72 (3 days). */
  retentionHours: z
    .number()
    .min(0)
    .default(72)
    .describe(
      "Hours to retain archived ephemeral sessions before cleanup. " +
        "0 = keep forever (no cleanup). Default: 72 (3 days).",
    ),
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

export const RuntimeConfigSchema = z.object({
  /** Schema version for future migrations */
  version: z.literal(1).default(1),

  /** Default model for new agents (provider/model format) */
  defaultModel: z.string().default("anthropic/claude-sonnet-4-5"),

  /**
   * Default model for internal agents (compaction, title, summary).
   * If set, these agents use this model instead of the instance defaultModel.
   * Useful to assign a cheaper/faster model for simple internal tasks.
   * Format: "provider/model" or a named alias from models[].
   */
  defaultInternalModel: z.string().optional(),

  /**
   * Named model aliases — map short identifiers to provider/model pairs.
   * Agents can reference these by alias instead of the full "provider/model" string.
   * Example: [{ id: "fast", provider: "anthropic", model: "claude-haiku-3-5" }]
   */
  models: z.array(ModelAliasSchema).default([]),

  /** Provider configurations */
  providers: z.array(ProviderConfigSchema).default([]),

  /** Agent definitions */
  agents: z.array(AgentConfigSchema).default([]),

  /** Global permission rules (applied to all agents unless overridden) */
  globalPermissions: z.array(PermissionRuleSchema).default([]),

  /** Telegram channel */
  telegram: TelegramConfigSchema.default(() => ({
    enabled: false as boolean,
    botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
    pollingIntervalMs: 1000,
    allowedUserIds: [] as number[],
    dmPolicy: "pairing" as "pairing" | "open" | "allowlist" | "disabled",
    groupPolicy: "allowlist" as "open" | "allowlist" | "disabled",
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

  /** Sub-agents spawn limits */
  subagents: SubagentsConfigSchema.default(() => ({
    maxSpawnDepth: 3,
    maxChildrenPerSession: 5,
    retentionHours: 72,
  })),

  /** Whether to enable MCP tool integration */
  mcpEnabled: z.boolean().default(false),

  /** MCP server configs — stdio (local) or HTTP (remote) */
  mcpServers: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("local"),
          id: z.string().min(1),
          /** Command to run, e.g. "npx" */
          command: z.string().min(1),
          args: z.array(z.string()).default([]),
          env: z.record(z.string(), z.string()).optional(),
          /** Connection timeout in ms (default 30s) */
          timeout: z.number().int().min(1000).default(30_000),
          enabled: z.boolean().default(true),
        }),
        z.object({
          type: z.literal("remote"),
          id: z.string().min(1),
          /** HTTP(S) URL of the MCP server */
          url: z.string().url(),
          /** Extra request headers */
          headers: z.record(z.string(), z.string()).optional(),
          /** Connection timeout in ms (default 30s) */
          timeout: z.number().int().min(1000).default(30_000),
          enabled: z.boolean().default(true),
        }),
      ]),
    )
    .default([]),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type RuntimeAgentConfig = z.infer<typeof AgentConfigSchema>;
/** @public */
export type AgentToAgentConfig = z.infer<typeof AgentConfigSchema>["agentToAgent"];
/** @public */
export type ModelAlias = z.infer<typeof ModelAliasSchema>;
/** @public */
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
/** @public */
export type RuntimeProviderConfig = z.infer<typeof ProviderConfigSchema>;
/** @public */
export type RuntimeAuthProfileConfig = z.infer<typeof AuthProfileConfigSchema>;
/** @public */
export type RuntimeTelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type RuntimeMcpServerConfig = RuntimeConfig["mcpServers"][number];
export type SubagentsConfig = z.infer<typeof SubagentsConfigSchema>;

/** Resolved session lifecycle type for an agent */
export type AgentPersistence = "permanent" | "ephemeral";

/**
 * Resolve the effective persistence for an agent config.
 * Returns the explicit value if set, otherwise "ephemeral" as safe default.
 * The definitive resolution (using Agent.Info.kind) is done in initAgentRegistry()
 * via resolveEffectivePersistence().
 * @public
 */
export function resolveAgentPersistence(config: RuntimeAgentConfig): AgentPersistence {
  // Explicit value — absolute priority
  if (config.persistence !== undefined) return config.persistence;
  // Safe default — will be overridden by initAgentRegistry() using kind
  return "ephemeral";
}

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
