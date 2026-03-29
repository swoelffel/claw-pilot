/**
 * runtime/session/skill-ranker.ts
 *
 * Lightweight TF-IDF skill ranker — zero external dependencies.
 * Scores each skill by keyword overlap between the user message
 * and the skill's name + description.
 */

import type { SkillEntry } from "../tool/built-in/skill.js";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/** Tokenize a string into lowercase alphanumeric words (3+ chars). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

// ---------------------------------------------------------------------------
// Term frequency
// ---------------------------------------------------------------------------

/** Build a term frequency map from a token list. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rank skills by relevance to the user message using TF-IDF scoring.
 *
 * Returns the top N skills sorted by score descending.
 * Skills with score 0 are excluded.
 *
 * Scoring: for each query term found in the skill's name + description,
 * accumulate `tf(term, doc) * idf(term, corpus)`.
 * IDF = log(N / df) where df is the number of documents containing the term.
 *
 * @param userText  The user's message text
 * @param skills    All eligible skills (already filtered by permissions)
 * @param topN      Maximum number of skills to return
 */
export function rankSkills(
  userText: string,
  skills: readonly SkillEntry[],
  topN: number,
): SkillEntry[] {
  if (skills.length === 0 || !userText.trim()) return [];

  const queryTokens = tokenize(userText);
  if (queryTokens.length === 0) return [];

  // Build document corpus: one "document" per skill = name (kebab→spaces) + description
  const docs = skills.map((s) => {
    const text = [s.name.replace(/-/g, " "), s.description ?? ""].join(" ");
    return tokenize(text);
  });

  // Compute document frequency for each term across all skill documents
  const N = docs.length;
  const df = new Map<string, number>();
  for (const doc of docs) {
    const unique = new Set(doc);
    for (const term of unique) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Score each skill
  const scored: Array<{ skill: SkillEntry; score: number }> = [];
  for (let i = 0; i < skills.length; i++) {
    const docTf = termFrequency(docs[i]!);
    let score = 0;
    for (const qt of queryTokens) {
      const tf = docTf.get(qt) ?? 0;
      if (tf === 0) continue;
      const idf = Math.log(N / (df.get(qt) ?? 1));
      score += tf * idf;
    }
    if (score > 0) {
      scored.push({ skill: skills[i]!, score });
    }
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.skill);
}
