// src/commands/migrate.ts
//
// claw-pilot migrate <slug> [--mode clone|in-place] [--new-slug <slug>]
//
// Migrates an openclaw instance to claw-runtime.
//
// --mode clone (default):
//   Creates a new claw-runtime instance with slug "<slug>-rt" (or --new-slug).
//   Converts openclaw.json → runtime.json, leaves the original intact.
//
// --mode in-place:
//   Converts the existing instance on-place:
//   1. Stops and disables the systemd service
//   2. Writes runtime.json from the converted config
//   3. Updates instance_type in DB to "claw-runtime"

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { CliError } from "../lib/errors.js";
import { OpenClawConfigSchema } from "../core/openclaw-config.schema.js";
import { buildRuntimeConfig, type MigrationReport } from "../core/migrator.js";
import { saveRuntimeConfig } from "../runtime/engine/config-loader.js";
import { getStateDir, getSystemdUnit } from "../lib/platform.js";
import { PortAllocator } from "../core/port-allocator.js";
import { Provisioner } from "../core/provisioner.js";
import type { WizardAnswers } from "../core/config-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse openclaw.json from the instance config_path */
function readOpenClawConfig(configPath: string): ReturnType<typeof OpenClawConfigSchema.parse> {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new CliError(
      `Could not read openclaw.json at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = OpenClawConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new CliError(`Invalid openclaw.json at ${configPath}: ${result.error.message}`);
  }
  return result.data;
}

/** Append env entries to <stateDir>/.env (creates file if missing) */
function appendEnvEntries(stateDir: string, entries: Array<{ key: string; value: string }>): void {
  if (entries.length === 0) return;
  const envPath = path.join(stateDir, ".env");
  const lines = entries.map(({ key, value }) => `${key}=${value}`).join("\n");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  const separator = existing.endsWith("\n") || existing === "" ? "" : "\n";
  fs.writeFileSync(envPath, existing + separator + lines + "\n", "utf-8");
}

/** Print the migration report to stdout */
function printReport(report: MigrationReport): void {
  console.log(chalk.bold("\nMigration report:"));
  console.log(`  Agents converted   : ${report.agentCount}`);
  console.log(`  Providers converted: ${report.providerCount}`);

  if (report.envEntries.length > 0) {
    console.log(chalk.dim(`\n  Env entries to write (${report.envEntries.length}):`));
    for (const { key } of report.envEntries) {
      console.log(chalk.dim(`    ${key}=<value>`));
    }
  }

  if (report.warnings.length > 0) {
    console.log(chalk.yellow(`\n  Warnings (${report.warnings.length} fields not mapped):`));
    for (const w of report.warnings) {
      console.log(chalk.yellow(`    [${w.field}] ${w.reason}`));
    }
  } else {
    console.log(chalk.green("\n  No warnings — all fields mapped successfully."));
  }
}

// ---------------------------------------------------------------------------
// Mode: in-place
// ---------------------------------------------------------------------------

async function migrateInPlace(slug: string, opts: { yes: boolean | undefined }): Promise<void> {
  await withContext(async ({ registry, conn, xdgRuntimeDir }) => {
    const instance = registry.getInstance(slug);
    if (!instance) throw new CliError(`Instance "${slug}" not found.`);
    if (instance.instance_type === "claw-runtime") {
      throw new CliError(`Instance "${slug}" is already a claw-runtime instance.`);
    }

    // Read and convert config
    const openclawConfig = readOpenClawConfig(instance.config_path);
    const { config: runtimeConfig, report } = buildRuntimeConfig(openclawConfig);

    console.log(chalk.bold(`\nMigrating "${slug}" in-place to claw-runtime`));
    printReport(report);

    console.log(chalk.yellow("\nWARNING: This will:"));
    console.log(chalk.yellow("  1. Stop and disable the systemd service"));
    console.log(chalk.yellow("  2. Write runtime.json in the instance state directory"));
    console.log(chalk.yellow("  3. Update instance_type to 'claw-runtime' in the registry"));
    console.log(chalk.yellow("  The original openclaw.json is preserved but no longer used.\n"));

    if (!opts.yes) {
      const proceed = await confirm({
        message: "Proceed with in-place migration?",
        default: false,
      });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
    }

    // Stop and disable systemd service
    const unit = getSystemdUnit(slug);
    logger.step(`Stopping systemd service ${unit}...`);
    try {
      await conn.execFile("systemctl", ["--user", "stop", unit], {
        env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
      });
    } catch {
      logger.warn(`Could not stop ${unit} — it may already be stopped.`);
    }

    logger.step(`Disabling systemd service ${unit}...`);
    try {
      await conn.execFile("systemctl", ["--user", "disable", unit], {
        env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
      });
    } catch {
      logger.warn(`Could not disable ${unit} — continuing.`);
    }

    // Write runtime.json
    logger.step("Writing runtime.json...");
    saveRuntimeConfig(instance.state_dir, runtimeConfig);

    // Append env entries
    if (report.envEntries.length > 0) {
      logger.step("Appending env entries to .env...");
      appendEnvEntries(instance.state_dir, report.envEntries);
    }

    // Update DB
    logger.step("Updating registry...");
    registry.updateInstanceType(slug, "claw-runtime");
    registry.updateInstanceState(slug, "stopped");
    registry.logEvent(slug, "migrated", "Migrated from openclaw to claw-runtime (in-place)");

    logger.success(`Instance "${slug}" migrated to claw-runtime.`);
    logger.dim(`Start it with: claw-pilot runtime start ${slug}`);
  });
}

// ---------------------------------------------------------------------------
// Mode: clone
// ---------------------------------------------------------------------------

async function migrateClone(
  slug: string,
  opts: { newSlug: string | undefined; yes: boolean | undefined },
): Promise<void> {
  await withContext(async ({ registry, conn }) => {
    const instance = registry.getInstance(slug);
    if (!instance) throw new CliError(`Instance "${slug}" not found.`);
    if (instance.instance_type === "claw-runtime") {
      throw new CliError(`Instance "${slug}" is already a claw-runtime instance.`);
    }

    const newSlug = opts.newSlug ?? `${slug}-rt`;

    if (registry.getInstance(newSlug)) {
      throw new CliError(
        `Instance "${newSlug}" already exists. Use --new-slug to specify a different slug.`,
      );
    }

    // Read and convert config
    const openclawConfig = readOpenClawConfig(instance.config_path);
    const { config: runtimeConfig, report } = buildRuntimeConfig(openclawConfig);

    console.log(chalk.bold(`\nCloning "${slug}" → "${newSlug}" as claw-runtime`));
    printReport(report);

    console.log(chalk.dim(`\nThe original instance "${slug}" will not be modified.`));
    console.log(chalk.dim(`A new claw-runtime instance "${newSlug}" will be created.\n`));

    if (!opts.yes) {
      const proceed = await confirm({ message: "Proceed with clone migration?", default: false });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
    }

    // Determine new port (next available after existing instances)
    const server = registry.getLocalServer();
    if (!server) throw new CliError("No local server registered. Run 'claw-pilot init' first.");

    const portAllocator = new PortAllocator(registry, conn);
    const newPort = await portAllocator.findFreePort(server.id);

    // Build minimal WizardAnswers for Provisioner
    const wizardAnswers: WizardAnswers = {
      slug: newSlug,
      displayName: instance.display_name ?? newSlug,
      provider: runtimeConfig.providers[0]?.id ?? "anthropic",
      apiKey: "",
      port: newPort,
      defaultModel: runtimeConfig.defaultModel,
      agents: runtimeConfig.agents.map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        isDefault: a.isDefault,
      })),
      telegram: {
        enabled: runtimeConfig.telegram.enabled,
      },
      mem0: { enabled: false },
    };

    const provisioner = new Provisioner(conn, registry, portAllocator);
    logger.step(`Provisioning new claw-runtime instance "${newSlug}" on port ${newPort}...`);
    const result = await provisioner.provision(wizardAnswers, server.id, undefined, "claw-runtime");

    // Overwrite the auto-generated runtime.json with our converted config
    logger.step("Writing converted runtime.json...");
    const newStateDir = getStateDir(newSlug);
    saveRuntimeConfig(newStateDir, runtimeConfig);

    // Append env entries
    if (report.envEntries.length > 0) {
      logger.step("Appending env entries to .env...");
      appendEnvEntries(newStateDir, report.envEntries);
    }

    registry.logEvent(
      newSlug,
      "migrated",
      `Cloned from openclaw instance "${slug}" to claw-runtime`,
    );

    logger.success(`Instance "${newSlug}" created on port ${result.port}.`);
    logger.dim(`Start it with: claw-pilot runtime start ${newSlug}`);
    logger.dim(`Original instance "${slug}" is unchanged.`);
  });
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export function migrateCommand(): Command {
  return new Command("migrate")
    .description("Migrate an openclaw instance to claw-runtime")
    .argument("<slug>", "Source instance slug")
    .option("--mode <mode>", "Migration mode: 'clone' (default) or 'in-place'", "clone")
    .option("--new-slug <slug>", "Slug for the new instance (clone mode only, default: <slug>-rt)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (slug: string, opts: { mode: string; newSlug?: string; yes?: boolean }) => {
      if (opts.mode !== "clone" && opts.mode !== "in-place") {
        throw new CliError(`Invalid mode "${opts.mode}". Use 'clone' or 'in-place'.`);
      }

      if (opts.mode === "in-place") {
        if (opts.newSlug) {
          throw new CliError("--new-slug is only valid with --mode clone.");
        }
        await migrateInPlace(slug, { yes: opts.yes });
      } else {
        await migrateClone(slug, {
          newSlug: opts.newSlug,
          yes: opts.yes,
        });
      }
    });
}
