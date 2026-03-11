// src/core/openclaw-config.schema.ts
//
// Zod schema for openclaw.json — used by config-reader.ts, config-writer.ts,
// and discovery.ts to replace unsafe `as Record<string, unknown>` casts.
//
// All sub-schemas use .passthrough() to preserve unknown fields from future
// OpenClaw versions without breaking existing configs.

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const ModelRefSchema = z.union([z.string(), z.object({ primary: z.string() }).passthrough()]);

const AgentEntrySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    model: ModelRefSchema.nullable().optional(),
    workspace: z.string().optional(),
    identity: z
      .object({
        name: z.string().optional(),
        emoji: z.string().optional(),
        avatar: z.string().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const AgentDefaultsSchema = z
  .object({
    model: ModelRefSchema.optional(),
    name: z.string().optional(),
    workspace: z.string().optional(),
    subagents: z
      .object({
        maxConcurrent: z.number().optional(),
        archiveAfterMinutes: z.number().optional(),
      })
      .passthrough()
      .optional(),
    compaction: z
      .object({
        mode: z.string().optional(),
        reserveTokensFloor: z.number().optional(),
      })
      .passthrough()
      .optional(),
    contextPruning: z
      .object({
        mode: z.string().optional(),
        ttl: z.string().optional(),
      })
      .passthrough()
      .optional(),
    heartbeat: z
      .object({
        every: z.string().optional(),
        model: z.string().optional(),
        target: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ProviderEntrySchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    models: z.array(z.unknown()).optional(),
  })
  .passthrough();

const AuthProfileSchema = z
  .object({
    provider: z.string().optional(),
    mode: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

export const OpenClawConfigSchema = z
  .object({
    gateway: z
      .object({
        port: z.number(),
        bind: z.string().optional(),
        auth: z.object({ mode: z.string().optional() }).passthrough().optional(),
        reload: z
          .object({
            mode: z.string().optional(),
            debounceMs: z.number().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    agents: z
      .object({
        defaults: AgentDefaultsSchema.optional(),
        list: z.array(AgentEntrySchema).optional(),
      })
      .passthrough()
      .optional(),
    models: z
      .object({
        providers: z.record(z.string(), ProviderEntrySchema).optional(),
      })
      .passthrough()
      .optional(),
    auth: z
      .object({
        profiles: z.record(z.string(), AuthProfileSchema).optional(),
      })
      .passthrough()
      .optional(),
    tools: z
      .object({
        profile: z.string().optional(),
      })
      .passthrough()
      .optional(),
    channels: z
      .object({
        telegram: z
          .object({
            enabled: z.boolean().optional(),
            botToken: z.string().optional(),
            dmPolicy: z.string().optional(),
            groupPolicy: z.string().optional(),
            streamMode: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    plugins: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** @public */
export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;
