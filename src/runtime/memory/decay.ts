/**
 * runtime/memory/decay.ts
 *
 * Systeme de decay pour les entrees memoire.
 *
 * Chaque entree dans memory/*.md est prefixee par un score de confiance [0.0-1.0].
 * Le score diminue a chaque compaction si l'entree n'est pas referencee dans la
 * conversation courante. Les entrees sous le seuil sont supprimees.
 *
 * Format d'une entree avec score : "- [0.8] Le projet utilise TypeScript strict mode"
 * Format legacy (sans score)     : "- Le projet utilise TypeScript strict mode"
 *   → traite comme score 1.0 (entree recente ou importee)
 */

import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Diminution du score a chaque compaction si l'entree n'est pas referencee */
const DECAY_RATE = 0.1;

/** Score en-dessous duquel une entree est supprimee */
const DECAY_THRESHOLD = 0.3;

/** Pattern pour extraire le score d'une entree */
const SCORE_PATTERN = /^\[(\d+\.\d+)\]\s*/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntryWithScore {
  score: number;
  content: string;
  /** Ligne originale avec le score (ou sans si legacy) */
  raw: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse une ligne de memoire et extrait le score.
 * Retourne null si la ligne n'est pas une entree (header, commentaire, vide).
 * Les entrees legacy (sans score) recoivent un score initial de 1.0.
 */
export function parseMemoryEntry(line: string): MemoryEntryWithScore | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;

  const content = trimmed.slice(2); // Enlever "- "
  const match = content.match(SCORE_PATTERN);

  if (match) {
    return {
      score: parseFloat(match[1] ?? "1.0"),
      content: content.slice(match[0].length),
      raw: line,
    };
  }

  // Entree sans score (legacy) — score initial 1.0
  return { score: 1.0, content, raw: line };
}

/**
 * Applique le decay sur un fichier memoire.
 *
 * - Entrees non referencees : score -= DECAY_RATE
 * - Entrees referencees dans la conversation : score = 1.0
 * - Entrees sous DECAY_THRESHOLD : supprimees
 *
 * @param filePath       Chemin absolu du fichier memory/*.md
 * @param referencedContents  Ensemble des contenus mentionnes dans la conversation
 * @returns Nombre d'entrees mises a jour et supprimees
 */
export function applyDecayToFile(
  filePath: string,
  referencedContents: Set<string>,
): { updated: number; removed: number } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { updated: 0, removed: 0 };
  }

  const lines = content.split("\n");
  const newLines: string[] = [];
  let updated = 0;
  let removed = 0;

  for (const line of lines) {
    const entry = parseMemoryEntry(line);
    if (!entry) {
      // Ligne non-entree (header, commentaire, vide) — conserver
      newLines.push(line);
      continue;
    }

    // Verifier si l'entree est referencee dans la conversation
    const entrySnippet = entry.content.toLowerCase().slice(0, 40);
    const isReferenced = [...referencedContents].some((ref) =>
      ref.toLowerCase().includes(entrySnippet),
    );

    let newScore: number;
    if (isReferenced) {
      newScore = 1.0;
    } else {
      newScore = Math.max(0, entry.score - DECAY_RATE);
    }

    if (newScore < DECAY_THRESHOLD) {
      // Supprimer l'entree
      removed++;
      continue;
    }

    if (Math.abs(newScore - entry.score) > 0.001) {
      updated++;
    }

    // Reformater avec le nouveau score (1 decimal)
    newLines.push(`- [${newScore.toFixed(1)}] ${entry.content}`);
  }

  fs.writeFileSync(filePath, newLines.join("\n"), "utf-8");
  return { updated, removed };
}

/**
 * Extrait les contenus mentionnes dans une conversation pour le decay.
 * Retourne un ensemble de phrases significatives (> 20 chars).
 */
export function extractReferencedContents(conversationText: string): Set<string> {
  const sentences = conversationText
    .split(/[.!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  return new Set(sentences);
}
