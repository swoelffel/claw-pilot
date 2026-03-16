/**
 * runtime/memory/writer.ts
 *
 * Ecriture incrementale dans les fichiers memory/*.md.
 * Gere l'append avec deduplication basique (evite les doublons evidents).
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Ajoute des entrees dans un fichier memory/*.md.
 * Cree le fichier et le repertoire si necessaire.
 * Filtre les entrees deja presentes (deduplication basique par contenu exact).
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
  const existingLower = existingContent.toLowerCase();
  const newEntries = entries.filter((e) => !existingLower.includes(e.trim().toLowerCase()));

  if (newEntries.length === 0) return;

  const date = new Date().toISOString().split("T")[0];
  const block = newEntries.map((e) => `- ${e.trim()}`).join("\n");
  const section = `\n\n## ${date}\n${block}\n`;

  fs.appendFileSync(filePath, section, "utf-8");
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
