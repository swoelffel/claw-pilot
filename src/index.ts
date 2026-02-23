// src/index.ts
import { Command } from "commander";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
import { initCommand } from "./commands/init.js";
import { createCommand } from "./commands/create.js";
import { destroyCommand } from "./commands/destroy.js";
import { listCommand } from "./commands/list.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { restartCommand } from "./commands/restart.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { doctorCommand } from "./commands/doctor.js";
import { serviceCommand } from "./commands/service.js";
import { tokenCommand } from "./commands/token.js";

const program = new Command();

program
  .name("claw-pilot")
  .description("Orchestrator for OpenClaw multi-instance clusters")
  .version(version);

program.addCommand(initCommand());
program.addCommand(createCommand());
program.addCommand(destroyCommand());
program.addCommand(listCommand());
program.addCommand(startCommand());
program.addCommand(stopCommand());
program.addCommand(restartCommand());
program.addCommand(statusCommand());
program.addCommand(logsCommand());
program.addCommand(dashboardCommand());
program.addCommand(doctorCommand());
program.addCommand(serviceCommand());
program.addCommand(tokenCommand());

// Global error handler for unhandled async errors
process.on("unhandledRejection", (err) => {
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error("Unknown error:", err);
  }
  process.exit(1);
});

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof Error && err.message !== "(outputHelp)") {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
