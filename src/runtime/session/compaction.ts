/**
 * runtime/session/compaction.ts
 *
 * Automatic context compaction for claw-runtime.
 *
 * When the token count approaches the model's context window limit, this module
 * generates a summary of the conversation and replaces the history with a
 * compaction marker + the summary.
 *
 * Phase 1 additions:
 * - extractKnowledge(): extracts permanent facts/decisions/preferences to memory/*.md
 * - COMPACTION_PROMPT_V2: structured 5-section summary prompt
 * - workDir in CompactionInput: enables knowledge extraction for permanent agents
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { generateText } from "ai";
import type Database from "better-sqlite3";
import type { SessionId, InstanceSlug } from "../types.js";
import type { RuntimeAgentConfig } from "../config/index.js";
import type { ResolvedModel } from "../provider/provider.js";
import { listMessages, createAssistantMessage, updateMessageMetadata } from "./message.js";
import { createPart, listParts } from "./part.js";
import { getBus } from "../bus/index.js";
import { SessionStatusChanged, MessageCreated, MessageUpdated } from "../bus/events.js";
import { appendToMemoryFile, consolidateMemoryFileIfNeeded } from "../memory/writer.js";
import { openMemoryIndex, rebuildMemoryIndex } from "../memory/index.js";
import { applyDecayToFile, extractReferencedContents } from "../memory/decay.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fraction of context window that triggers compaction */
const COMPACTION_THRESHOLD = 0.85;

/** Tokens to reserve for the compaction summary output */
const COMPACTION_RESERVED_TOKENS = 8_000;

/** Structured compaction prompt — 5 sections, actionable for the next agent turn */
const COMPACTION_PROMPT_V2 = `You are summarizing a conversation to create a compact context for continuing the work.
The summary will replace the full conversation history — it must be self-sufficient.

Write the summary in the SAME LANGUAGE as the conversation.

## Required sections (use these exact headings)

### Active Goals
List what the user is currently trying to accomplish.
Format: "- [status] Goal description"
Status values: IN PROGRESS / BLOCKED / COMPLETED
Include only goals that are still relevant.

### Key Constraints
List important constraints, requirements, or rules that must be respected.
Include: technical constraints, user preferences, architectural decisions already made.
Format: "- Constraint description"

### Current State
Describe what has been accomplished in this session.
Focus on the most recent work. Be specific about file names, commands, and outcomes.
Format: "- What was done and its result"

### Open Items
List what still needs to be done or decisions that are pending.
Format: "- Item description"

### Working Context
List key files, directories, services, commands, or infrastructure involved.
Format: "- path/to/file or service-name: brief description of its role"

## Rules
- Be specific and actionable — another instance of this agent must be able to continue from this summary alone
- Preserve exact file paths, command names, error messages, and technical identifiers
- Do NOT include information already extracted to long-term memory (facts, decisions, preferences)
- Keep the summary under 1500 tokens
- Use bullet points, not prose paragraphs
- If a section has nothing relevant, write "- (none)"`;

/** Prompt used to extract permanent knowledge before compaction (Phase 4 — 5 categories) */
const EXTRACTION_PROMPT = `Analyze the conversation above and extract ONLY new permanent knowledge worth remembering across sessions.

Categorize into five lists:
1. **facts**: Objective facts about the project, codebase, infrastructure, or domain
   Examples: "The project uses TypeScript strict mode", "The server runs Ubuntu 22.04"
2. **decisions**: Technical decisions made with their rationale
   Examples: "Chose SQLite over PostgreSQL for simplicity and zero-dependency deployment"
3. **preferences**: User preferences, communication style, working habits
   Examples: "User prefers responses in French", "User wants concise answers without preamble"
4. **timeline**: Important events or milestones (format: "YYYY-MM-DD: Event description")
   Examples: "2026-03-16: Migrated database to schema v13"
5. **knowledge**: Learned patterns, conventions, pitfalls, or domain knowledge
   Examples: "exactOptionalPropertyTypes requires conditional spread for optional fields"

Rules:
- Extract ONLY information not already present in the memory files shown above
- Each item must be a single, self-contained statement (one line)
- Do NOT extract transient information: current task progress, temporary errors, in-progress work
- Do NOT extract information that will become obsolete quickly
- Do NOT duplicate information already in the memory files
- If nothing new to extract in a category, return an empty array for that category

Return ONLY valid JSON, no explanation:
{ "facts": [...], "decisions": [...], "preferences": [...], "timeline": [...], "knowledge": [...] }`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CompactionInput {
  db: Database.Database;
  instanceSlug: InstanceSlug;
  sessionId: SessionId;
  agentConfig: RuntimeAgentConfig;
  resolvedModel: ResolvedModel;
  /** Current token count (from the last LLM response) */
  currentTokens: number;
  /** Model context window size in tokens */
  contextWindow: number;
  /** Working directory of the instance — needed for knowledge extraction */
  workDir?: string;
}

