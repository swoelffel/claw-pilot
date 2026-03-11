// src/commands/team.ts
import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { CliError } from "../lib/errors.js";
import { exportInstanceTeam, exportBlueprintTeam, serializeTeamYaml } from "../core/team-export.js";
import {
  parseAndValidateTeam,
  importInstanceTeam,
  importBlueprintTeam,
} from "../core/team-import.js";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Shared import handler
// ---------------------------------------------------------------------------

type ImportTarget =
  | { kind: "blueprint"; blueprintArg: string }
  | { kind: "instance"; slug: string };

async function handleImport(
  target: ImportTarget,
  filePath: string,
  opts: { dryRun?: boolean; yes?: boolean },
  deps: {
    registry: Registry;
    conn: ServerConnection;
    db: Database.Database;
    xdgRuntimeDir: string;
  },
): Promise<void> {
  // Read and validate file
  logger.step(`Validating ${filePath}...`);
  let yamlContent: string;
  try {
    yamlContent = await fs.readFile(path.resolve(filePath), "utf-8");
  } catch {
    throw new CliError(`Could not read file: ${filePath}`);
  }

  const parsed = parseAndValidateTeam(yamlContent);
  if (!parsed.success) {
    const details = parsed.error.details
      ? parsed.error.details.map((d) => `  ${d.path ? d.path + ": " : ""}${d.message}`).join("\n")
      : "";
    throw new CliError(
      `Validation failed:\n${parsed.error.message ?? ""}${details ? "\n" + details : ""}`,
    );
  }

  const team = parsed.data;
  const fileCount = team.agents.reduce((sum, a) => sum + Object.keys(a.files ?? {}).length, 0);

  // Resolve target entity (blueprint or instance)
  let targetName: string;
  let currentAgentCount: number;

  if (target.kind === "blueprint") {
    const blueprints = deps.registry.listBlueprints();
    const bp =
      blueprints.find((b) => b.name === target.blueprintArg) ??
      blueprints.find((b) => b.id === Number(target.blueprintArg));
    if (!bp) {
      throw new CliError(`Blueprint "${target.blueprintArg}" not found.`);
    }
    targetName = `blueprint "${bp.name}"`;
    currentAgentCount = deps.registry.listBlueprintAgents(bp.id).length;

    console.log(`  Format version: ${team.version}`);
    if (team.source) console.log(`  Source: ${team.source}`);
    console.log(
      `  Agents: ${team.agents.length} (current: ${currentAgentCount} — will be replaced)`,
    );
    console.log(`  Links: ${team.links.length}`);
    console.log(`  Files: ${fileCount}`);

    if (opts.dryRun) {
      console.log(chalk.dim("\nDry run complete. No changes made."));
      return;
    }

    if (!opts.yes) {
      console.log(
        chalk.yellow(
          `\nWARNING: This will replace ALL agents, files, and links for ${targetName}.`,
        ),
      );
      console.log(chalk.yellow("This action cannot be undone.\n"));
      const proceed = await confirm({ message: "Proceed?", default: false });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
    }

    logger.step("Importing...");
    const result = await importBlueprintTeam(deps.db, deps.registry, bp.id, team);
    if ("agents_imported" in result) {
      logger.success(`Removed ${currentAgentCount} existing agents`);
      logger.success(`Created ${result.agents_imported} agents`);
      logger.success(`Written ${result.files_written} workspace files`);
      logger.success(`Created ${result.links_imported} links`);
      console.log(chalk.green("\nImport complete."));
    }
  } else {
    const instance = deps.registry.getInstance(target.slug);
    if (!instance) {
      throw new CliError(`Instance "${target.slug}" not found.`);
    }
    targetName = `instance "${target.slug}"`;
    currentAgentCount = deps.registry.listAgents(target.slug).length;

    console.log(`  Format version: ${team.version}`);
    if (team.source) console.log(`  Source: ${team.source}`);
    console.log(
      `  Agents: ${team.agents.length} (current: ${currentAgentCount} — will be replaced)`,
    );
    console.log(`  Links: ${team.links.length}`);
    console.log(`  Files: ${fileCount}`);

    if (opts.dryRun) {
      console.log(chalk.dim("\nDry run complete. No changes made."));
      return;
    }

    if (!opts.yes) {
      console.log(
        chalk.yellow(
          `\nWARNING: This will replace ALL agents, files, and links for ${targetName}.`,
        ),
      );
      console.log(chalk.yellow("This action cannot be undone.\n"));
      const proceed = await confirm({ message: "Proceed?", default: false });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
    }

    logger.step("Importing...");
    const result = await importInstanceTeam(
      deps.db,
      deps.registry,
      deps.conn,
      instance,
      team,
      deps.xdgRuntimeDir,
    );
    if ("agents_imported" in result) {
      logger.success(`Removed ${currentAgentCount} existing agents`);
      logger.success(`Created ${result.agents_imported} agents`);
      logger.success(`Written ${result.files_written} workspace files`);
      logger.success(`Created ${result.links_imported} links`);
      logger.success("Regenerated openclaw.json");
      logger.success("Restarted daemon");
      console.log(chalk.green("\nImport complete."));
    }
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export function teamCommand(): Command {
  const team = new Command("team").description("Export/import agent teams as YAML files");

  // --- team export ---
  team
    .command("export")
    .description("Export agent team to YAML file")
    .argument("[slug]", "Instance slug (omit if using --blueprint)")
    .option("--blueprint <name-or-id>", "Export from a blueprint instead of an instance")
    .option("-o, --output <path>", "Output file path")
    .action(async (slug: string | undefined, opts: { blueprint?: string; output?: string }) => {
      await withContext(async ({ conn, registry }) => {
        let yaml: string;
        let defaultFilename: string;

        if (opts.blueprint) {
          // Export from blueprint
          const blueprints = registry.listBlueprints();
          const bp =
            blueprints.find((b) => b.name === opts.blueprint) ??
            blueprints.find((b) => b.id === Number(opts.blueprint));
          if (!bp) {
            throw new CliError(`Blueprint "${opts.blueprint}" not found.`);
          }

          const exportedTeam = exportBlueprintTeam(registry, bp.id);
          yaml = serializeTeamYaml(exportedTeam);
          defaultFilename = `${bp.name.toLowerCase().replace(/\s+/g, "-")}-team.yaml`;

          logger.info(
            `Exported ${exportedTeam.agents.length} agents, ${exportedTeam.links.length} links from blueprint "${bp.name}"`,
          );
        } else {
          // Export from instance
          if (!slug) {
            throw new CliError("Please provide an instance slug or use --blueprint.");
          }

          const instance = registry.getInstance(slug);
          if (!instance) {
            throw new CliError(
              `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
            );
          }

          logger.step("Syncing agents from disk...");
          const exportedTeam = await exportInstanceTeam(conn, registry, instance);
          yaml = serializeTeamYaml(exportedTeam);
          defaultFilename = `${slug}-team.yaml`;

          const fileCount = exportedTeam.agents.reduce(
            (sum, a) => sum + Object.keys(a.files ?? {}).length,
            0,
          );
          logger.info(
            `Exported ${exportedTeam.agents.length} agents, ${exportedTeam.links.length} links, ${fileCount} files`,
          );
        }

        const outputPath = opts.output ?? path.resolve(process.cwd(), defaultFilename);
        await fs.writeFile(outputPath, yaml, "utf-8");
        logger.success(`Written to ${outputPath}`);
      });
    });

  // --- team import ---
  team
    .command("import")
    .description("Import agent team from YAML file")
    .argument("[slug]", "Instance slug (omit if using --blueprint)")
    .argument("<file>", "Path to .team.yaml file")
    .option("--blueprint <name-or-id>", "Import into a blueprint instead of an instance")
    .option("--dry-run", "Validate and show summary without making changes")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (
        slugOrFile: string,
        fileArg: string | undefined,
        opts: { blueprint?: string; dryRun?: boolean; yes?: boolean },
      ) => {
        await withContext(async ({ db, conn, registry, xdgRuntimeDir }) => {
          // Resolve arguments: if --blueprint is used, first positional is the file
          let slug: string | undefined;
          let filePath: string;

          if (opts.blueprint) {
            filePath = slugOrFile;
            slug = undefined;
          } else {
            slug = slugOrFile;
            filePath = fileArg!;
          }

          if (!filePath) {
            throw new CliError("Please provide a path to a .team.yaml file.");
          }

          const target: ImportTarget = opts.blueprint
            ? { kind: "blueprint", blueprintArg: opts.blueprint }
            : (() => {
                if (!slug)
                  throw new CliError("Please provide an instance slug or use --blueprint.");
                return { kind: "instance" as const, slug };
              })();

          await handleImport(target, filePath, opts, { registry, conn, db, xdgRuntimeDir });
        });
      },
    );

  return team;
}
