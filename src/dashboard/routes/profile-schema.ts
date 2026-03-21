// src/dashboard/routes/profile-schema.ts
//
// Zod validation schemas for profile API payloads.

import { z } from "zod";

/** PATCH /api/profile — partial profile update */
export const UserProfilePatchSchema = z.object({
  displayName: z.string().max(100).optional().nullable(),
  language: z.string().min(2).max(10).optional(),
  timezone: z.string().max(50).optional().nullable(),
  communicationStyle: z.enum(["concise", "detailed", "technical"]).optional(),
  customInstructions: z.string().max(10_000).optional().nullable(),
  defaultModel: z.string().max(100).optional().nullable(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  uiPreferences: z.record(z.string(), z.unknown()).optional().nullable(),
});

/** PUT /api/profile/providers/:providerId — add/update a provider */
export const UserProviderUpsertSchema = z.object({
  apiKeyEnvVar: z.string().min(1),
  baseUrl: z.string().url().optional().nullable(),
  priority: z.number().int().min(0).default(0),
  headers: z.record(z.string(), z.string()).optional().nullable(),
});

/** PATCH /api/profile/providers/:providerId/key — write API key value */
export const ApiKeyWriteSchema = z.object({
  /** The actual API key value to write to ~/.claw-pilot/.env */
  apiKey: z.string().min(1),
});

/** PUT /api/profile/models — replace all model aliases */
export const UserModelAliasesSchema = z.array(
  z.object({
    aliasId: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    contextWindow: z.number().int().min(1).optional().nullable(),
  }),
);
