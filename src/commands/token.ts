// src/commands/token.ts
import { Command } from "commander";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { readGatewayToken } from "../lib/env-reader.js";
import { logger } from "../lib/logger.js";
import { withContext } from "./_context.js";
import chalk from "chalk";

const execFileAsync = promisify(nodeExecFile);

export function tokenCommand(): Command {
  return new Command("token")
    .description("Show the gateway token for a Control UI instance")
    .argument("<slug>", "Instance slug")
    .option("--url", "Print the full Control UI URL with the token in the hash fragment")
    .option("--open", "Open the Control UI URL in the default browser")
    .action(async (slug: string, opts: { url?: boolean; open?: boolean }) => {
      await withContext(async ({ conn, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          logger.error(`Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`);
          process.exit(1);
        }

        const token = await readGatewayToken(conn, instance.state_dir);
        if (!token) {
          logger.error(
            `Gateway token not found in ${instance.state_dir}/.env\n` +
            `  Make sure OPENCLAW_GW_AUTH_TOKEN is set in that file.`,
          );
          process.exit(1);
        }

        // Build the Control UI base URL
        const baseUrl = instance.nginx_domain
          ? `https://${instance.nginx_domain}`
          : `http://localhost:${instance.port}`;

        const tokenUrl = `${baseUrl}/#token=${token}`;

        if (opts.open) {
          // Open in browser — works on macOS (open), Linux (xdg-open), Windows (start)
          const opener =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "start"
                : "xdg-open";
          try {
            await execFileAsync(opener, [tokenUrl]);
            logger.success(`Opened Control UI for "${slug}" in browser.`);
            logger.dim(`  ${tokenUrl}`);
          } catch (err) {
            logger.error(
              `Failed to open browser: ${err instanceof Error ? err.message : String(err)}\n` +
              `  Open manually: ${tokenUrl}`,
            );
            process.exit(1);
          }
          return;
        }

        if (opts.url) {
          console.log(tokenUrl);
          return;
        }

        // Default: show token + helpful hint
        console.log(chalk.bold(`\nGateway token for "${slug}":`));
        console.log(`  ${chalk.cyan(token)}`);
        console.log(chalk.dim(`\nControl UI URL (with auto-login):`));
        console.log(`  ${chalk.underline(tokenUrl)}`);
        console.log(chalk.dim(`\nTip: use --open to launch directly in your browser.\n`));
      });
    });
}
