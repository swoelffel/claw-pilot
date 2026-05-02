// src/runtime/flow/briefing.ts
//
// Briefing generation for flow steps.
// Extracts context from the agent's permanent session and builds a mission prompt.

import type Database from "better-sqlite3";
import type { InstanceSlug, AgentId } from "../types.js";
import {
  getOrCreatePermanentSession,
  listMessagesFromCompaction,
  listParts,
} from "../session/index.js";
import type { FlowStepDef, SitrepResult } from "./types.js";
import { formatSitrepsForBriefing } from "./sitrep.js";
import { interpolateTemplate } from "./context-providers.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Briefing generation
// ---------------------------------------------------------------------------

/**
 * Build the mission briefing for a flow step.
 * Includes: standing context from permanent session, mission objective,
 * and SITREPs from dependency steps.
 */
export function buildBriefing(
  db: Database.Database,
  opts: {
    instanceSlug: InstanceSlug;
    agentId: AgentId;
    flowName: string;
    step: FlowStepDef;
    depSitreps: Array<{ stepId: string; sitrep: SitrepResult }>;
    /**
     * Templating context merged from registered flow context providers
     * (see `context-providers.ts`). Empty `{}` is the no-op default —
     * `step.prompt` and `extraContext` are passed through unchanged.
     */
    flowContext?: Record<string, unknown>;
  },
): string {
  // Default 0: flow step context comes from dep SITREPs and the step prompt,
  // not from the agent's permanent session history. Permanent session history
  // accumulates SITREPs across runs and cross-contaminates future briefings
  // (observed on MAC run #3: the reporter hallucinated "write-content" — a
  // step name from run #2 — because the last 5 messages from its permanent
  // session still contained run #2's injected SITREPs). Steps that genuinely
  // need standing context can opt-in explicitly via step.briefing.includeLastN
  // in the flow definition JSON (e.g., a continuity-tracking agent with
  // institutional memory across runs).
  const includeLastN = opts.step.briefing?.includeLastN ?? 0;
  const flowContext = opts.flowContext ?? {};
  const rawExtra = opts.step.briefing?.extraContext;
  const extraContext =
    rawExtra !== undefined ? interpolateTemplate(rawExtra, flowContext) : undefined;
  const promptText = interpolateTemplate(opts.step.prompt, flowContext);

  // 1. Extract standing context from permanent session
  let standingContext = "";
  if (includeLastN > 0) {
    standingContext = extractStandingContext(db, opts.instanceSlug, opts.agentId, includeLastN);
  }

  // 2. Build the briefing
  const sections: string[] = [];

  sections.push(`## Mission Briefing — Flow "${opts.flowName}" Step "${opts.step.id}"`);
  sections.push("");

  if (standingContext) {
    sections.push("### Standing context (from your permanent session)");
    sections.push(standingContext);
    sections.push("");
  }

  sections.push("### Mission objective");
  sections.push(promptText);
  sections.push("");

  // 3. Include SITREPs from dependency steps
  const sitrepBlock = formatSitrepsForBriefing(opts.depSitreps);
  if (sitrepBlock) {
    sections.push(sitrepBlock);
    sections.push("");
  }

  // 4. Extra context if provided
  if (extraContext) {
    sections.push("### Additional context");
    sections.push(extraContext);
    sections.push("");
  }

  // 5. Mandatory completion action — the `complete_step` tool is injected
  //    into the toolset by the flow engine. Calling it is the structured
  //    exit point for this step. Without the call, the engine marks the
  //    step as failed regardless of other work performed.
  sections.push("### Mandatory completion action");
  sections.push(
    "When your mission is complete (or you cannot complete it), you MUST call the " +
      "`complete_step` tool with:",
  );
  sections.push("");
  sections.push('- `outcome`: `"success"` | `"failure"` | `"partial"`');
  sections.push("- `summary`: 1–3 sentences describing what you did (or why you failed)");
  sections.push("- `keyFindings`: array of notable observations, URLs, file paths, or decisions");
  sections.push("");
  sections.push(
    "**Do NOT stop before calling `complete_step`.** This is not optional. " +
      "If you finish your last tool call and have not yet called `complete_step`, " +
      "call it immediately. The step is NOT registered as complete until you do. " +
      "The engine considers any step that ends without a `complete_step` call as failed, " +
      "regardless of what other work you performed.",
  );

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Standing context extraction
// ---------------------------------------------------------------------------

/** Extract the last N messages from an agent's permanent session as context. */
function extractStandingContext(
  db: Database.Database,
  instanceSlug: InstanceSlug,
  agentId: AgentId,
  lastN: number,
): string {
  try {
    const session = getOrCreatePermanentSession(db, {
      instanceSlug,
      agentId,
      channel: "internal",
    });

    const messages = listMessagesFromCompaction(db, session.id);
    const recent = messages.slice(-lastN);
    if (recent.length === 0) return "(No prior context available)";

    const lines: string[] = [];
    for (const msg of recent) {
      const msgParts = listParts(db, msg.id);
      const textParts = msgParts.filter((p) => p.type === "text");
      if (textParts.length === 0) continue;
      const content = textParts.map((p) => p.content).join("\n");
      // Truncate each message to avoid bloating the briefing
      const truncated = content.length > 500 ? content.slice(0, 500) + "..." : content;
      lines.push(`[${msg.role}] ${truncated}`);
    }

    return lines.join("\n\n") || "(No text content in recent messages)";
  } catch (err) {
    logger.debug("flow_briefing_context_failed", { error: String(err) });
    return "(Could not load permanent session context)";
  }
}
