// src/lib/logger.ts
import chalk from "chalk";

export const logger = {
  info(msg: string): void {
    console.log(`${chalk.green("[+]")} ${msg}`);
  },

  warn(msg: string): void {
    console.warn(`${chalk.yellow("[!]")} ${msg}`);
  },

  error(msg: string): void {
    console.error(`${chalk.red("[x]")} ${msg}`);
  },

  step(msg: string): void {
    console.log(`${chalk.cyan("  →")} ${msg}`);
  },

  dim(msg: string): void {
    console.log(chalk.dim(`    ${msg}`));
  },

  success(msg: string): void {
    console.log(`${chalk.green("  ✓")} ${msg}`);
  },

  fail(msg: string): void {
    console.log(`${chalk.red("  ✗")} ${msg}`);
  },
};
