// src/commands/team.ts
import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { exportInstanceTeam, exportBlueprintTeam, serializeTeamYaml } from "../core/team-export.js";
import { parseAndValidateTeam, importInstanceTeam, importBlueprintTeam } from "../core/team-import.js";

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
            logger.error(`Blueprint "${opts.blueprint}" not found.`);
            process.exit(1);
          }

          const team = exportBlueprintTeam(registry, bp.id);
          yaml = serializeTeamYaml(team);
          defaultFilename = `${bp.name.toLowerCase().replace(/\s+/g, "-")}-team.yaml`;

          logger.info(`Exported ${team.agents.length} agents, ${team.links.length} links from blueprint "${bp.name}"`);
        } else {
          // Export from instance
          if (!slug) {
            logger.error("Please provide an instance slug or use --blueprint.");
            process.exit(1);
          }

          const instance = registry.getInstance(slug);
          if (!instance) {
            logger.error(`Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`);
            process.exit(1);
          }

          logger.step("Syncing agents from disk...");
          const team = await exportInstanceTeam(conn, registry, instance);
          yaml = serializeTeamYaml(team);
          defaultFilename = `${slug}-team.yaml`;

          const fileCount = team.agents.reduce(
            (sum, a) => sum + Object.keys(a.files ?? {}).length,
            0,
          );
          logger.info(
            `Exported ${team.agents.length} agents, ${team.links.length} links, ${fileCount} files`,
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
            logger.error("Please provide a path to a .team.yaml file.");
            process.exit(1);
          }

          // Read and validate file
          logger.step(`Validating ${filePath}...`);
          let yamlContent: string;
          try {
            yamlContent = await fs.readFile(path.resolve(filePath), "utf-8");
          } catch {
            logger.error(`Could not read file: ${filePath}`);
            process.exit(1);
          }

          const parsed = parseAndValidateTeam(yamlContent);
          if (!parsed.success) {
            logger.error("Validation failed:");
            if (parsed.error.message) {
              logger.fail(parsed.error.message);
            }
            if (parsed.error.details) {
              for (const d of parsed.error.details) {
                logger.fail(`  ${d.path ? d.path + ": " : ""}${d.message}`);
              }
            }
            process.exit(1);
          }

          const team = parsed.data;
          const fileCount = team.agents.reduce(
            (sum, a) => sum + Object.keys(a.files ?? {}).length,
            0,
          );

          if (opts.blueprint) {
            // Import into blueprint
            const blueprints = registry.listBlueprints();
            const bp =
              blueprints.find((b) => b.name === opts.blueprint) ??
              blueprints.find((b) => b.id === Number(opts.blueprint));
            if (!bp) {
              logger.error(`Blueprint "${opts.blueprint}" not found.`);
              process.exit(1);
            }

            const currentAgents = registry.listBlueprintAgents(bp.id);

            console.log(`  Format version: ${team.version}`);
            if (team.source) console.log(`  Source: ${team.source}`);
            console.log(`  Agents: ${team.agents.length} (current: ${currentAgents.length} — will be replaced)`);
            console.log(`  Links: ${team.links.length}`);
            console.log(`  Files: ${fileCount}`);

            if (opts.dryRun) {
              console.log(chalk.dim("\nDry run complete. No changes made."));
              return;
            }

            if (!opts.yes) {
              console.log(
                chalk.yellow(
                  `\nWARNING: This will replace ALL agents, files, and links for blueprint "${bp.name}".`,
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
            const result = importBlueprintTeam(db, registry, bp.id, team);
            if ("agents_imported" in result) {
              logger.success(`Removed ${currentAgents.length} existing agents`);
              logger.success(`Created ${result.agents_imported} agents`);
              logger.success(`Written ${result.files_written} workspace files`);
              logger.success(`Created ${result.links_imported} links`);
              console.log(chalk.green("\nImport complete."));
            }
          } else {
            // Import into instance
            if (!slug) {
              logger.error("Please provide an instance slug or use --blueprint.");
              process.exit(1);
            }

            const instance = registry.getInstance(slug);
            if (!instance) {
              logger.error(`Instance "${slug}" not found.`);
              process.exit(1);
            }

            const currentAgents = registry.listAgents(slug);

            console.log(`  Format version: ${team.version}`);
            if (team.source) console.log(`  Source: ${team.source}`);
            console.log(`  Agents: ${team.agents.length} (current: ${currentAgents.length} — will be replaced)`);
            console.log(`  Links: ${team.links.length}`);
            console.log(`  Files: ${fileCount}`);

            if (opts.dryRun) {
              console.log(chalk.dim("\nDry run complete. No changes made."));
              return;
            }

            if (!opts.yes) {
              console.log(
                chalk.yellow(
                  `\nWARNING: This will replace ALL agents, files, and links for instance "${slug}".`,
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
              db,
              registry,
              conn,
              instance,
              team,
              xdgRuntimeDir,
            );
            if ("agents_imported" in result) {
              logger.success(`Removed ${currentAgents.length} existing agents`);
              logger.success(`Created ${result.agents_imported} agents`);
              logger.success(`Written ${result.files_written} workspace files`);
              logger.success(`Created ${result.links_imported} links`);
              logger.success("Regenerated openclaw.json");
              logger.success("Restarted daemon");
              console.log(chalk.green("\nImport complete."));
            }
          }
        });
      },
    );

  return team;
}
