// src/wizard/wizard.ts
import { confirm } from "@inquirer/prompts";
import type { Registry } from "../core/registry.js";
import type { PortAllocator } from "../core/port-allocator.js";
import type { ServerConnection } from "../server/connection.js";
import type { WizardAnswers } from "../core/config-generator.js";
import {
  promptSlug,
  promptPort,
  promptAgents,
  promptModel,
  promptProvider,
  promptTelegram,
  promptMem0,
} from "./prompts.js";
import chalk from "chalk";

export async function runWizard(
  registry: Registry,
  portAllocator: PortAllocator,
  conn: ServerConnection,
  serverId: number,
): Promise<WizardAnswers> {
  console.log(chalk.bold("\n=== New OpenClaw instance wizard ===\n"));

  // Step 1: Identity
  const { slug, displayName } = await promptSlug(registry);

  // Step 2: Port
  const port = await promptPort(portAllocator, serverId);

  // Step 3: Agent team
  const { agents } = await promptAgents();

  // Step 4: Default model
  const defaultModel = await promptModel();

  // Step 5: Provider + API key
  const existingInstances = registry.listInstances();
  const { provider, apiKey } = await promptProvider(existingInstances);

  // Step 6: Telegram
  const telegram = await promptTelegram();

  // Step 7: mem0
  const mem0 = await promptMem0(conn);

  // Step 8: Summary + confirmation
  console.log(chalk.bold("\n=== Summary ==="));
  console.log(`  Slug:        ${slug}`);
  console.log(`  Name:        ${displayName}`);
  console.log(`  Port:        ${port}`);
  console.log(`  Agents:      ${agents.map((a) => a.id).join(", ")}`);
  console.log(`  Model:       ${defaultModel}`);
  console.log(`  Provider:    ${provider}`);
  console.log(
    `  API key:     ${apiKey === "reuse" ? "reuse from existing" : apiKey ? "new key" : "none (not required)"}`,
  );
  console.log(`  Telegram:    ${telegram.enabled ? "yes" : "no"}`);
  console.log(`  mem0:        ${mem0.enabled ? "yes" : "no"}`);
  console.log("");

  const confirmed = await confirm({
    message: "Proceed with provisioning?",
    default: true,
  });

  if (!confirmed) {
    throw new Error("Wizard cancelled by user");
  }

  return {
    slug,
    displayName,
    port,
    agents,
    defaultModel,
    provider,
    apiKey,
    telegram,
    mem0,
  };
}
