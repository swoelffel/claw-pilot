// src/core/provisioner.ts
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import type { PortAllocator } from "./port-allocator.js";
import type { WizardAnswers } from "./config-generator.js";
import { generateEnv, PROVIDER_ENV_VARS } from "./config-generator.js";
import { PROVIDER_CATALOG } from "../lib/provider-catalog.js";
import { generateGatewayToken } from "./secrets.js";
import { constants } from "../lib/constants.js";
import { getInstancesDir, getRuntimeStateDir } from "../lib/platform.js";
import { InstanceAlreadyExistsError, ClawPilotError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { shellEscape } from "../lib/shell.js";

import { BlueprintDeployer } from "./blueprint-deployer.js";
import { ensureRuntimeConfig } from "../runtime/engine/config-loader.js";
import { importInstanceTeam } from "./team-import.js";

export interface ProvisionResult {
  slug: string;
  port: number;
  stateDir: string;
  gatewayToken: string;
  agentCount: number;
  telegramBot?: string;
}

/** Exported for testing: resolve the API key from answers, reading from existing instance if needed */
export async function resolveApiKey(
  answers: Pick<WizardAnswers, "provider" | "apiKey">,
  registry: Registry,
  conn: ServerConnection,
): Promise<string> {
  let resolvedApiKey = answers.apiKey;

  if (resolvedApiKey === "reuse") {
    const envVar = PROVIDER_ENV_VARS[answers.provider] ?? "";
    const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === answers.provider);
    const requiresKey = catalogEntry?.requiresKey ?? true;

    if (!envVar) {
      // Provider needs no API key and has no env var — nothing to reuse
      return "";
    }

    const existing = registry.listInstances();
    if (existing.length === 0) {
      if (!requiresKey) return ""; // Optional key, no existing instance — OK
      throw new ClawPilotError(
        "No existing instance to reuse API key from",
        "NO_EXISTING_INSTANCE",
      );
    }
    const existingInst = existing[0]!;
    const existingEnvPath = path.join(existingInst.state_dir, ".env");

    let envContent: string;
    try {
      envContent = await conn.readFile(existingEnvPath);
    } catch (err) {
      if (!requiresKey) return ""; // Optional key, .env unreadable — OK
      throw new ClawPilotError(
        `Could not read .env from existing instance "${existingInst.slug}": ${err instanceof Error ? err.message : String(err)}`,
        "ENV_READ_FAILED",
      );
    }

    const match = envContent.match(new RegExp(`${envVar}=(.+)`));
    resolvedApiKey = match?.[1]?.trim() ?? "";
    if (!resolvedApiKey && requiresKey) {
      throw new ClawPilotError(
        `Could not find ${envVar} in existing instance "${existingInst.slug}" .env`,
        "API_KEY_READ_FAILED",
      );
    }
  }

  return resolvedApiKey;
}

