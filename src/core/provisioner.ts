// src/core/provisioner.ts
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import type { WizardAnswers } from "./config-generator.js";
import { generateEnv } from "./config-generator.js";
import { generateGatewayToken } from "../lib/crypto.js";
import { constants } from "../lib/constants.js";
import { getInstancesDir, getRuntimeStateDir, deriveWebChatPort } from "../lib/platform.js";
import { InstanceAlreadyExistsError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { shellEscape } from "../lib/shell.js";

import { BlueprintDeployer } from "./blueprint-deployer.js";
import { ensureRuntimeConfig } from "../runtime/engine/config-loader.js";
import { importInstanceTeam } from "./team-import.js";
import type { RuntimeConfig } from "../runtime/config/index.js";

export interface ProvisionResult {
  slug: string;
  port: number;
  stateDir: string;
  gatewayToken: string;
  agentCount: number;
  telegramBot?: string;
}

export class Provisioner {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  async provision(
    answers: WizardAnswers,
    serverId: number,
    blueprintId?: number,
  ): Promise<ProvisionResult> {
    const { slug } = answers;
    const port = deriveWebChatPort(slug);

    // Step 1: Validation
    if (this.registry.getInstance(slug)) {
      throw new InstanceAlreadyExistsError(slug);
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
      await this._createInstanceDirs(stateDir, logsDir);
      stateDirCreated = true;

      // Step 3: Generate secrets
      const gatewayToken = await this._generateInstanceSecrets(envPath, answers);

      // Step 4: Generate runtime.json configuration + register instance
      const { instance, runtimeConfig } = this._registerInstance(
        serverId,
        slug,
        port,
        configPath,
        stateDir,
        answers,
      );
      instanceRegistered = true;

      // Register port in the ports table
      this.registry.allocatePort(serverId, port, slug);
      portAllocated = true;

      // Step 5: Create agents (blueprint-team or manual)
      await this._provisionAgents(answers, instance, runtimeConfig, stateDir, slug);

      logger.step("claw-runtime instance created — start with 'claw-pilot runtime start'.");

      // Log creation event
      this.registry.logEvent(
        slug,
        "created",
        `Instance created with ${answers.agents.length} agent(s) on port ${port}`,
      );

      // Deploy blueprint (if specified)
      if (blueprintId !== undefined) {
        logger.step("Deploying blueprint agents...");
        const deployer = new BlueprintDeployer(this.conn, this.registry);
        await deployer.deploy(blueprintId, instance);
      }

      return {
        slug,
        port,
        stateDir,
        gatewayToken,
        agentCount: answers.agents.length,
        ...(answers.telegram.enabled && { telegramBot: "pending" as const }),
      };
    } catch (err) {
      // Provisioning failed — roll back all created artefacts (best-effort)
      logger.warn(`Provisioning failed — rolling back artefacts for "${slug}"...`);
      await this._rollback({
        slug,
        stateDir,
        serverId,
        stateDirCreated,
        instanceRegistered,
        portAllocated,
        port,
      });
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // Private: Directory creation
  // ------------------------------------------------------------------

  /** Create the instance directory structure (state, workspaces, logs). */
  private async _createInstanceDirs(stateDir: string, logsDir: string): Promise<void> {
    logger.step("Creating directories...");
    await this.conn.mkdir(getInstancesDir(), { mode: constants.DIR_MODE });
    await this.conn.mkdir(stateDir, { mode: constants.DIR_MODE });
    await this.conn.mkdir(path.join(stateDir, "workspaces"));
    await this.conn.mkdir(path.join(stateDir, "workspaces", constants.SHARED_WORKSPACE_DIR));
    await this.conn.mkdir(logsDir);
  }

  // ------------------------------------------------------------------
  // Private: Secret generation
  // ------------------------------------------------------------------

  /** Generate gateway token and write the .env file. Returns the gateway token. */
  private async _generateInstanceSecrets(envPath: string, answers: WizardAnswers): Promise<string> {
    logger.step("Generating secrets...");
    const gatewayToken = generateGatewayToken();

    const envContent = generateEnv({
      gatewayToken,
      ...(answers.telegram.botToken !== undefined && {
        telegramBotToken: answers.telegram.botToken,
      }),
    });
    await this.conn.writeFile(envPath, envContent, constants.ENV_FILE_MODE);

    return gatewayToken;
  }

  // ------------------------------------------------------------------
  // Private: Instance registration
  // ------------------------------------------------------------------

  /** Register the instance in the DB and persist runtime config. */
  private _registerInstance(
    serverId: number,
    slug: string,
    port: number,
    configPath: string,
    stateDir: string,
    answers: WizardAnswers,
  ): { instance: ReturnType<Registry["createInstance"]>; runtimeConfig: RuntimeConfig } {
    logger.step("Generating configuration...");
    const defaultModel = answers.defaultModel || undefined;
    const runtimeConfig = ensureRuntimeConfig(stateDir, {
      ...(defaultModel !== undefined ? { defaultModel } : {}),
      telegramEnabled: answers.telegram.enabled,
    });

    const instance = this.registry.createInstance({
      serverId,
      slug,
      displayName: answers.displayName,
      port,
      configPath,
      stateDir,
      systemdUnit: `claw-runtime-${slug}`,
      defaultModel: answers.defaultModel,
      discovered: false,
    });

    // Persist runtime config to DB so exportSnapshot() can read it back
    this.registry.saveRuntimeConfig(slug, runtimeConfig);

    return { instance, runtimeConfig };
  }

  // ------------------------------------------------------------------
  // Private: Agent provisioning
  // ------------------------------------------------------------------

  /** Provision agents via blueprint-team import or manual workspace creation. */
  private async _provisionAgents(
    answers: WizardAnswers,
    instance: ReturnType<Registry["createInstance"]>,
    runtimeConfig: RuntimeConfig,
    stateDir: string,
    slug: string,
  ): Promise<void> {
    if (answers.blueprintTeamFile) {
      await this._provisionFromTeamFile(answers, instance, stateDir);
    } else {
      await this._provisionManualAgents(answers, instance, runtimeConfig, stateDir, slug);
    }
  }

  /** Provision agents from a .team.yaml blueprint file. */
  private async _provisionFromTeamFile(
    answers: WizardAnswers,
    instance: ReturnType<Registry["createInstance"]>,
    stateDir: string,
  ): Promise<void> {
    logger.step("Deploying team blueprint...");
    // Inject the wizard-selected model as the team default
    const teamFile = { ...answers.blueprintTeamFile! };
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
  }

  /** Provision agents manually: create workspaces + register agents individually. */
  private async _provisionManualAgents(
    answers: WizardAnswers,
    instance: ReturnType<Registry["createInstance"]>,
    runtimeConfig: RuntimeConfig,
    stateDir: string,
    slug: string,
  ): Promise<void> {
    logger.step("Creating workspaces...");
    const renderedFilesPerAgent = new Map<string, Array<{ filename: string; content: string }>>();
    for (const agent of answers.agents) {
      const workspaceId = agent.workspace ?? agent.id;
      const workspacePath = path.join(stateDir, "workspaces", workspaceId);
      await this.conn.mkdir(workspacePath);
      const rendered = await this._provisionWorkspaceFiles(workspacePath, {
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

    // Sync RuntimeConfig agents with actual WizardAnswers IDs.
    // ensureRuntimeConfig() generates a default "pilot" agent — we need to overwrite
    // the agents list so that agent IDs match the DB records and workspace directories.
    const defaults = runtimeConfig.agents[0]!;
    const syncedConfig = {
      ...runtimeConfig,
      agents: answers.agents.map((agent) => ({
        ...defaults,
        id: agent.id,
        name: agent.name,
        ...(agent.model !== undefined ? { model: agent.model } : {}),
        ...(agent.isDefault !== undefined ? { isDefault: agent.isDefault } : {}),
      })),
    };
    this.registry.saveRuntimeConfig(slug, syncedConfig);
  }

  // ------------------------------------------------------------------
  // Private: Rollback
  // ------------------------------------------------------------------

  private async _rollback(ctx: {
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
      } catch (err) {
        logger.debug("[provisioner] rollback releasePort failed (best-effort)", {
          error: String(err),
        });
      }
    }
    if (instanceRegistered) {
      try {
        const inst = this.registry.getInstance(slug);
        if (inst) this.registry.deleteAgents(inst.id);
        this.registry.deleteInstance(slug);
      } catch (err) {
        logger.debug("[provisioner] rollback deleteInstance failed (best-effort)", {
          error: String(err),
        });
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

  // ------------------------------------------------------------------
  // Private: Workspace file provisioning
  // ------------------------------------------------------------------

  private async _provisionWorkspaceFiles(
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
      } catch (err) {
        logger.debug("[provisioner] template file not found, using fallback", {
          error: String(err),
        });
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
