// src/dashboard/routes/instances/mcp-schemas.ts
//
// Zod schemas for MCP server CRUD routes.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Base server shape (shared fields)
// ---------------------------------------------------------------------------

const McpServerBaseSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "ID must be alphanumeric, dash or underscore"),
  timeout: z.number().int().min(1000).optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateLocalMcpServerSchema = McpServerBaseSchema.extend({
  type: z.literal("local"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const CreateRemoteMcpServerSchema = McpServerBaseSchema.extend({
  type: z.literal("remote"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const CreateMcpServerSchema = z.discriminatedUnion("type", [
  CreateLocalMcpServerSchema,
  CreateRemoteMcpServerSchema,
]);

export type CreateMcpServerInput = z.infer<typeof CreateMcpServerSchema>;

// ---------------------------------------------------------------------------
// Patch (all fields except `type` are optional)
// ---------------------------------------------------------------------------

const PatchLocalMcpServerSchema = z.object({
  type: z.literal("local"),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  /** Keys to set/update in env. Pass null value to remove a key. */
  env: z.record(z.string(), z.string().nullable()).optional(),
  timeout: z.number().int().min(1000).optional(),
  enabled: z.boolean().optional(),
});

const PatchRemoteMcpServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string().url().optional(),
  /** Keys to set/update in headers. Pass null value to remove a key. */
  headers: z.record(z.string(), z.string().nullable()).optional(),
  timeout: z.number().int().min(1000).optional(),
  enabled: z.boolean().optional(),
});

export const PatchMcpServerSchema = z.discriminatedUnion("type", [
  PatchLocalMcpServerSchema,
  PatchRemoteMcpServerSchema,
]);

export type PatchMcpServerInput = z.infer<typeof PatchMcpServerSchema>;

// ---------------------------------------------------------------------------
// Toggle mcpEnabled at instance level
// ---------------------------------------------------------------------------

export const PatchMcpEnabledSchema = z.object({
  enabled: z.boolean(),
});
