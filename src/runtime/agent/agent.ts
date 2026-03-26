/**
 * runtime/agent/agent.ts
 *
 * Agent.Info schema and namespace.
 * Defines the shape of an agent configuration in claw-runtime.
 */

import { z } from "zod";

export namespace Agent {
  export const Info = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    /** "primary" = user-facing, "subagent" = spawned by task tool, "all" = both */
    mode: z.enum(["subagent", "primary", "all"]),
    /**
     * Functional role of the agent (lifecycle decisions).
     * - "primary": user-facing agent with permanent session, full workspace context,
     *   and ability to spawn subagents.
     * - "subagent": ephemeral tool spawned by primary agents, minimal context,
     *   no spawn capability, not visible to users.
     * Defaults to "primary". Derived from mode if not set explicitly.
     */
    kind: z.enum(["primary", "subagent"]).default("primary"),
    /**
     * Classification of the agent for display and filtering purposes.
     * - "user": created and configured by the user (Pilot, custom agents)
     * - "tool": built-in utility agents available as tools for "user" agents (explore, general, build, plan)
     * - "system": internal infrastructure agents, never invocable directly (compaction, title, summary)
     */
    category: z.enum(["user", "tool", "system"]).default("tool"),
    /**
     * Behavioral archetype of the agent.
     * Controls system prompt injection and enables archetype-based routing:
     * task({ subagent_type: "evaluator" }) resolves to the first agent with that archetype.
     * Orthogonal to toolProfile (which controls tool access).
     */
    archetype: z
      .enum(["planner", "generator", "evaluator", "orchestrator", "analyst", "communicator"])
      .nullable()
      .default(null),
    /** Whether this is a built-in agent (not user-defined) */
    native: z.boolean().optional(),
    /** Whether to hide from agent picker UI */
    hidden: z.boolean().optional(),
    /** Whether this is the default agent for new sessions */
    isDefault: z.boolean().optional(),
    topP: z.number().min(0).max(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    color: z.string().optional(),
    /** Permission ruleset for this agent */
    permission: z.array(
      z.object({
        permission: z.string(),
        pattern: z.string(),
        action: z.enum(["allow", "deny", "ask"]),
      }),
    ),
    /** Model override: "provider/model" format */
    model: z.string().optional(),
    /** System prompt override text */
    prompt: z.string().optional(),
    /** Max tool-call steps before forcing text-only */
    steps: z.number().int().positive().optional(),
    /** Arbitrary extra options (passed to provider) */
    options: z.record(z.string(), z.unknown()).default({}),
  });

  export type Info = z.infer<typeof Info>;

  /** Minimal agent info for display (no permission details) */
  export interface Summary {
    name: string;
    description: string | undefined;
    mode: Info["mode"];
    kind: Info["kind"];
    category: Info["category"];
    hidden: boolean;
    native: boolean;
    color: string | undefined;
    archetype: Info["archetype"];
  }

  /** @public */
  export function toSummary(info: Info): Summary {
    return {
      name: info.name,
      description: info.description,
      mode: info.mode,
      kind: info.kind,
      category: info.category,
      hidden: info.hidden ?? false,
      native: info.native ?? false,
      color: info.color,
      archetype: info.archetype,
    };
  }
}