export interface CompactionResult {
  /** Whether compaction was performed */
  compacted: boolean;
  /** ID of the compaction message created (if compacted) */
  compactionMessageId: string | undefined;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ExtractedKnowledge {
  facts: string[];
  decisions: string[];
  preferences: string[];
  /** Important events or milestones → memory/timeline.md */
  timeline: string[];
  /** Learned patterns, conventions, pitfalls → memory/knowledge.md */
  knowledge: string[];
}

// ---------------------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------------------

/**
 * Check if compaction should be triggered based on current token usage.
 */
export function shouldCompact(input: {
  currentTokens: number;
  contextWindow: number;
  threshold?: number;
  reservedTokens?: number;
}): boolean {
  if (input.contextWindow <= 0) return false;

  const threshold = input.threshold ?? COMPACTION_THRESHOLD;
  const reserved = input.reservedTokens ?? COMPACTION_RESERVED_TOKENS;
  const usable = input.contextWindow - reserved;

  return input.currentTokens >= usable * threshold;
}

/**
 * Perform compaction: optionally extract permanent knowledge to memory/*.md,
 * then generate a structured summary of the conversation and mark it in the DB.
 *
 * After compaction, the prompt loop loads only the compaction summary + subsequent
 * messages (via listMessagesFromCompaction) instead of the full history.
 */
export async function compact(input: CompactionInput): Promise<CompactionResult> {
  const { db, instanceSlug, sessionId, agentConfig, resolvedModel, workDir } = input;

  const bus = getBus(instanceSlug);
  bus.publish(SessionStatusChanged, { sessionId, status: "busy" });

  try {
    // Load all messages to build the compaction context
    const messages = listMessages(db, sessionId);
    if (messages.length === 0) {
      return { compacted: false, compactionMessageId: undefined };
    }

    // --- STEP 1: Knowledge extraction (permanent agents only) ---
    if (workDir && agentConfig.persistence === "permanent") {
      const wsDir = resolveWorkspaceDir(workDir, agentConfig.id);
      if (wsDir) {
        const currentMemory = readCurrentMemory(wsDir);

        const knowledge = await extractKnowledge(db, sessionId, resolvedModel, currentMemory);

        appendToMemoryFile(wsDir, "facts.md", knowledge.facts);
        appendToMemoryFile(wsDir, "decisions.md", knowledge.decisions);
        appendToMemoryFile(wsDir, "user-prefs.md", knowledge.preferences);
        appendToMemoryFile(wsDir, "timeline.md", knowledge.timeline);
        appendToMemoryFile(wsDir, "knowledge.md", knowledge.knowledge);

        // Rebuild FTS5 index in background if anything was written
        const totalExtracted =
          knowledge.facts.length +
          knowledge.decisions.length +
          knowledge.preferences.length +
          knowledge.timeline.length +
          knowledge.knowledge.length;
        if (totalExtracted > 0) {
          const memoryDb = openMemoryIndex(workDir);
          void rebuildMemoryIndex(memoryDb, workDir, agentConfig.id);
        }

        // Decay — appliquer sur les fichiers memoire (sauf timeline.md)
        const conversationText = buildConversationText(db, messages);
        const referenced = extractReferencedContents(conversationText);
        const decayFiles = ["facts.md", "decisions.md", "user-prefs.md", "knowledge.md"];
        for (const filename of decayFiles) {
          applyDecayToFile(path.join(wsDir, "memory", filename), referenced);
        }

        // Consolidation asynchrone — ne bloque pas la compaction
        const filesToConsolidate = ["facts.md", "decisions.md", "user-prefs.md", "knowledge.md"];
        void Promise.all(
          filesToConsolidate.map((f) =>
            consolidateMemoryFileIfNeeded(wsDir, f, resolvedModel).catch(() => false),
          ),
        ).then((results) => {
          const consolidated = results.filter(Boolean).length;
          if (consolidated > 0) {
            // Re-indexer apres consolidation
            const memoryDb = openMemoryIndex(workDir);
            void rebuildMemoryIndex(memoryDb, workDir, agentConfig.id);
          }
        });
      }
    }

    // --- STEP 2: Generate structured session summary ---
    const conversationText = buildConversationText(db, messages);

    const summaryResult = await generateText({
      model: resolvedModel.languageModel,
      messages: [
        {
          role: "user",
          content: `${conversationText}\n\n---\n\n${COMPACTION_PROMPT_V2}`,
        },
      ],
    });

    const summary = summaryResult.text;

    // Create a compaction assistant message
    const compactionMsg = createAssistantMessage(db, {
      sessionId,
      agentId: agentConfig.id,
      model: `${resolvedModel.providerId}/${resolvedModel.modelId}`,
    });

    bus.publish(MessageCreated, {
      sessionId,
      messageId: compactionMsg.id,
      role: "assistant",
    });

    // Add a compaction part with the summary
    createPart(db, {
      messageId: compactionMsg.id,
      type: "compaction",
      content: summary,
      metadata: JSON.stringify({
        compactedMessageCount: messages.length,
        compactedAt: new Date().toISOString(),
      }),
    });

    // Update message metadata
    const usage = summaryResult.usage;
    updateMessageMetadata(db, compactionMsg.id, {
      tokensIn: usage.inputTokens ?? 0,
      tokensOut: usage.outputTokens ?? 0,
      finishReason: summaryResult.finishReason,
    });

    bus.publish(MessageUpdated, { sessionId, messageId: compactionMsg.id });

    return { compacted: true, compactionMessageId: compactionMsg.id };
  } finally {
    bus.publish(SessionStatusChanged, { sessionId, status: "idle" });
  }
}

/**
 * Get the compaction summary for a session (if any).
 * Returns the content of the most recent compaction part, or undefined.
 * @public
 */
export function getCompactionSummary(
  db: Database.Database,
  sessionId: SessionId,
): string | undefined {
  const messages = listMessages(db, sessionId);

  // Find the most recent compaction part (search backwards)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const parts = listParts(db, msg.id);
    const compactionPart = parts.find((p) => p.type === "compaction");
    if (compactionPart?.content) {
      return compactionPart.content;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract permanent knowledge from the conversation using an LLM call.
 * Returns empty arrays on any failure — never blocks compaction.
 */
async function extractKnowledge(
  db: Database.Database,
  sessionId: SessionId,
  resolvedModel: ResolvedModel,
  currentMemoryContent: string,
): Promise<ExtractedKnowledge> {
  const messages = listMessages(db, sessionId);
  if (messages.length === 0) {
    return { facts: [], decisions: [], preferences: [], timeline: [], knowledge: [] };
  }

  const conversationText = buildConversationText(db, messages);

  let result;
  try {
    result = await generateText({
      model: resolvedModel.languageModel,
      messages: [
        {
          role: "user",
          content: [
            currentMemoryContent
              ? `## Current Memory Files\n${currentMemoryContent}`
              : "## Current Memory Files\n(empty)",
            `## Conversation to analyze\n${conversationText}`,
            `---\n${EXTRACTION_PROMPT}`,
          ].join("\n\n"),
        },
      ],
    });
  } catch {
    // LLM failure — do not block compaction
    return { facts: [], decisions: [], preferences: [], timeline: [], knowledge: [] };
  }

  try {
    // Strip markdown code fences if the model wrapped the JSON
    const cleaned = result.text
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<ExtractedKnowledge>;
    return {
      facts: parsed.facts ?? [],
      decisions: parsed.decisions ?? [],
      preferences: parsed.preferences ?? [],
      timeline: parsed.timeline ?? [],
      knowledge: parsed.knowledge ?? [],
    };
  } catch {
    // Malformed JSON — ignore silently
    return { facts: [], decisions: [], preferences: [], timeline: [], knowledge: [] };
  }
}

/**
 * Read the current memory files content for deduplication during extraction.
 * Returns a concatenated string of facts.md, decisions.md, user-prefs.md.
 */
function readCurrentMemory(workspaceDir: string): string {
  const memoryDir = path.join(workspaceDir, "memory");
  const sections: string[] = [];

  for (const file of ["facts.md", "decisions.md", "user-prefs.md", "timeline.md", "knowledge.md"]) {
    try {
      const content = fs.readFileSync(path.join(memoryDir, file), "utf-8").trim();
      if (content) sections.push(`### ${file}\n${content}`);
    } catch {
      // File absent — ok
    }
  }

  return sections.join("\n\n");
}

/**
 * Resolve the agent workspace directory from workDir + agentId.
 * Mirrors the logic in memory/index.ts: tries workspace-<agentId> then workspace.
 * Returns undefined if no workspace directory exists.
 */
function resolveWorkspaceDir(workDir: string, agentId: string): string | undefined {
  const wsDir = path.join(workDir, "workspaces", agentId);
  return fs.existsSync(wsDir) ? wsDir : undefined;
}

function buildConversationText(
  db: Database.Database,
  messages: ReturnType<typeof listMessages>,
): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const parts = listParts(db, msg.id);
    const textContent = parts
      .filter((p) => p.type === "text" || p.type === "compaction")
      .map((p) => p.content ?? "")
      .filter(Boolean)
      .join("\n");

    if (!textContent) continue;

    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`**${role}:**\n${textContent}`);
  }

  return lines.join("\n\n---\n\n");
}
