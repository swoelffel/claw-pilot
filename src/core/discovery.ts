// src/core/discovery.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import type { AgentSync } from "./agent-sync.js";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";
import { getInstancesDir, getRuntimePid } from "../lib/platform.js";
import { normaliseModel } from "../lib/model-helpers.js";

export interface DiscoveredAgent {
  id: string;
  name: string;
  model: string | null;
  workspacePath: string;
  isDefault: boolean;
}

export interface DiscoveredInstance {
  slug: string;
  stateDir: string;
  configPath: string;
  port: number;
  agents: DiscoveredAgent[];
  runtimeRunning: boolean;
  pid: number | null;
  telegramBot: string | null;
  defaultModel: string | null;
  source: "directory" | "port";
}

export interface DiscoveryResult {
  instances: DiscoveredInstance[];
  newInstances: DiscoveredInstance[];
  removedSlugs: string[];
  unchangedSlugs: string[];
}

export class InstanceDiscovery {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private instancesDir: string,
    private xdgRuntimeDir: string,
  ) {}

  /**
   * Scan the local system for existing claw-runtime instances.
   * Returns all discovered instances along with their reconciliation status
   * against the current registry.
   *
   * Strategy:
   *   1. Directory scan for <slug>/ under ~/.claw-pilot/instances/
   *   2. Reconcile against registry
   */
  async scan(): Promise<DiscoveryResult> {
    const found = new Map<string, DiscoveredInstance>();

    await this.scanDirectories(found);

    return this.reconcile(found);
  }

  // --- Strategy 1: Directory scan for instances/ ---

  private async scanDirectories(found: Map<string, DiscoveredInstance>): Promise<void> {
    let entries: string[];

    try {
      entries = await this.conn.readdir(this.instancesDir);
    } catch {
      // Directory not accessible — skip
      return;
    }

    for (const entry of entries) {
      const slug = entry;
      if (!slug || found.has(slug)) continue;

      const stateDir = `${this.instancesDir}/${entry}`;
      const configPath = `${stateDir}/runtime.json`;

      if (!(await this.conn.exists(configPath))) continue;

      const instance = await this.parseInstance(slug, stateDir, configPath, "directory");
      if (instance) found.set(slug, instance);
    }
  }

  // --- Shared parsing logic ---

  private async parseInstance(
    slug: string,
    stateDir: string,
    configPath: string,
    source: DiscoveredInstance["source"],
  ): Promise<DiscoveredInstance | null> {
    let configRaw: string;
    try {
      configRaw = await this.conn.readFile(configPath);
    } catch (err) {
      logger.dim(`[discovery] Cannot read config at ${configPath}: ${err}`);
      return null;
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configRaw) as Record<string, unknown>;
    } catch (err) {
      logger.dim(`[discovery] Invalid JSON in ${configPath}: ${err}`);
      return null;
    }

    // Extract port from runtime.json
    const port = config["port"] as number | undefined;
    if (typeof port !== "number") return null;

    // Extract agents from runtime.json agents[] array
    const agents: DiscoveredAgent[] = [];
    const agentsList = (config["agents"] ?? []) as Array<Record<string, unknown>>;
    const defaultModel: string | null = normaliseModel(config["defaultModel"]);

    if (agentsList.length === 0) {
      // Synthetic pilot agent
      agents.push({
        id: "pilot",
        name: "Pilot",
        model: defaultModel,
        workspacePath: `${stateDir}/workspaces/pilot`,
        isDefault: true,
      });
    }

    for (const agent of agentsList) {
      if (!agent["id"]) continue;
      const agentId = agent["id"] as string;
      const isDefault =
        (agent["isDefault"] as boolean | undefined) === true ||
        (agent["default"] as boolean | undefined) === true ||
        agentId === "pilot";

      const explicitWorkspace = agent["workspace"] as string | undefined;
      let workspacePath: string;
      if (explicitWorkspace) {
        workspacePath = explicitWorkspace.startsWith("/")
          ? explicitWorkspace
          : `${stateDir}/workspaces/${explicitWorkspace}`;
      } else {
        workspacePath = `${stateDir}/workspaces/${agentId}`;
      }

      agents.push({
        id: agentId,
        name: (agent["name"] as string | undefined) ?? agentId,
        model: normaliseModel(agent["model"]) ?? defaultModel,
        workspacePath,
        isDefault,
      });
    }

    // Check PID file for running status
    const pid = getRuntimePid(stateDir);
    const runtimeRunning = pid !== null;

    // Telegram bot (from runtime.json channels config if present)
    let telegramBot: string | null = null;
    const channels = config["channels"] as Record<string, unknown> | undefined;
    const telegram = channels?.["telegram"] as Record<string, unknown> | undefined;
    if (telegram?.["botUsername"]) {
      telegramBot = `@${telegram["botUsername"]}`;
    }

    return {
      slug,
      stateDir,
      configPath,
      port,
      agents,
      runtimeRunning,
      pid,
      telegramBot,
      defaultModel,
      source,
    };
  }

  // --- Reconciliation ---

  private reconcile(found: Map<string, DiscoveredInstance>): DiscoveryResult {
    const registered = new Map(this.registry.listInstances().map((i) => [i.slug, i]));

    const newInstances: DiscoveredInstance[] = [];
    const unchangedSlugs: string[] = [];
    const removedSlugs: string[] = [];

    for (const [slug, instance] of found) {
      if (registered.has(slug)) {
        unchangedSlugs.push(slug);
      } else {
        newInstances.push(instance);
      }
    }

    for (const [slug] of registered) {
      if (!found.has(slug)) {
        removedSlugs.push(slug);
      }
    }

    return {
      instances: [...found.values()],
      newInstances,
      removedSlugs,
      unchangedSlugs,
    };
  }

  /**
   * Adopt a discovered instance into the registry.
   *
   * @param agentSync - Optional AgentSync instance. When provided, a full
   *   workspace sync is performed after the basic agent rows are created.
   *   Sync failures are non-fatal and only logged.
   */
  async adopt(
    instance: DiscoveredInstance,
    serverId: number,
    agentSync?: AgentSync,
  ): Promise<void> {
    const record = this.registry.createInstance({
      serverId,
      slug: instance.slug,
      displayName: instance.slug,
      port: instance.port,
      configPath: instance.configPath,
      stateDir: instance.stateDir,
      systemdUnit: `claw-runtime-${instance.slug}`,
      ...(instance.telegramBot != null && { telegramBot: instance.telegramBot }),
      ...(instance.defaultModel != null && { defaultModel: instance.defaultModel }),
      discovered: true,
    });

    for (const agent of instance.agents) {
      this.registry.createAgent(record.id, {
        agentId: agent.id,
        name: agent.name,
        ...(agent.model != null && { model: agent.model }),
        workspacePath: agent.workspacePath,
        isDefault: agent.isDefault,
      });
    }

    this.registry.allocatePort(serverId, instance.port, instance.slug);

    const state: InstanceRecord["state"] = instance.runtimeRunning ? "running" : "stopped";
    this.registry.updateInstanceState(instance.slug, state);

    this.registry.logEvent(
      instance.slug,
      "discovered",
      `Adopted from existing infra (source: ${instance.source}, ${instance.agents.length} agents, port ${instance.port})`,
    );

    // Optional deep sync of workspace files and agent links
    if (agentSync) {
      try {
        await agentSync.sync(record);
      } catch (err) {
        logger.dim(`[discovery] Agent sync failed for ${instance.slug} (non-fatal): ${err}`);
      }
    }
  }
}

// resolveAgentWorkspacePath is defined in agent-workspace.ts (re-exported for
// backward compatibility with any external callers that import from discovery.ts)
export { resolveAgentWorkspacePath } from "./agent-workspace.js";
