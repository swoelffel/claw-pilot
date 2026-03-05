// src/commands/update.ts
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { SelfUpdateChecker } from "../core/self-update-checker.js";
import { SelfUpdater } from "../core/self-updater.js";
import { LocalConnection } from "../server/local.js";
import { logger } from "../lib/logger.js";
import chalk from "chalk";

export function updateCommand(): Command {
  return new Command("update")
    .description("Check for and apply claw-pilot updates")
    .option("--check", "Check for updates without applying")
    .option("--yes", "Apply update without confirmation prompt")
    .action(async (opts: { check?: boolean; yes?: boolean }) => {
      const checker = new SelfUpdateChecker();

      logger.step("Checking for claw-pilot updates…");

      let status;
      try {
        status = await checker.check();
      } catch (err) {
        logger.fail(`Failed to check for updates: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      const { currentVersion, latestVersion, latestTag, updateAvailable } = status;

      console.log(`  Current version : ${chalk.bold(currentVersion)}`);
      console.log(
        `  Latest version  : ${latestVersion ? chalk.bold(latestVersion) : chalk.dim("unavailable")}`,
      );

      if (!updateAvailable) {
        logger.success("Already up to date.");
        return;
      }

      console.log(
        `\n  ${chalk.yellow("↑")} Update available: ${chalk.dim(currentVersion)} → ${chalk.green(latestVersion ?? "")}`,
      );

      // --check : afficher seulement, ne pas appliquer
      if (opts.check) {
        console.log(`\n  Run ${chalk.bold("claw-pilot update")} to apply.`);
        return;
      }

      // Confirmation interactive (sauf --yes)
      if (!opts.yes) {
        const confirmed = await confirm({
          message: `Apply update to ${latestVersion}?`,
          default: true,
        });
        if (!confirmed) {
          logger.info("Update cancelled.");
          return;
        }
      }

      // Lancer la mise a jour
      const conn = new LocalConnection();
      const updater = new SelfUpdater(conn);

      logger.step(`Applying update to ${latestVersion}…`);
      logger.dim("This may take several minutes (git fetch + pnpm build).");

      updater.run(currentVersion, latestVersion ?? undefined, latestTag ?? undefined);

      // Attendre la fin du job (polling)
      const POLL_INTERVAL = 500;
      const MAX_WAIT = 12 * 60 * 1000; // 12 min
      const start = Date.now();

      while (Date.now() - start < MAX_WAIT) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const job = updater.getJob();

        if (job.status === "done") {
          logger.success(job.message ?? "Update applied successfully.");
          logger.dim("Dashboard service is restarting…");
          return;
        }

        if (job.status === "error") {
          logger.fail(`Update failed: ${job.message ?? "Unknown error"}`);
          process.exitCode = 1;
          return;
        }
      }

      logger.fail("Update timed out. Check the dashboard service logs.");
      process.exitCode = 1;
    });
}
