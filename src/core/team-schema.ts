// src/core/team-schema.ts
// Zod schema for .team.yaml agent team export/import format.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workspace files included in team exports. */
export const EXPORTABLE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
] as const;

export type ExportableFile = (typeof EXPORTABLE_FILES)[number];

/** Current format version. */
export const TEAM_FORMAT_VERSION = "1" as const;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const AgentModelSchema = z.union([
  z.string(),
  z.object({
    primary: z.string().optional(),
    fallbacks: z.array(z.string()).optional(),
  }),
]);

const IdentitySchema = z
  .object({
    name: z.string().optional(),
    theme: z.string().optional(),
    emoji: z.string().optional(),
    avatar: z.string().optional(),
  })
  .passthrough(); // allow unknown identity fields (color, icon, etc.)

const SubagentsConfigSchema = z
  .object({
    allowAgents: z.array(z.string()).optional(),
    model: AgentModelSchema.optional(),
  })
  .passthrough(); // allow unknown subagent fields

const AgentConfigSchema = z
  .object({
    model: AgentModelSchema.optional(),
    identity: IdentitySchema.optional(),
    subagents: SubagentsConfigSchema.optional(),
    heartbeat: z.record(z.string(), z.unknown()).optional(),
    sandbox: z.record(z.string(), z.unknown()).optional(),
    tools: z.record(z.string(), z.unknown()).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    skills: z.array(z.string()).optional(),
    humanDelay: z.record(z.string(), z.unknown()).optional(),
    groupChat: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough() // allow unknown config fields for forward-compat
  .optional();

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const AgentMetaSchema = z.object({
  role: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  position: PositionSchema.nullable().optional(),
});

const AgentFilesSchema = z.record(z.string(), z.string());

const AgentSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Agent ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1),
  is_default: z.boolean().default(false),
  config: AgentConfigSchema,
  meta: AgentMetaSchema.optional(),
  files: AgentFilesSchema.optional(),
});

const LinkSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(["a2a", "spawn"]),
});

const DefaultsSchema = z.object({
  model: AgentModelSchema.optional(),
  subagents: z.record(z.string(), z.unknown()).optional(),
});

const AgentToAgentSchema = z.object({
  enabled: z.boolean(),
  allow: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

export const TeamFileSchema = z
  .object({
    version: z.literal("1"),
    exported_at: z.string(),
    source: z.string().optional(),
    defaults: DefaultsSchema.optional(),
    agent_to_agent: AgentToAgentSchema.optional(),
    agents: z.array(AgentSchema).min(1),
    links: z.array(LinkSchema).default([]),
  })
  .refine(
    (data) => data.agents.some((a) => a.is_default),
    { message: "At least one agent must have is_default: true" },
  )
  .refine(
    (data) => {
      const ids = data.agents.map((a) => a.id);
      return new Set(ids).size === ids.length;
    },
    { message: "Agent IDs must be unique" },
  )
  .refine(
    (data) => {
      const ids = new Set(data.agents.map((a) => a.id));
      return data.links.every((l) => ids.has(l.source) && ids.has(l.target));
    },
    { message: "All link source/target must reference existing agent IDs" },
  );

export type TeamFile = z.infer<typeof TeamFileSchema>;
export type TeamAgent = z.infer<typeof AgentSchema>;
export type TeamLink = z.infer<typeof LinkSchema>;