export class Provisioner {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private portAllocator: PortAllocator,
  ) {}

  async provision(
    answers: WizardAnswers,
    serverId: number,
    blueprintId?: number,
  ): Promise<ProvisionResult> {
    const { slug } = answers;

    // Step 1: Validation
    if (this.registry.getInstance(slug)) {
      throw new InstanceAlreadyExistsError(slug);
    }
    const portFree = await this.portAllocator.verifyPort(serverId, answers.port);
    if (!portFree) {
      throw new ClawPilotError(`Port ${answers.port} is already in use`, "PORT_CONFLICT");
    }

    const stateDir = getRuntimeStateDir(slug);
    const configPath = path.join(stateDir, "runtime.json");
    const envPath = path.join(stateDir, ".env");
    const logsDir = path.join(stateDir, "logs");

    // Track what has been created so we can roll back on failure
    let stateDirCreated = false;
    let instanceRegistered = false;
    let portAllocated = false;

    try {
      // Step 2: Create directory structure
      logger.step("Creating directories...");
      await this.conn.mkdir(getInstancesDir(), { mode: constants.DIR_MODE });
      await this.conn.mkdir(stateDir, { mode: constants.DIR_MODE });
      await this.conn.mkdir(path.join(stateDir, "workspaces"));
      await this.conn.mkdir(logsDir);
      stateDirCreated = true;

      // Step 3: Generate secrets
      logger.step("Generating secrets...");
      const gatewayToken = generateGatewayToken();

      // Resolve API key
      const resolvedApiKey = await resolveApiKey(answers, this.registry, this.conn);

      const envContent = generateEnv({
        provider: answers.provider,
        apiKey: resolvedApiKey,
        gatewayToken,
        ...(answers.telegram.botToken !== undefined && {
          telegramBotToken: answers.telegram.botToken,
        }),
      });
      await this.conn.writeFile(envPath, envContent, constants.ENV_FILE_MODE);

      // Step 4: Generate runtime.json configuration
      logger.step("Generating configuration...");
      const defaultModel = answers.defaultModel || undefined;
      ensureRuntimeConfig(stateDir, {
        ...(defaultModel !== undefined ? { defaultModel } : {}),
        telegramEnabled: answers.telegram.enabled,
      });

      // Register in registry BEFORE workspaces (lifecycle.start needs registry entry)
      const instance = this.registry.createInstance({
        serverId,
        slug,
        displayName: answers.displayName,
        port: answers.port,
        configPath,
        stateDir,
        systemdUnit: `claw-runtime-${slug}`,
        defaultModel: answers.defaultModel,
        discovered: false,
      });
      instanceRegistered = true;

      // Register port (gateway + sidecar ports P+1, P+2, P+4)
      this.registry.allocatePort(serverId, answers.port, slug);
      this.portAllocator.reserveSidecarPorts(serverId, answers.port, slug);
      portAllocated = true;

      if (answers.blueprintTeamFile) {
        // Blueprint path: delegate to team-import pipeline
        logger.step("Deploying team blueprint...");
        // Inject the wizard-selected model as the team default
        const teamFile = { ...answers.blueprintTeamFile };
        if (!teamFile.defaults) {
          teamFile.defaults = { model: answers.defaultModel };
        } else if (!teamFile.defaults.model) {
          teamFile.defaults = { ...teamFile.defaults, model: answers.defaultModel };
        }
        await importInstanceTeam(
          this.registry.getDb(),
          this.registry,
          this.conn,
          instance,
          teamFile,
          stateDir,
        );
      } else {
        // Manual path: create workspaces + register agents individually
        logger.step("Creating workspaces...");
        const renderedFilesPerAgent = new Map<
          string,
          Array<{ filename: string; content: string }>
        >();
        for (const agent of answers.agents) {
          const workspaceId = agent.workspace ?? agent.id;
          const workspacePath = path.join(stateDir, "workspaces", workspaceId);
          await this.conn.mkdir(workspacePath);
          const rendered = await this.provisionWorkspaceFiles(workspacePath, {
            agentId: agent.id,
            agentName: agent.name,
            instanceSlug: slug,
            instanceName: answers.displayName,
            agents: answers.agents,
          });
          renderedFilesPerAgent.set(agent.id, rendered);
        }

        // Register agents + persist workspace files in DB
        for (const agent of answers.agents) {
          const workspaceId = agent.workspace ?? agent.id;
          this.registry.createAgent(instance.id, {
            agentId: agent.id,
            name: agent.name,
            ...(agent.model !== undefined && { model: agent.model }),
            workspacePath: path.join(stateDir, "workspaces", workspaceId),
            ...(agent.isDefault !== undefined && { isDefault: agent.isDefault }),
          });

          const agentRecord = this.registry.getAgentByAgentId(instance.id, agent.id);
          const renderedFiles = renderedFilesPerAgent.get(agent.id) ?? [];
          if (agentRecord) {
            for (const { filename, content } of renderedFiles) {
              const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
              this.registry.upsertAgentFile(agentRecord.id, { filename, content, contentHash });
            }
          }
        }
      }

      logger.step("claw-runtime instance created — start with 'claw-pilot runtime start'.");

      // Log creation event
      this.registry.logEvent(
        slug,
        "created",
        `Instance created with ${answers.agents.length} agent(s) on port ${answers.port}`,
      );

      // Deploy blueprint (if specified)
      if (blueprintId !== undefined) {
        logger.step("Deploying blueprint agents...");
        const deployer = new BlueprintDeployer(this.conn, this.registry);
        await deployer.deploy(blueprintId, instance);
      }

      return {
        slug,
        port: answers.port,
        stateDir,
        gatewayToken,
        agentCount: answers.agents.length,
        ...(answers.telegram.enabled && { telegramBot: "pending" as const }),
      };
    } catch (err) {
      // Provisioning failed — roll back all created artefacts (best-effort)
      logger.warn(`Provisioning failed — rolling back artefacts for "${slug}"...`);
      await this.rollback({
        slug,
        stateDir,
        serverId,
        stateDirCreated,
        instanceRegistered,
        portAllocated,
        port: answers.port,
      });
      throw err;
    }
  }

  private async rollback(ctx: {
    slug: string;
    stateDir: string;
    serverId: number;
    stateDirCreated: boolean;
    instanceRegistered: boolean;
    portAllocated: boolean;
    port: number;
  }): Promise<void> {
    const { slug, stateDir, serverId, stateDirCreated, instanceRegistered, portAllocated, port } =
      ctx;

    // 1. Remove DB entries (synchronous — no try needed, but wrap for safety)
    if (portAllocated) {
      try {
        this.registry.releasePort(serverId, port);
        this.portAllocator.releaseSidecarPorts(serverId, port);
      } catch {
        /* intentionally ignored — rollback is best-effort, DB may already be clean */
      }
    }
    if (instanceRegistered) {
      try {
        const inst = this.registry.getInstance(slug);
        if (inst) this.registry.deleteAgents(inst.id);
        this.registry.deleteInstance(slug);
      } catch {
        /* intentionally ignored — rollback is best-effort, DB may already be clean */
      }
    }

    // 2. Remove state directory (best-effort)
    if (stateDirCreated) {
      try {
        await this.conn.remove(stateDir, { recursive: true });
      } catch (e) {
        logger.warn(
          `Rollback: failed to remove state dir "${stateDir}" — ${e instanceof Error ? e.message : e}`,
        );
        logger.warn(`  Remove it manually: rm -rf ${shellEscape(stateDir)}`);
      }
    }

    logger.warn(`Rollback complete for "${slug}".`);
  }

  private async provisionWorkspaceFiles(
    workspacePath: string,
    context: {
      agentId: string;
      agentName: string;
      instanceSlug: string;
      instanceName: string;
      agents: WizardAnswers["agents"];
    },
  ): Promise<Array<{ filename: string; content: string }>> {
    // Load templates from the package's templates/workspace directory.
    // In dev: src/core/ → ../../templates/workspace = templates/workspace ✓
    // In prod: dist/ → ../templates/workspace = templates/workspace ✓
    const templateDir = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../templates/workspace",
    );

    const files = constants.TEMPLATE_FILES;
    const date = new Date().toISOString().split("T")[0]!;
    const rendered: Array<{ filename: string; content: string }> = [];

    for (const file of files) {
      const templatePath = path.join(templateDir, file);
      let content: string;
      try {
        content = await fs.readFile(templatePath, "utf-8");
      } catch {
        // Use minimal fallback if template not found
        content = `# ${file}\n`;
      }

      // Simple template substitution (no Handlebars needed for simple cases)
      content = content
        .replace(/\{\{agentId\}\}/g, context.agentId)
        .replace(/\{\{agentName\}\}/g, context.agentName)
        .replace(/\{\{instanceSlug\}\}/g, context.instanceSlug)
        .replace(/\{\{instanceName\}\}/g, context.instanceName)
        .replace(/\{\{date\}\}/g, date)
        .replace(/\{\{#each agents\}\}([\s\S]*?)\{\{\/each\}\}/g, (_match, capturedBlock: string) =>
          context.agents
            .map((a) =>
              capturedBlock
                .replace(/\{\{this\.id\}\}/g, a.id)
                .replace(/\{\{this\.name\}\}/g, a.name),
            )
            .join(""),
        );

      await this.conn.writeFile(path.join(workspacePath, file), content);
      rendered.push({ filename: file, content });
    }
    return rendered;
  }
}
