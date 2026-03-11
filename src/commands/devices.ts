// src/commands/devices.ts
//
// CLI command: claw-pilot devices
// Sub-commands: list, approve, revoke

import { Command } from "commander";
import chalk from "chalk";
import { withContext } from "./_context.js";
import { CliError } from "../lib/errors.js";
import { DeviceManager } from "../core/device-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a timestamp (ms) as a human-readable relative time string.
 * Examples: "just now", "5m ago", "2h ago", "3d ago"
 */
function formatRelativeTime(tsMs: number): string {
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
    .description("List pending and paired devices for an instance")
    .argument("<slug>", "Instance slug")
    .action(async (slug: string) => {
      await withContext(async ({ conn, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          throw new CliError(
            `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
          );
        }

        const dm = new DeviceManager(conn);
        const { pending, paired } = await dm.list(instance.state_dir);

        if (pending.length === 0 && paired.length === 0) {
          console.log(`No devices found for instance "${slug}".`);
          return;
        }

        // --- Pending ---
        console.log(chalk.yellow(`\nPending (${pending.length})`));
        for (const d of pending) {
          const id = d.requestId.slice(0, 8);
          const time = formatRelativeTime(d.ts);
          console.log(chalk.yellow(`  ${id}  ${d.platform}  ${d.clientId}  ${time}`));
        }

        // --- Paired ---
        console.log(`\nPaired (${paired.length})`);
        for (const d of paired) {
          const id = d.deviceId.slice(0, 8);
          // Find the most recently used token's lastUsedAtMs, or fall back to approvedAtMs
          const tokenEntries = Object.values(d.tokens);
          const lastUsedMs =
            tokenEntries.length > 0
              ? (tokenEntries[0]?.lastUsedAtMs ?? d.approvedAtMs)
              : d.approvedAtMs;
          const time = formatRelativeTime(lastUsedMs);
          console.log(`  ${id}  ${d.platform}  ${d.clientId}  ${d.role}  last used ${time}`);
        }

        console.log("");
      });
    });
}

// ---------------------------------------------------------------------------
// devices approve
// ---------------------------------------------------------------------------

function devicesApproveCommand(): Command {
  return new Command("approve")
    .description("Approve a pending device pairing request")
    .argument("<slug>", "Instance slug")
    .argument("[requestId]", "Request ID to approve (omit to approve all pending)")
    .action(async (slug: string, requestId: string | undefined) => {
      await withContext(async ({ conn, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          throw new CliError(
            `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
          );
        }

        const dm = new DeviceManager(conn);
        const { pending } = await dm.list(instance.state_dir);

        if (pending.length === 0) {
          console.log(`No pending device requests for instance "${slug}".`);
          return;
        }

        if (requestId) {
          // Approve a specific request
          await dm.approve(instance.state_dir, requestId);
          console.log(`Approved device request ${requestId.slice(0, 8)} for instance "${slug}".`);
        } else {
          // Approve all pending requests
          for (const d of pending) {
            await dm.approve(instance.state_dir, d.requestId);
            console.log(
              `Approved device request ${d.requestId.slice(0, 8)} for instance "${slug}".`,
            );
          }
        }
      });
    });
}

// ---------------------------------------------------------------------------
// devices revoke
// ---------------------------------------------------------------------------

function devicesRevokeCommand(): Command {
  return new Command("revoke")
    .description("Revoke a paired device")
    .argument("<slug>", "Instance slug")
    .argument("<deviceId>", "Device ID to revoke")
    .action(async (slug: string, deviceId: string) => {
      await withContext(async ({ conn, registry }) => {
        const instance = registry.getInstance(slug);
        if (!instance) {
          throw new CliError(
            `Instance "${slug}" not found. Run 'claw-pilot list' to see available instances.`,
          );
        }

        const dm = new DeviceManager(conn);
        const { paired } = await dm.list(instance.state_dir);

        // Verify the device exists in the paired list
        const found = paired.find(
          (d) => d.deviceId === deviceId || d.deviceId.startsWith(deviceId),
        );
        if (!found) {
          throw new CliError(
            `Device "${deviceId}" not found in paired devices for instance "${slug}".`,
          );
        }

        await dm.revoke(instance.state_dir, found.deviceId);
        console.log(`Revoked device ${found.deviceId.slice(0, 8)} from instance "${slug}".`);
      });
    });
}

// ---------------------------------------------------------------------------
// devices (root command)
// ---------------------------------------------------------------------------

export function devicesCommand(): Command {
  const devices = new Command("devices").description(
    "Manage device pairing for an OpenClaw instance",
  );

  devices.addCommand(devicesListCommand());
  devices.addCommand(devicesApproveCommand());
  devices.addCommand(devicesRevokeCommand());

  return devices;
}
