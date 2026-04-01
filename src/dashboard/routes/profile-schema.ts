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
