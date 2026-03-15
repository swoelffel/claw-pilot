// src/commands/devices.ts
//
// CLI command: claw-pilot devices
// Sub-commands: list, revoke
//
// Works with the `rt_pairing_codes` DB table for claw-runtime instances.

import { Command } from "commander";
import chalk from "chalk";
import { withContext } from "./_context.js";
import { CliError } from "../lib/errors.js";
import { DeviceManager } from "../core/device-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a timestamp (ISO string or ms) as a human-readable relative time string.
 * Examples: "just now", "5m ago", "2h ago", "3d ago"
 */
function formatRelativeTime(ts: string | number): string {
  const tsMs = typeof ts === "number" ? ts : new Date(ts).getTime();
  const diffMs = Date.now() - tsMs;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

// ---------------------------------------------------------------------------
// devices list
// ---------------------------------------------------------------------------

function devicesListCommand(): Command {
  return new Command("list")
    .description("List pairing codes for an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      await withContext(async ({ db, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          throw new CliError(
            `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
          );
        }

        const dm = new DeviceManager(db);
        const codes = dm.list(slug);

        if (codes.length === 0) {
          console.log(`No pairing codes found for instance "${slug}".`);
          return;
        }

        console.log(chalk.bold(`\nPairing codes for "${slug}" (${codes.length})`));
        for (const code of codes) {
          const status = code.used_at ? chalk.dim("used") : chalk.green("active");
          const created = formatRelativeTime(code.created_at);
          const usedLabel = code.used_at ? `  used ${formatRelativeTime(code.used_at)}` : "";
          console.log(`  ${code.code}  ${status}  created ${created}${usedLabel}`);
        }
        console.log("");
      });
    });
}

// ---------------------------------------------------------------------------
// devices revoke
// ---------------------------------------------------------------------------

function devicesRevokeCommand(): Command {
  return new Command("revoke")
    .description("Revoke a pairing code")
    .argument("<slug>", "Instance slug")
    .argument("<code>", "Pairing code to revoke")
    .action(async (slug: string, code: string) => {
      await withContext(async ({ db, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          throw new CliError(
            `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
          );
        }

        const dm = new DeviceManager(db);
        const revoked = dm.revoke(slug, code);

        if (revoked) {
          console.log(`Revoked pairing code ${code} from instance "${slug}".`);
        } else {
          throw new CliError(`Pairing code "${code}" not found for instance "${slug}".`);
        }
      });
    });
}

// ---------------------------------------------------------------------------
// devices (root command)
// ---------------------------------------------------------------------------

export function devicesCommand(): Command {
  const devices = new Command("devices").description("Manage device pairing codes for an instance");

  devices.addCommand(devicesListCommand());
  devices.addCommand(devicesRevokeCommand());

  return devices;
}
