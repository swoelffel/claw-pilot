// src/core/config-types.ts
//
// Types and Zod validation schema for instance configuration.
// Consumed by config-reader.ts, config-writer.ts, and the dashboard API.

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single provider entry as returned by the config API */
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

/** Structured config payload returned by GET /api/instances/:slug/config */
export interface InstanceConfigPayload {
  general: {
    displayName: string;
    defaultModel: string;
    port: number;
    toolsProfile: string;
  };
  providers: ProviderEntry[];
  agentDefaults: {
    workspace: string;
    subagents: { maxConcurrent: number; archiveAfterMinutes: number };
    compaction: { mode: string; reserveTokensFloor?: number };
    contextPruning: { mode: string; ttl?: string };
    heartbeat: { every?: string; model?: string; target?: string };
  };
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    workspace: string;
    identity: { name?: string; emoji?: string; avatar?: string } | null;
    skills: string[] | null; // null = all skills (champ absent dans JSON)
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
    bind: string;
    authMode: string;
    reloadMode: string;
    reloadDebounceMs: number;
  };
}

/** Partial patch sent by PATCH /api/instances/:slug/config */
export interface ConfigPatch {
  general?: {
    displayName?: string;
    defaultModel?: string;
    toolsProfile?: string;
    // Legacy single-provider fields (retro-compat — still accepted but deprecated)
    provider?: string;
    apiKey?: string;
  };
  providers?: {
    add?: Array<{ id: string; apiKey?: string }>;
    update?: Array<{ id: string; apiKey?: string }>;
    remove?: string[];
  };
  agentDefaults?: {
    workspace?: string;
    subagents?: { maxConcurrent?: number; archiveAfterMinutes?: number };
    compaction?: { mode?: string; reserveTokensFloor?: number };
    contextPruning?: { mode?: string; ttl?: string };
    heartbeat?: { every?: string; model?: string; target?: string };
  };
  agents?: Array<{
    id: string;
    name?: string;
    model?: string | null;
    identity?: { name?: string; emoji?: string; avatar?: string } | null;
    skills?: string[] | null; // null = supprimer le champ (= all skills)
  }>;
  channels?: {
    telegram?: {
      enabled?: boolean;
      botToken?: string;
      dmPolicy?: string;
      groupPolicy?: string;
      streamMode?: string;
    };
  };
  plugins?: {
    mem0?: {
      enabled?: boolean;
      ollamaUrl?: string;
      qdrantHost?: string;
      qdrantPort?: number;
    };
  };
  gateway?: {
    port?: number;
    reloadMode?: string;
    reloadDebounceMs?: number;
  };
}

/**
 * Runtime Zod schema mirroring ConfigPatch.
 * Used by the dashboard API to validate incoming PATCH bodies.
 * `.strict()` rejects unknown fields to prevent arbitrary data injection.
 */
export const ConfigPatchSchema = z
  .object({
    general: z
      .object({
        displayName: z.string().max(100).optional(),
        defaultModel: z.string().optional(),
        toolsProfile: z.string().optional(),
        provider: z.string().optional(),
        apiKey: z.string().optional(),
      })
      .strict()
      .optional(),
    providers: z
      .object({
        add: z
          .array(z.object({ id: z.string(), apiKey: z.string().optional() }).strict())
          .optional(),
        update: z
          .array(z.object({ id: z.string(), apiKey: z.string().optional() }).strict())
          .optional(),
        remove: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    agentDefaults: z
      .object({
        workspace: z.string().optional(),
        subagents: z
          .object({
            maxConcurrent: z.number().int().min(1).optional(),
            archiveAfterMinutes: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        compaction: z
          .object({
            mode: z.string().optional(),
            reserveTokensFloor: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        contextPruning: z
          .object({
            mode: z.string().optional(),
            ttl: z.string().optional(),
          })
          .strict()
          .optional(),
        heartbeat: z
          .object({
            every: z.string().optional(),
            model: z.string().optional(),
            target: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    agents: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            model: z.string().nullable().optional(),
            identity: z
              .object({
                name: z.string().optional(),
                emoji: z.string().optional(),
                avatar: z.string().optional(),
              })
              .strict()
              .nullable()
              .optional(),
            skills: z.array(z.string()).nullable().optional(),
          })
          .strict(),
      )
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
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    plugins: z
      .object({
        mem0: z
          .object({
            enabled: z.boolean().optional(),
            ollamaUrl: z.string().optional(),
            qdrantHost: z.string().optional(),
            qdrantPort: z.number().int().min(1).max(65535).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    gateway: z
      .object({
        port: z.number().int().min(1024).max(65535).optional(),
        reloadMode: z.string().optional(),
        reloadDebounceMs: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Result of classifying which fields require restart vs hot-reload */
export interface ChangeClassification {
  requiresRestart: boolean;
  hotReloadOnly: boolean;
  dbOnly: boolean;
  restartReason: string | null;
}

/** Result of applying a config patch */
export interface ConfigPatchResult {
  ok: boolean;
  requiresRestart: boolean;
  hotReloaded: boolean;
  warnings: string[];
  restartReason?: string;
  /** True when gateway.port was changed — browser pairing will be lost after restart */
  pairingWarning?: boolean;
}
