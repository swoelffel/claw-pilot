/**
 * runtime/memory/writer.ts
 *
 * Ecriture incrementale dans les fichiers memory/*.md.
 * Gere l'append avec deduplication (FTS5 si disponible, sinon basique),
 * prefixage des entrees avec un score de confiance [1.0], et consolidation
 * periodique quand un fichier depasse un seuil de taille.
 */

import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import type { ResolvedModel } from "../provider/provider.js";
import { searchMemory } from "./index.js";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Score BM25 minimum (valeur absolue) pour considerer un doublon semantique */
const SIMILARITY_THRESHOLD = 0.3;

/** Nombre de lignes au-dela duquel la consolidation est declenchee */
const CONSOLIDATION_THRESHOLD_LINES = 150;

const CONSOLIDATION_PROMPT = `You are consolidating a memory file for an AI agent.
The file contains facts/decisions/preferences accumulated over time.
Some entries may be duplicates, outdated, or contradictory.

Your task:
1. Remove exact duplicates
2. Merge similar entries into a single, more precise statement
3. Remove entries that are clearly outdated or contradicted by newer entries
4. Reorganize by theme (add ## Theme headers if helpful)
5. Keep all unique, valid information

Write in the SAME LANGUAGE as the original content.
Output ONLY the consolidated content, no explanation.
Preserve the markdown format (bullet points with "- [score] content").`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ajoute des entrees dans un fichier memory/*.md.
 * Cree le fichier et le repertoire si necessaire.
 * Prefixe chaque entree avec un score de confiance [1.0].
 * Filtre les entrees deja presentes (deduplication basique par contenu exact).
 *
 * Pour une deduplication semantique via FTS5, utiliser appendToMemoryFileDeduped().
 */
export function appendToMemoryFile(
  workspaceDir: string,
  filename: string, // ex: "facts.md", "decisions.md"
  entries: string[],
): void {
  if (entries.length === 0) return;

  const memoryDir = path.join(workspaceDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const filePath = path.join(memoryDir, filename);

  // Lire le contenu existant pour deduplication
  let existingContent = "";
  try {
    existingContent = fs.readFileSync(filePath, "utf-8");
  } catch {
    // Fichier absent — ok, sera cree
  }

  // Filtrer les entrees deja presentes (comparaison insensible a la casse, trim)
  // Ignore le prefixe [score] lors de la comparaison
  const existingLower = existingContent.toLowerCase();
  const newEntries = entries.filter((e) => {
    const normalized = e.trim().toLowerCase();
    return !existingLower.includes(normalized);
  });

  if (newEntries.length === 0) return;

  const date = new Date().toISOString().split("T")[0];
  // Prefixer chaque entree avec le score initial [1.0]
  const block = newEntries.map((e) => `- [1.0] ${e.trim()}`).join("\n");
  const section = `\n\n## ${date}\n${block}\n`;

  fs.appendFileSync(filePath, section, "utf-8");
}

/**
 * Ajoute des entrees dans un fichier memory/*.md avec deduplication FTS5.
 * Si un fait similaire existe deja dans l'index (score BM25 > threshold), il est ignore.
 * Fallback sur appendToMemoryFile() si l'index n'est pas disponible.
 */
export function appendToMemoryFileDeduped(
  workspaceDir: string,
  memoryDb: Database.Database | undefined,
  filename: string,
  entries: string[],
): void {
  if (entries.length === 0) return;

  if (!memoryDb) {
    // Index non disponible — fallback sur deduplication basique
    appendToMemoryFile(workspaceDir, filename, entries);
    return;
  }

  const newEntries: string[] = [];

  for (const entry of entries) {
    // Chercher des faits similaires dans l'index FTS5
    const similar = searchMemory(memoryDb, entry, 3);
    const hasSimilar = similar.some((r) => {
      // Verifier si le chunk similaire est dans le meme fichier
      return r.source === `memory/${filename}` && Math.abs(r.rank) > SIMILARITY_THRESHOLD;
    });

    if (!hasSimilar) {
      newEntries.push(entry);
    }
  }

  if (newEntries.length > 0) {
    appendToMemoryFile(workspaceDir, filename, newEntries);
  }
}

/**
 * Consolide un fichier memory/*.md si il depasse le seuil de taille.
 * Utilise un appel LLM pour fusionner les doublons et reorganiser.
 * Retourne true si la consolidation a ete effectuee.
 *
 * La consolidation est non-bloquante — les erreurs sont silencieusement ignorees.
 */
export async function consolidateMemoryFileIfNeeded(
  workspaceDir: string,
  filename: string,
  resolvedModel: ResolvedModel,
): Promise<boolean> {
  const filePath = path.join(workspaceDir, "memory", filename);

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false; // Fichier absent
  }

  const lineCount = content.split("\n").length;
  if (lineCount <= CONSOLIDATION_THRESHOLD_LINES) {
    return false; // Pas besoin de consolidation
  }

  try {
    const result = await generateText({
      model: resolvedModel.languageModel,
      messages: [
        {
          role: "user",
          content: `## Memory file to consolidate (${filename})\n\n${content}\n\n---\n\n${CONSOLIDATION_PROMPT}`,
        },
      ],
    });

    if (result.text && result.text.length > 50) {
      // Sauvegarder l'original avant ecrasement
      const backupPath = filePath.replace(".md", `.backup-${Date.now()}.md`);
      fs.copyFileSync(filePath, backupPath);

      // Ecrire le contenu consolide
      const header = `# ${filename.replace(".md", "")} (consolidated ${new Date().toISOString().split("T")[0]})\n\n`;
      fs.writeFileSync(filePath, header + result.text, "utf-8");

      // Supprimer le backup apres succes
      fs.unlinkSync(backupPath);
      return true;
    }
  } catch {
    // Echec de consolidation — conserver le fichier original
  }

  return false;
}

/**
 * Archive le contenu de BOOTSTRAP.md dans memory/bootstrap-history.md.
 * Appele apres la completion du bootstrap wizard.
 */
export function archiveBootstrap(workspaceDir: string, bootstrapContent: string): void {
  const date = new Date().toISOString();
  const content = `\n\n## Bootstrap archive — ${date}\n\n${bootstrapContent}\n`;

  const memoryDir = path.join(workspaceDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.appendFileSync(path.join(memoryDir, "bootstrap-history.md"), content, "utf-8");
}
