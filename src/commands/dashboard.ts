// src/commands/dashboard.ts
import { Command } from "commander";
import { getDbPath, getDashboardTokenPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { logger } from "../lib/logger.js";
import { generateDashboardToken } from "../core/secrets.js";
import { constants } from "../lib/constants.js";
import { LocalConnection } from "../server/local.js";
import { SessionStore } from "../dashboard/session-store.js";
import { parsePositiveInt } from "../lib/validate.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export function dashboardCommand(): Command {
  return new Command("dashboard")
    .description("Start the web dashboard")
    .option("-p, --port <port>", "Dashboard port", String(constants.DASHBOARD_PORT))
    .action(async (opts: { port: string }) => {
      // db stays open intentionally: the dashboard runs until SIGTERM.
      // db.close() is not called because the process exits after startDashboard() resolves.
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const port = parsePositiveInt(opts.port, "--port");

      // Verify that an admin account exists before starting the dashboard
      const adminExists = db
        .prepare("SELECT 1 FROM users WHERE username = ? LIMIT 1")
        .get(constants.ADMIN_USERNAME);
      if (!adminExists) {
        logger.error("No admin account found. Run: claw-pilot auth setup");
        process.exit(1);
      }

      // Get or generate dashboard token
      const tokenPath = getDashboardTokenPath();
      let token: string;
      try {
        token = (await fs.readFile(tokenPath, "utf-8")).trim();
      } catch {
        token = generateDashboardToken();
        await fs.mkdir(path.dirname(tokenPath), { recursive: true });
        await fs.writeFile(tokenPath, token, { mode: 0o600 });
        logger.info(`Dashboard token saved to ${tokenPath}`);
      }

      const sessionStore = new SessionStore(db, constants.SESSION_TTL_MS);

      // Dynamic import to avoid bundling issues
      const { startDashboard } = await import("../dashboard/server.js");
      await startDashboard({ port, token, registry, conn, sessionStore, db });

      logger.success(`Dashboard running at http://localhost:${port}`);
    });
}
