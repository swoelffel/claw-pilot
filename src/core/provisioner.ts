// src/core/provisioner.ts
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ServerConnection } from "../server/connection.js";
import type { Registry } from "./registry.js";
import type { PortAllocator } from "./port-allocator.js";
import type { WizardAnswers } from "./config-generator.js";
import { generateConfig, generateEnv, PROVIDER_ENV_VARS } from "./config-generator.js";
import { generateSystemdService } from "./systemd-generator.js";
import { generateNginxVhost } from "./nginx-generator.js";
import { generateGatewayToken } from "./secrets.js";
import { OpenClawCLI } from "./openclaw-cli.js";
import { Lifecycle } from "./lifecycle.js";
import { constants } from "../lib/constants.js";
import { getOpenClawHome, getSystemdDir, getSystemdUnit } from "../lib/platform.js";
import { InstanceAlreadyExistsError, ClawPilotError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { shellEscape } from "../lib/shell.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { BlueprintDeployer } from "./blueprint-deployer.js";

export interface ProvisionResult {
  slug: string;
  port: number;
  stateDir: string;
  gatewayToken: string;
  agentCount: number;
  telegramBot?: string;
  nginxDomain?: string;
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

    if (!envVar) {
      // Provider needs no API key (e.g. opencode) — nothing to reuse
      return "";
    }

    const existing = registry.listInstances();
    if (existing.length === 0) {
      throw new ClawPilotError("No existing instance to reuse API key from", "NO_EXISTING_INSTANCE");
    }
    const existingInst = existing[0]!;
    const existingEnvPath = path.join(existingInst.state_dir, ".env");

    let envContent: string;
    try {
      envContent = await conn.readFile(existingEnvPath);
    } catch (err) {
      throw new ClawPilotError(
        `Could not read .env from existing instance "${existingInst.slug}": ${err instanceof Error ? err.message : String(err)}`,
        "ENV_READ_FAILED",
      );
    }

    const match = envContent.match(new RegExp(`${envVar}=(.+)`));
    resolvedApiKey = match?.[1]?.trim() ?? "";
    if (!resolvedApiKey) {
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

  async provision(answers: WizardAnswers, serverId: number, blueprintId?: number): Promise<ProvisionResult> {
    const { slug } = answers;

    // Step 1: Validation
    if (this.registry.getInstance(slug)) {
      throw new InstanceAlreadyExistsError(slug);
    }
    const portFree = await this.portAllocator.verifyPort(serverId, answers.port);
    if (!portFree) {
      throw new ClawPilotError(
        `Port ${answers.port} is already in use`,
        "PORT_CONFLICT",
      );
    }

    const openclawHome = getOpenClawHome();
    const stateDir = path.join(
      openclawHome,
      `${constants.OPENCLAW_STATE_PREFIX}${slug}`,
    );
    const configPath = path.join(stateDir, "openclaw.json");
    const envPath = path.join(stateDir, ".env");
    const logsDir = path.join(stateDir, "logs");
    const systemdUnit = getSystemdUnit(slug);
    const systemdDir = getSystemdDir();
    const serviceFile = path.join(systemdDir, systemdUnit);

    // Detect openclaw binary
    const cli = new OpenClawCLI(this.conn);
    const openclaw = await cli.detect();
    if (!openclaw) {
      throw new ClawPilotError(
        "OpenClaw CLI not found",
        "OPENCLAW_NOT_FOUND",
      );
    }

    // Resolve current user UID for XDG_RUNTIME_DIR in systemd service
    const xdgRuntimeDir = await resolveXdgRuntimeDir(this.conn);
    // Extract uid from xdgRuntimeDir for the systemd service template
    const uid = parseInt(xdgRuntimeDir.split("/").pop() ?? "1000", 10) || 1000;

    // Step 2: Create directory structure
    logger.step("Creating directories...");
    await this.conn.mkdir(stateDir, { mode: constants.DIR_MODE });
    await this.conn.mkdir(path.join(stateDir, "workspaces"));
    await this.conn.mkdir(logsDir);

    // Step 3: Generate secrets
    logger.step("Generating secrets...");
    const gatewayToken = generateGatewayToken();

    // Resolve API key
    const resolvedApiKey = await resolveApiKey(answers, this.registry, this.conn);

    const envContent = generateEnv({
      provider: answers.provider,
      apiKey: resolvedApiKey,
      gatewayToken,
      telegramBotToken: answers.telegram.botToken,
    });
    await this.conn.writeFile(envPath, envContent, constants.ENV_FILE_MODE);

    // Step 4: Generate openclaw.json
    logger.step("Generating configuration...");
    const configContent = generateConfig(answers);
    await this.conn.writeFile(configPath, configContent, constants.CONFIG_FILE_MODE);

    // Step 5: Create workspaces
    logger.step("Creating workspaces...");
    for (const agent of answers.agents) {
      const workspaceId = agent.workspace ?? (agent.isDefault ? "workspace" : `workspace-${agent.id}`);
      const workspacePath = path.join(stateDir, "workspaces", workspaceId);
      await this.conn.mkdir(workspacePath);
      await this.provisionWorkspaceFiles(workspacePath, {
        agentId: agent.id,
        agentName: agent.name,
        instanceSlug: slug,
        instanceName: answers.displayName,
        agents: answers.agents,
      });
    }

    // Step 6: Generate and install systemd service
    logger.step("Installing systemd service...");
    const serviceContent = generateSystemdService({
      slug,
      displayName: answers.displayName,
      port: answers.port,
      stateDir,
      configPath,
      openclawHome,
      openclawBin: openclaw.bin,
      uid,
    });
    await this.conn.mkdir(systemdDir);
    await this.conn.writeFile(serviceFile, serviceContent);

    const lifecycle = new Lifecycle(this.conn, this.registry, xdgRuntimeDir);

    // Register in registry BEFORE start (lifecycle.start needs registry entry)
    const instance = this.registry.createInstance({
      serverId,
      slug,
      displayName: answers.displayName,
      port: answers.port,
      configPath,
      stateDir,
      systemdUnit,
      telegramBot: answers.telegram.enabled
        ? undefined // will be set after pairing
        : undefined,
      nginxDomain: answers.nginx.domain,
      defaultModel: answers.defaultModel,
      discovered: false,
    });

    // Register port
    this.registry.allocatePort(serverId, answers.port, slug);
    // Register agents
    for (const agent of answers.agents) {
      const workspaceId = agent.workspace ?? (agent.isDefault ? "workspace" : `workspace-${agent.id}`);
      this.registry.createAgent(instance.id, {
        agentId: agent.id,
        name: agent.name,
        model: agent.model,
        workspacePath: path.join(stateDir, "workspaces", workspaceId),
        isDefault: agent.isDefault,
      });
    }

    await lifecycle.daemonReload();

    // Step 7: Enable and start instance
    logger.step("Starting instance...");
    await lifecycle.enable(slug);
    await lifecycle.start(slug);

    // Step 8: Install mem0 plugin (if enabled)
    if (answers.mem0.enabled) {
      logger.step("Installing mem0 plugin...");
      await cli.installPlugin(slug, stateDir, configPath, "@mem0/openclaw-mem0@0.1.2");
      // Re-inject OSS config (trap 4: plugin install overwrites config)
      const updatedConfig = generateConfig(answers);
      await this.conn.writeFile(configPath, updatedConfig, constants.CONFIG_FILE_MODE);
      await lifecycle.restart(slug);
    }

    // Step 9: Nginx (if enabled)
    if (answers.nginx.enabled && answers.nginx.domain) {
      logger.step("Configuring Nginx...");
      const vhostContent = generateNginxVhost({
        slug,
        domain: answers.nginx.domain,
        port: answers.port,
        certPath: answers.nginx.certPath ?? "",
        keyPath: answers.nginx.keyPath ?? "",
      });
      const vhostPath = `/etc/nginx/sites-available/${answers.nginx.domain}`;
      const enabledPath = `/etc/nginx/sites-enabled/${answers.nginx.domain}`;
      await this.conn.writeFile(vhostPath, vhostContent);
      await this.conn.exec(`sudo ln -sf ${shellEscape(vhostPath)} ${shellEscape(enabledPath)}`);
      await this.conn.exec("sudo nginx -t && sudo systemctl reload nginx");
    }

    // Log creation event
    this.registry.logEvent(
      slug,
      "created",
      `Instance created with ${answers.agents.length} agent(s) on port ${answers.port}`,
    );

    // Step 10: Deploy blueprint (if specified)
    if (blueprintId !== undefined) {
      logger.step("Deploying blueprint agents...");
      const deployer = new BlueprintDeployer(this.conn, this.registry);
      await deployer.deploy(blueprintId, instance);
      // Restart daemon to pick up new agents
      await lifecycle.restart(slug);
    }

    return {
      slug,
      port: answers.port,
      stateDir,
      gatewayToken,
      agentCount: answers.agents.length,
      telegramBot: answers.telegram.enabled ? "pending" : undefined,
      nginxDomain: answers.nginx.domain,
    };
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
  ): Promise<void> {
    // Load templates from the package's templates/workspace directory.
    // In dev: src/core/ → ../../templates/workspace = templates/workspace ✓
    // In prod: dist/ → ../templates/workspace = templates/workspace ✓
    const templateDir = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../templates/workspace",
    );

    const files = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md", "MEMORY.md"];
    const date = new Date().toISOString().split("T")[0]!;

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
        .replace(
          /\{\{#each agents\}\}([\s\S]*?)\{\{\/each\}\}/g,
          context.agents
            .map((a) =>
              `$1`
                .replace(/\{\{this\.id\}\}/g, a.id)
                .replace(/\{\{this\.name\}\}/g, a.name),
            )
            .join(""),
        );

      await this.conn.writeFile(path.join(workspacePath, file), content);
    }
  }
}
