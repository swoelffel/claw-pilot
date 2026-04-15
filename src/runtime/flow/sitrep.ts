// src/runtime/flow/sitrep.ts
//
// SITREP extraction from agent response and injection into permanent session.
// SITREP = Situation Report (military term) — structured summary of mission results.

import type Database from "better-sqlite3";
import type { InstanceSlug, AgentId } from "../types.js";
import { getOrCreatePermanentSession, createUserMessage } from "../session/index.js";
import type { SitrepResult } from "./types.js";

// ---------------------------------------------------------------------------
// SITREP extraction (regex-based MVP)
// ---------------------------------------------------------------------------

// Tolerate markdown decoration: ## **OUTCOME**: ..., **OUTCOME**: ..., OUTCOME: ...
const MD_PREFIX = /(?:^|\n)\s*(?:#{1,3}\s+)?(?:\*{1,2})?/;
const OUTCOME_RE = new RegExp(
  MD_PREFIX.source + "OUTCOME(?:\\*{1,2})?:\\s*(success|failure|partial)",
  "im",
);
const SUMMARY_RE = new RegExp(MD_PREFIX.source + "SUMMARY(?:\\*{1,2})?:\\s*(.+?)(?:\\n|$)", "im");
const FINDINGS_RE = new RegExp(
  MD_PREFIX.source + "KEY FINDINGS(?:\\*{1,2})?:\\s*([\\s\\S]*)",
  "im",
);

const BULLET_RE = /^[-*•]\s+/;

/** Extract a structured SITREP from an agent's raw response text. */
export function extractSitrep(rawText: string): SitrepResult {
  const outcomeMatch = OUTCOME_RE.exec(rawText);
  const summaryMatch = SUMMARY_RE.exec(rawText);
  const findingsMatch = FINDINGS_RE.exec(rawText);

  // When no OUTCOME: marker is found, the agent failed to emit a SITREP at all —
  // this is a reporting failure, not a partial success. "partial" is reserved for
  // agents that explicitly report incomplete work. "failure" truthfully signals
  // "agent did not comply with the reporting contract, nothing verifiable was
  // delivered". Engine-level behavior is unchanged: both outcomes already trigger
  // propagateSkipDownstream() and hasUnsuccessfulSteps() — only the stored value
  // changes, making flow logs and injected SITREPs honest.
  const outcome = (outcomeMatch?.[1]?.toLowerCase() ?? "failure") as SitrepResult["outcome"];
  const summary = summaryMatch?.[1]?.trim() ?? rawText.slice(0, 500).trim();

  // Collect bullet lines from the KEY FINDINGS block, skipping blank lines and sub-headers
  const keyFindings: string[] = [];
  if (findingsMatch?.[1]) {
    for (const line of findingsMatch[1].split("\n")) {
      if (BULLET_RE.test(line.trim())) {
        const trimmed = line
          .trim()
          .replace(BULLET_RE, "")
          .replace(/\*{1,2}/g, "")
          .trim();
        if (trimmed) keyFindings.push(trimmed);
      }
    }
  }

  return { outcome, summary, keyFindings };
}

// ---------------------------------------------------------------------------
// SITREP injection into permanent session
// ---------------------------------------------------------------------------

/**
 * Inject a SITREP message into the agent's permanent session.
 * This enriches the strategic (permanent) context with tactical results.
 */
export function injectSitrep(
  db: Database.Database,
  opts: {
    instanceSlug: InstanceSlug;
    agentId: AgentId;
    flowName: string;
    stepId: string;
    sitrep: SitrepResult;
  },
): void {
  const session = getOrCreatePermanentSession(db, {
    instanceSlug: opts.instanceSlug,
    agentId: opts.agentId,
    channel: "internal",
  });

  const findings =
    opts.sitrep.keyFindings.length > 0
      ? `\nKey findings:\n${opts.sitrep.keyFindings.map((f) => `- ${f}`).join("\n")}`
      : "";

  const text = [
    `[SITREP — Flow "${opts.flowName}" Step "${opts.stepId}" — ${new Date().toISOString()}]`,
    `Outcome: ${opts.sitrep.outcome}`,
    `Summary: ${opts.sitrep.summary}`,
    findings,
  ]
    .filter(Boolean)
    .join("\n");

  createUserMessage(db, { sessionId: session.id, text });
}

// ---------------------------------------------------------------------------
// Format SITREPs for briefing injection
// ---------------------------------------------------------------------------

/** Format dependency SITREPs for inclusion in a step's briefing. */
export function formatSitrepsForBriefing(
  sitreps: Array<{ stepId: string; sitrep: SitrepResult }>,
): string {
  if (sitreps.length === 0) return "";

  const lines = ["### Previous step results"];
  for (const entry of sitreps) {
    lines.push(`\n**Step "${entry.stepId}"** — ${entry.sitrep.outcome}`);
    lines.push(entry.sitrep.summary);
    if (entry.sitrep.keyFindings.length > 0) {
      for (const finding of entry.sitrep.keyFindings) {
        lines.push(`- ${finding}`);
      }
    }
  }
  return lines.join("\n");
}
