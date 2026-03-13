// src/commands/token.ts
//
// Show the dashboard token or a runtime access URL for an instance.
// With the removal of OpenClaw, there is no more gateway token / Control UI.
// This command now shows the dashboard URL for the instance detail page.
import { Command } from "commander";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { getDashboardTokenPath } from "../lib/platform.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import { CliError } from "../lib/errors.js";
import { constants } from "../lib/constants.js";
import chalk from "chalk";
import * as fs from "node:fs/promises";

const execFileAsync = promisify(nodeExecFile);

export function tokenCommand(): Command {
  return new Command("token")
    .description("Show the dashboard access URL for an instance")
    .argument("<slug>", "Instance slug")
    .option("--url", "Print the full dashboard URL for this instance")
    .option("--open", "Open the dashboard URL in the default browser")
    .option("--raw", "Print the raw dashboard token only")
    .action(async (slug: string, opts: { url?: boolean; open?: boolean; raw?: boolean }) => {
      await withContext(async ({ registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          throw new CliError(
            `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
          );
        }

        // Read the dashboard token
        let dashboardToken: string | null = null;
        try {
          dashboardToken = (await fs.readFile(getDashboardTokenPath(), "utf-8")).trim();
        } catch {
          // Token file missing — not fatal
        }

        if (!dashboardToken) {
          throw new CliError(
            `Dashboard token not found at ${getDashboardTokenPath()}\n` +
              `  Run 'claw-pilot dashboard' to generate it.`,
          );
        }

        // Build the dashboard URL for this instance
        const baseUrl = `http://localhost:${constants.DASHBOARD_PORT}`;
        const instanceUrl = `${baseUrl}/instances/${slug}`;

        if (opts.raw) {
          console.log(dashboardToken);
          return;
        }

        if (opts.open) {
          const opener =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "start"
                : "xdg-open";
          try {
            await execFileAsync(opener, [instanceUrl]);
            logger.success(`Opened dashboard for "${slug}" in browser.`);
            logger.dim(`  ${instanceUrl}`);
          } catch (err) {
            throw new CliError(
              `Failed to open browser: ${err instanceof Error ? err.message : String(err)}\n` +
                `  Open manually: ${instanceUrl}`,
            );
          }
          return;
        }

        if (opts.url) {
          console.log(instanceUrl);
          return;
        }

        // Default: show instance info + dashboard URL
        console.log(chalk.bold(`\nInstance "${slug}":`));
        console.log(`  Port:          ${instance.port}`);
        console.log(`  State dir:     ${instance.state_dir}`);
        console.log(chalk.dim(`\nDashboard URL:`));
        console.log(`  ${chalk.underline(instanceUrl)}`);
        console.log(chalk.dim(`\nTip: use --open to launch directly in your browser.\n`));
      });
    });
}
