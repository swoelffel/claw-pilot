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
  },
): string {
  const includeLastN = opts.step.briefing?.includeLastN ?? 5;
  const extraContext = opts.step.briefing?.extraContext;

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
  sections.push(opts.step.prompt);
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

  // 5. Instructions
  sections.push("### Instructions");
  sections.push("Execute this mission autonomously. Structure your final response:");
  sections.push("- OUTCOME: success | failure | partial");
  sections.push("- SUMMARY: 1-2 sentences");
  sections.push("- KEY FINDINGS: bullet points (if applicable)");

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
