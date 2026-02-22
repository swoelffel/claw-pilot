// src/commands/init.ts
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import {
  getDataDir,
  getDbPath,
  getOpenClawHome,
} from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { InstanceDiscovery } from "../core/discovery.js";
import { OpenClawCLI } from "../core/openclaw-cli.js";
import { LocalConnection } from "../server/local.js";
import { logger } from "../lib/logger.js";
import { constants } from "../lib/constants.js";

export function initCommand(): Command {
  return new Command("init")
    .description(
      "Initialize Claw Pilot (registry + discover existing instances)",
    )
    .option("--yes", "Non-interactive mode — adopt all discovered instances")
    .action(async (opts: { yes?: boolean }) => {
      const conn = new LocalConnection();

      // 1. Create data directory
      await conn.mkdir(getDataDir(), { mode: 0o700 });

      // 2. Initialize database
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);

      // 3. Detect OpenClaw (offer to install if missing)
      const cli = new OpenClawCLI(conn);
      let openclaw = await cli.detect();
      if (!openclaw) {
        const installUrl =
          process.env["OPENCLAW_INSTALL_URL"] ?? constants.OPENCLAW_INSTALL_URL;
        logger.warn("OpenClaw CLI not found.");

        const shouldInstall =
          opts.yes ??
          (await confirm({
            message: `Install OpenClaw automatically? (from ${installUrl})`,
            default: true,
          }));

        if (shouldInstall) {
          logger.info("Installing OpenClaw...");
          const installed = await cli.install();
          if (!installed) {
            logger.error(
              `OpenClaw installation failed. Install manually: ${installUrl}`,
            );
            logger.warn(
              "Continuing without OpenClaw — create/start commands will not work.",
            );
          } else {
            openclaw = await cli.detect();
            if (openclaw) {
              logger.success(`OpenClaw installed: ${openclaw.version}`);
            }
          }
        } else {
          logger.warn(
            "Skipping OpenClaw install — create/start commands will not work until it is installed.",
          );
        }
      } else {
        logger.info(`OpenClaw detected: ${openclaw.version}`);
      }

      // 4. Register local server
      const hostname = await conn.hostname();
      const openclawHome = getOpenClawHome();
      const server = registry.upsertLocalServer(hostname, openclawHome);
      if (openclaw) {
        registry.updateServerBin(openclaw.bin, openclaw.version);
      }

      // 5. Discover existing instances
      logger.info("\nScanning for existing OpenClaw instances...");
      const discovery = new InstanceDiscovery(conn, registry, openclawHome);
      const result = await discovery.scan();

      // 5a. Display results
      if (result.instances.length === 0) {
        logger.dim("No existing instances found.");
      } else {
        for (const inst of result.instances) {
          const stateLabel = inst.gatewayHealthy
            ? "healthy"
            : inst.systemdState === "active"
              ? "active"
              : "stopped";
          const registeredLabel = result.newInstances.includes(inst)
            ? "NEW"
            : "registered";
          logger.step(
            `[${registeredLabel}] ${inst.slug}  port:${inst.port}  ` +
              `systemd:${inst.systemdState ?? "none"}  gateway:${stateLabel}  ` +
              `agents:${inst.agents.length}  (source: ${inst.source})`,
          );
        }
      }

      // 5b. Adopt new instances
      if (result.newInstances.length > 0) {
        const adoptAll =
          opts.yes ??
          (await confirm({
            message: `Adopt ${result.newInstances.length} new instance(s) into Claw Pilot registry?`,
            default: true,
          }));

        if (adoptAll) {
          for (const inst of result.newInstances) {
            await discovery.adopt(inst, server.id);
            logger.success(
              `Adopted: ${inst.slug} (${inst.agents.length} agents, port ${inst.port})`,
            );
          }
        }
      }

      // 5c. Handle removed instances
      if (result.removedSlugs.length > 0) {
        logger.warn(
          "\nInstances in registry but no longer found on disk:",
        );
        for (const slug of result.removedSlugs) {
          logger.step(`- ${slug}`);
        }
        const removeStale =
          opts.yes === true
            ? false // conservative: don't auto-delete in --yes mode
            : await confirm({
                message: `Remove ${result.removedSlugs.length} stale instance(s) from registry?`,
                default: false,
              });

        if (removeStale) {
          for (const slug of result.removedSlugs) {
            const instance = registry.getInstance(slug);
            if (instance) {
              registry.releasePort(instance.server_id, instance.port);
              registry.deleteAgents(instance.id);
              registry.deleteInstance(slug);
              logger.success(`Removed: ${slug}`);
            }
          }
        }
      }

      // 6. Detect shared resources
      logger.info("\nShared resources:");
      const [ollamaResult, qdrantResult, dockerResult] = await Promise.all([
        conn.exec(
          "curl -s http://127.0.0.1:11434/api/version 2>/dev/null || true",
        ),
        conn.exec(
          "curl -s http://127.0.0.1:6333/healthz 2>/dev/null || true",
        ),
        conn.exec(
          "docker info --format '{{.ServerVersion}}' 2>/dev/null || true",
        ),
      ]);
      logger.step(
        `Ollama:  ${ollamaResult.stdout.trim() ? "running" : "not detected"}`,
      );
      logger.step(
        `Qdrant:  ${qdrantResult.stdout.includes("ok") ? "running" : "not detected"}`,
      );
      logger.step(
        `Docker:  ${dockerResult.stdout.trim() || "not detected"}`,
      );

      // 7. Summary
      const totalInstances = registry.listInstances().length;
      logger.info(
        `\n${totalInstances} instance(s) in registry.`,
      );
      logger.info("Ready. Run 'claw-pilot create' to provision a new instance.");

      db.close();
    });
}
