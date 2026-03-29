// src/dashboard/routes/instances/config-schemas.ts
// Types and validation schemas for instance configuration
import { z } from "zod";

// ProviderEntry — matches ui/src/types.ts
export interface ProviderEntry {
  id: string;
  label: string;
  envVar: string;
  apiKeyMasked: string | null;
  apiKeySet: boolean;
  requiresKey: boolean;
  baseUrl: string | null;
  source: "models" | "auth";
}

// InstanceConfig type — matches ui/src/types.ts
export interface InstanceConfig {
  general: {
    displayName: string;
    defaultModel: string;
    port: number;
  };
  providers: ProviderEntry[];
  agentDefaults: {
    compaction: { mode: string; threshold: number; reservedTokens: number };
    subagents: { maxSpawnDepth: number; maxChildrenPerSession: number; retentionHours: number };
    heartbeat: { every?: string; model?: string };
    defaultInternalModel: string;
    models: Array<{ id: string; provider: string; model: string }>;
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    toolProfile: string;
    maxSteps: number;
    temperature: number | null;
    thinking: { enabled: boolean; budgetTokens: number } | null;
    timeoutMs: number;
    chunkTimeoutMs: number;
    promptMode: string;
    allowSubAgents: boolean;
    instructionUrls: string[];
    bootstrapFiles: string[];
    archetype: string | null;
    heartbeat: {
      every?: string;
      model?: string;
      ackMaxChars?: number;
      prompt?: string;
      activeHours?: { start: string; end: string; tz?: string };
    } | null;
  }>;
  channels: {
    telegram: {
      enabled: boolean;
      botTokenMasked: string | null;
      dmPolicy: string;
      groupPolicy: string;
      streamMode?: string;
    } | null;
  };
  plugins: {
    mem0: {
      enabled: boolean;
      ollamaUrl: string;
      qdrantHost: string;
      qdrantPort: number;
    } | null;
  };
  gateway: {
    port: number;
  };
}

// ---------------------------------------------------------------------------
// Config patch schema for runtime instances
// ---------------------------------------------------------------------------

export const RuntimeConfigPatchSchema = z.object({
  general: z
    .object({
      displayName: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
  providers: z
    .object({
      add: z
        .array(
          z.object({
            id: z.string().min(1),
            apiKey: z.string().optional(),
            baseUrl: z.string().url().optional(),
          }),
        )
        .optional(),
      update: z
        .array(
          z.object({
            id: z.string().min(1),
            apiKey: z.string().optional(),
            baseUrl: z.string().url().nullish(),
          }),
        )
        .optional(),
      remove: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  channels: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().optional(),
          botTokenEnvVar: z.string().optional(),
          pollingIntervalMs: z.number().int().min(0).optional(),
          allowedUserIds: z.array(z.number().int()).optional(),
          dmPolicy: z.enum(["pairing", "open", "allowlist", "disabled"]).optional(),
          groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
        })
        .optional(),
    })
    .optional(),
  // agentDefaults: top-level runtime.json fields (compaction, subagents, models)
  agentDefaults: z
    .object({
      compaction: z
        .object({
          mode: z.enum(["auto", "manual"]).optional(),
          threshold: z.number().min(0.1).max(0.99).optional(),
          reservedTokens: z.number().int().min(0).optional(),
        })
        .optional(),
      subagents: z
        .object({
          maxSpawnDepth: z.number().int().min(0).max(20).optional(),
          maxChildrenPerSession: z.number().int().min(1).max(50).optional(),
          retentionHours: z.number().int().min(0).optional(),
        })
        .optional(),
      heartbeat: z
        .object({
          every: z.string().optional(),
          model: z.string().optional(),
        })
        .optional(),
      defaultInternalModel: z.string().optional(),
      models: z
        .array(
          z.object({
            id: z.string().min(1),
            provider: z.string().min(1),
            model: z.string().min(1),
          }),
        )
        .optional(),
    })
    .optional(),
  // agents: per-agent config patches applied to runtime.json
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        model: z.string().nullable().optional(),
        toolProfile: z.enum(["sentinel", "pilot", "manager", "executor", "custom"]).optional(),
        customTools: z.array(z.string()).optional(),
        maxSteps: z.number().int().min(1).max(200).optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
        promptMode: z.enum(["full", "minimal"]).optional(),
        thinking: z
          .object({
            enabled: z.boolean(),
            budgetTokens: z.number().int().min(1000).optional(),
          })
          .nullable()
          .optional(),
        allowSubAgents: z.boolean().optional(),
        timeoutMs: z.number().int().min(0).optional(),
        chunkTimeoutMs: z.number().int().min(0).optional(),
        instructionUrls: z.array(z.string().url()).optional(),
        bootstrapFiles: z.array(z.string()).optional(),
        archetype: z
          .enum(["planner", "generator", "evaluator", "orchestrator", "analyst", "communicator"])
          .nullable()
          .optional(),
        autoSelectSkills: z.boolean().optional(),
        autoSelectSkillsTopN: z.number().int().min(1).max(20).optional(),
        heartbeat: z
          .object({
            every: z.string().optional(),
            model: z.string().optional(),
            ackMaxChars: z.number().int().min(0).optional(),
            prompt: z.string().optional(),
            activeHours: z
              .object({
                start: z.string(),
                end: z.string(),
                tz: z.string().optional(),
              })
              .optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .optional(),
});

export type RuntimeConfigPatch = z.infer<typeof RuntimeConfigPatchSchema>;
