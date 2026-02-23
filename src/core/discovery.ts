// src/core/discovery.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import { constants } from "../lib/constants.js";
import { shellEscape } from "../lib/shell.js";
import { logger } from "../lib/logger.js";

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
  systemdUnit: string | null;
  systemdState: "active" | "inactive" | "failed" | null;
  gatewayHealthy: boolean;
  telegramBot: string | null;
  nginxDomain: string | null;
  defaultModel: string | null;
  source: "directory" | "systemd" | "port" | "legacy";
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
    private openclawHome: string,
    private xdgRuntimeDir: string,
  ) {}

  /**
   * Scan the local system for existing OpenClaw instances.
   * Returns all discovered instances along with their reconciliation status
   * against the current registry.
   */
  async scan(): Promise<DiscoveryResult> {
    const found = new Map<string, DiscoveredInstance>();

    // Strategy 1: Directory scan
    await this.scanDirectories(found);

    // Strategy 2: Systemd scan
    await this.scanSystemdUnits(found);

    // Strategy 3: Port scan
    await this.scanPorts(found);

    // Strategy 4: Legacy directory
    await this.scanLegacy(found);

    return this.reconcile(found);
  }

  // --- Strategy 1: Directory scan ---

  private async scanDirectories(
    found: Map<string, DiscoveredInstance>,
  ): Promise<void> {
    const prefix = constants.OPENCLAW_STATE_PREFIX;
    let entries: string[];

    try {
      entries = await this.conn.readdir(this.openclawHome);
    } catch {
      // Directory not accessible — skip
      return;
    }

    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const slug = entry.slice(prefix.length);
      if (!slug || found.has(slug)) continue;

      const stateDir = `${this.openclawHome}/${entry}`;
      const configPath = `${stateDir}/openclaw.json`;

      if (!(await this.conn.exists(configPath))) continue;

      const instance = await this.parseInstance(
        slug,
        stateDir,
        configPath,
        "directory",
      );
      if (instance) found.set(slug, instance);
    }
  }

  // --- Strategy 2: Systemd unit scan ---

  private async scanSystemdUnits(
    found: Map<string, DiscoveredInstance>,
  ): Promise<void> {
    const result = await this.conn.execFile(
      "systemctl",
      ["--user", "list-units", "openclaw-*", "--no-pager", "--plain", "--no-legend"],
      { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
    );

    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^openclaw-([a-z0-9-]+)\.service/);
      if (!match) continue;
      const slug = match[1]!;
      const systemdState: "active" | "inactive" | "failed" = line.includes(
        "active",
      )
        ? "active"
        : line.includes("failed")
          ? "failed"
          : "inactive";

      if (found.has(slug)) {
        // Enrich with systemd info
        const existing = found.get(slug)!;
        existing.systemdUnit = `openclaw-${slug}.service`;
        existing.systemdState = systemdState;
        continue;
      }

      // Instance found via systemd only — try to find state dir from Environment
      const showResult = await this.conn.execFile(
        "systemctl",
        ["--user", "show", `openclaw-${slug}.service`, "--property=Environment", "--value"],
        { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
      );
      const stateDirMatch = showResult.stdout.match(
        /OPENCLAW_STATE_DIR=(\S+)/,
      );
      if (!stateDirMatch) continue;

      const stateDir = stateDirMatch[1]!;
      const configPath = `${stateDir}/openclaw.json`;
      if (!(await this.conn.exists(configPath))) continue;

      const instance = await this.parseInstance(
        slug,
        stateDir,
        configPath,
        "systemd",
      );
      if (instance) {
        instance.systemdUnit = `openclaw-${slug}.service`;
        instance.systemdState = systemdState;
        found.set(slug, instance);
      }
    }
  }

  // --- Strategy 3: Port scan ---

  private async scanPorts(
    found: Map<string, DiscoveredInstance>,
  ): Promise<void> {
    const start = parseInt(
      this.registry.getConfig("port_range_start") ?? "18789",
    );
    const end = parseInt(
      this.registry.getConfig("port_range_end") ?? "18799",
    );
    const knownPorts = new Set([...found.values()].map((i) => i.port));

    for (let port = start; port <= end; port++) {
      if (knownPorts.has(port)) continue;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) continue;

        const slug = await this.findSlugByPort(port);
        if (!slug || found.has(slug)) continue;

        const stateDir = `${this.openclawHome}/${constants.OPENCLAW_STATE_PREFIX}${slug}`;
        const configPath = `${stateDir}/openclaw.json`;
        const instance = await this.parseInstance(
          slug,
          stateDir,
          configPath,
          "port",
        );
        if (instance) found.set(slug, instance);
      } catch {
        // Expected: port not responding
      }
    }
  }

  // --- Strategy 4: Legacy single-instance directory ---

  private async scanLegacy(
    found: Map<string, DiscoveredInstance>,
  ): Promise<void> {
    const legacyDir = `${this.openclawHome}/${constants.OPENCLAW_LEGACY_DIR}`;
    const legacyConfig = `${legacyDir}/openclaw.json`;

    if (!(await this.conn.exists(legacyConfig))) return;

    const slug = "default";
    if (found.has(slug)) return;

    const instance = await this.parseInstance(
      slug,
      legacyDir,
      legacyConfig,
      "legacy",
    );
    if (instance) found.set(slug, instance);
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

    const gateway = config["gateway"] as Record<string, unknown> | undefined;
    const port = gateway?.["port"];
    if (typeof port !== "number") return null;

    // Extract agents
    const agents: DiscoveredAgent[] = [];
    const agentsConf = config["agents"] as Record<string, unknown> | undefined;
    const agentsDefaults = agentsConf?.["defaults"] as
      | Record<string, unknown>
      | undefined;
    const agentsList = (agentsConf?.["list"] ?? []) as Array<
      Record<string, unknown>
    >;
    // model can be a string or an object like {"primary": "..."}
    const rawModel = agentsDefaults?.["model"];
    const defaultModel: string | null =
      typeof rawModel === "string"
        ? rawModel
        : rawModel !== null && typeof rawModel === "object"
          ? JSON.stringify(rawModel)
          : null;

    // Main agent
    agents.push({
      id: "main",
      name: (agentsDefaults?.["name"] as string | undefined) ?? "Main",
      model: defaultModel,
      workspacePath: `${stateDir}/workspaces/main`,
      isDefault: true,
    });

    for (const agent of agentsList) {
      if (!agent["id"]) continue;
      agents.push({
        id: agent["id"] as string,
        name: (agent["name"] as string | undefined) ?? (agent["id"] as string),
        model: (() => {
          const m = agent["model"];
          return typeof m === "string" ? m : m !== null && typeof m === "object" ? JSON.stringify(m) : defaultModel;
        })(),
        workspacePath: `${stateDir}/workspaces/${(agent["workspace"] as string | undefined) ?? agent["id"]}`,
        isDefault: false,
      });
    }

    // Telegram bot
    let telegramBot: string | null = null;
    const channels = config["channels"] as Record<string, unknown> | undefined;
    const telegram = channels?.["telegram"] as
      | Record<string, unknown>
      | undefined;
    if (telegram?.["botUsername"]) {
      telegramBot = `@${telegram["botUsername"]}`;
    }

    // Gateway health
    let gatewayHealthy = false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(constants.HEALTH_CHECK_TIMEOUT),
      });
      gatewayHealthy = res.ok;
    } catch {
      // Expected: gateway not responding
    }

    // Systemd status
    let systemdUnit: string | null = null;
    let systemdState: DiscoveredInstance["systemdState"] = null;
    const unitName = `openclaw-${slug}.service`;
    const systemdResult = await this.conn.execFile(
      "systemctl",
      ["--user", "is-active", unitName],
      { env: { XDG_RUNTIME_DIR: this.xdgRuntimeDir } },
    );
    const sysState = systemdResult.stdout.trim();
    if (["active", "inactive", "failed"].includes(sysState)) {
      systemdUnit = unitName;
      systemdState = sysState as "active" | "inactive" | "failed";
    }

    // Nginx vhost
    let nginxDomain: string | null = null;
    const nginxResult = await this.conn.exec(
      `ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -i ${shellEscape(slug)} || true`,
    );
    const nginxFile = nginxResult.stdout.trim();
    if (nginxFile) {
      nginxDomain = nginxFile;
    }

    return {
      slug,
      stateDir,
      configPath,
      port,
      agents,
      systemdUnit,
      systemdState,
      gatewayHealthy,
      telegramBot,
      nginxDomain,
      defaultModel,
      source,
    };
  }

  // --- Reconciliation ---

  private reconcile(
    found: Map<string, DiscoveredInstance>,
  ): DiscoveryResult {
    const registered = new Map(
      this.registry.listInstances().map((i) => [i.slug, i]),
    );

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
   */
  async adopt(instance: DiscoveredInstance, serverId: number): Promise<void> {
    const record = this.registry.createInstance({
      serverId,
      slug: instance.slug,
      displayName: instance.slug,
      port: instance.port,
      configPath: instance.configPath,
      stateDir: instance.stateDir,
      systemdUnit:
        instance.systemdUnit ?? `openclaw-${instance.slug}.service`,
      telegramBot: instance.telegramBot ?? undefined,
      nginxDomain: instance.nginxDomain ?? undefined,
      defaultModel: instance.defaultModel ?? undefined,
      discovered: true,
    });

    for (const agent of instance.agents) {
      this.registry.createAgent(record.id, {
        agentId: agent.id,
        name: agent.name,
        model: agent.model ?? undefined,
        workspacePath: agent.workspacePath,
        isDefault: agent.isDefault,
      });
    }

    this.registry.allocatePort(serverId, instance.port, instance.slug);

    const state: InstanceRecord["state"] = instance.gatewayHealthy
      ? "running"
      : instance.systemdState === "active"
        ? "running"
        : instance.systemdState === "inactive"
          ? "stopped"
          : "unknown";
    this.registry.updateInstanceState(instance.slug, state);

    this.registry.logEvent(
      instance.slug,
      "discovered",
      `Adopted from existing infra (source: ${instance.source}, ${instance.agents.length} agents, port ${instance.port})`,
    );
  }

  // --- Helpers ---

  private async findSlugByPort(port: number): Promise<string | null> {
    let entries: string[];
    try {
      entries = await this.conn.readdir(this.openclawHome);
    } catch {
      return null;
    }

    const prefix = constants.OPENCLAW_STATE_PREFIX;
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const configPath = `${this.openclawHome}/${entry}/openclaw.json`;
      try {
        const raw = await this.conn.readFile(configPath);
        const conf = JSON.parse(raw) as Record<string, unknown>;
        const gw = conf["gateway"] as Record<string, unknown> | undefined;
        if (gw?.["port"] === port) {
          return entry.slice(prefix.length);
        }
      } catch {
        // Config unreadable or invalid JSON — skip this entry
        continue;
      }
    }
    return null;
  }
}


