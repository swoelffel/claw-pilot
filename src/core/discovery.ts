// src/core/discovery.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";
import type { AgentSync } from "./agent-sync.js";
import { constants } from "../lib/constants.js";
import { logger } from "../lib/logger.js";
import {
  getServiceManager,
  getLaunchdDir,
  getLaunchdLabel,
  getLaunchdPlistPath,
} from "../lib/platform.js";
import { normaliseModel } from "../lib/model-helpers.js";
import { OpenClawConfigSchema } from "./openclaw-config.schema.js";
import { resolveAgentWorkspacePath } from "./agent-workspace.js";

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
   *
   * Strategy (Linux):
   *   1. `sudo find` for all openclaw.json files — works across user boundaries
   *   2. Enrich each found instance with live systemd state (sudo -u openclaw)
   *   3. Port scan as last-resort fallback for instances not found by find
   *
   * Strategy (macOS):
   *   1. Directory scan under openclawHome
   *   2. launchd agent scan
   *   3. Port scan fallback
   */
  async scan(): Promise<DiscoveryResult> {
    const found = new Map<string, DiscoveredInstance>();

    if (getServiceManager() === "systemd") {
      // Linux: find-based discovery (crosses user boundaries via sudo)
      await this.scanByFind(found);
      await this.enrichWithSystemdState(found);
    } else {
      // macOS: directory scan + launchd
      await this.scanDirectories(found);
      await this.scanLaunchdAgents(found);
    }

    // Port scan: catch anything missed by the above strategies
    await this.scanPorts(found);

    return this.reconcile(found);
  }

  // --- Strategy 1 (Linux): find-based scan across all users ---

  /**
   * Use `sudo find` to locate all openclaw.json files on the system.
   * This works regardless of file ownership (e.g. openclaw user on /opt/openclaw).
   *
   * Valid stateDir paths must match one of:
   *   <home>/.openclaw-<slug>/openclaw.json   (multi-instance)
   *   <home>/.openclaw/openclaw.json           (legacy single-instance → slug "default")
   *
   * Excluded patterns (not real instance stateDirs):
   *   - paths containing "-backup-" (backup directories)
   *   - paths where the parent of .openclaw* is not a home dir
   *     (e.g. openclaw-config/vm01/openclaw.json)
   */
  private async scanByFind(found: Map<string, DiscoveredInstance>): Promise<void> {
    const result = await this.conn.exec(
      `sudo find /opt /home /root /var -maxdepth 8 -name "openclaw.json" 2>/dev/null`,
      { timeout: 15_000 },
    );

    const configPaths = result.stdout.trim().split("\n").filter(Boolean);

    // Regex: /<home>/.openclaw(-<slug>)?/openclaw.json
    // The stateDir must be a direct child of some home directory.
    const RE_MULTI = /^(.+)\/(\.openclaw-([a-z0-9][a-z0-9-]*))\/openclaw\.json$/;
    const RE_LEGACY = /^(.+)\/(\.openclaw)\/openclaw\.json$/;

    for (const configPath of configPaths) {
      // Exclude backup directories
      if (configPath.includes("-backup-")) continue;

      let slug: string;
      let stateDir: string;

      const multiMatch = RE_MULTI.exec(configPath);
      if (multiMatch) {
        stateDir = `${multiMatch[1]}/${multiMatch[2]}`;
        slug = multiMatch[3]!;
      } else {
        const legacyMatch = RE_LEGACY.exec(configPath);
        if (!legacyMatch) continue; // not a recognised stateDir layout
        stateDir = `${legacyMatch[1]}/${legacyMatch[2]}`;
        slug = "default";
      }

      if (found.has(slug)) continue;

      const instance = await this.parseInstance(slug, stateDir, configPath, "directory");
      if (instance) found.set(slug, instance);
    }
  }

  /**
   * Enrich already-discovered instances with live systemd state.
   * Runs `sudo -u openclaw systemctl --user is-active openclaw-<slug>.service`
   * so it works even when claw-pilot runs as a different user (e.g. stephane).
   *
   * Instances whose service is neither active nor inactive (i.e. not found in
   * systemd at all) are removed from `found` — they are considered dead/backup.
   */
  private async enrichWithSystemdState(found: Map<string, DiscoveredInstance>): Promise<void> {
    // Resolve the UID of the openclaw user once (needed for XDG_RUNTIME_DIR)
    const uidResult = await this.conn.exec(`id -u openclaw 2>/dev/null || true`);
    const openclawUid = uidResult.stdout.trim();
    const xdgRuntime = openclawUid ? `/run/user/${openclawUid}` : this.xdgRuntimeDir;

    const toRemove: string[] = [];

    for (const [slug, instance] of found) {
      const unitName = `openclaw-${slug}.service`;

      // Try as openclaw user first, fall back to current user's systemd
      const checkResult = await this.conn.exec(
        `sudo -u openclaw XDG_RUNTIME_DIR=${xdgRuntime} systemctl --user is-active ${unitName} 2>/dev/null || ` +
          `XDG_RUNTIME_DIR=${this.xdgRuntimeDir} systemctl --user is-active ${unitName} 2>/dev/null || true`,
      );
      const state = checkResult.stdout.trim();

      if (state === "active") {
        instance.systemdUnit = unitName;
        instance.systemdState = "active";
      } else if (state === "inactive") {
        instance.systemdUnit = unitName;
        instance.systemdState = "inactive";
      } else if (state === "failed") {
        instance.systemdUnit = unitName;
        instance.systemdState = "failed";
      } else {
        // Service not known to systemd at all — treat as dead/backup, exclude
        logger.dim(`[discovery] ${slug}: no systemd unit found — skipping`);
        toRemove.push(slug);
      }
    }

    for (const slug of toRemove) found.delete(slug);
  }

  // --- Strategy 1 (macOS): Directory scan ---

  private async scanDirectories(found: Map<string, DiscoveredInstance>): Promise<void> {
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

      const instance = await this.parseInstance(slug, stateDir, configPath, "directory");
      if (instance) found.set(slug, instance);
    }
  }

  // --- Strategy 2b: launchd agent scan (macOS only) ---

  private async scanLaunchdAgents(found: Map<string, DiscoveredInstance>): Promise<void> {
    if (getServiceManager() !== "launchd") return;

    const launchdDir = getLaunchdDir();
    let entries: string[];
    try {
      entries = await this.conn.readdir(launchdDir);
    } catch {
      // intentionally ignored — launchd dir not accessible, skip launchd scan
      return;
    }

    for (const entry of entries) {
      const match = entry.match(/^ai\.openclaw\.([a-z0-9-]+)\.plist$/);
      if (!match) continue;
      const slug = match[1]!;
      if (found.has(slug)) {
        // Enrich existing entry with launchd info
        const existing = found.get(slug)!;
        existing.systemdUnit = getLaunchdLabel(slug);
        const result = await this.conn.execFile("launchctl", ["list", getLaunchdLabel(slug)]);
        existing.systemdState = result.exitCode === 0 ? "active" : "inactive";
        continue;
      }

      // Read the plist to extract stateDir
      const plistPath = getLaunchdPlistPath(slug);
      let stateDir: string | undefined;
      try {
        const plistContent = await this.conn.readFile(plistPath);
        const match2 = plistContent.match(
          /<key>OPENCLAW_STATE_DIR<\/key>\s*<string>([^<]+)<\/string>/,
        );
        if (match2) stateDir = match2[1];
      } catch {
        // plist unreadable — skip
      }
      if (!stateDir) continue;

      // Check if active
      const listResult = await this.conn.execFile("launchctl", ["list", getLaunchdLabel(slug)]);
      const configPath = `${stateDir}/openclaw.json`;
      if (!(await this.conn.exists(configPath))) continue;

      const instance = await this.parseInstance(slug, stateDir, configPath, "systemd");
      if (instance) {
        instance.systemdUnit = getLaunchdLabel(slug);
        instance.systemdState = listResult.exitCode === 0 ? "active" : "inactive";
        found.set(slug, instance);
      }
    }
  }

  // --- Strategy 3: Port scan ---

  private async scanPorts(found: Map<string, DiscoveredInstance>): Promise<void> {
    const start = parseInt(this.registry.getConfig("port_range_start") ?? "18789");
    const end = parseInt(this.registry.getConfig("port_range_end") ?? "18799");
    const knownPorts = new Set([...found.values()].map((i) => i.port));

    // Scan all ports in parallel — worst case drops from 22s to ~2s
    const portsToScan = Array.from({ length: end - start + 1 }, (_, i) => start + i).filter(
      (p) => !knownPorts.has(p),
    );

    const results = await Promise.allSettled(
      portsToScan.map(async (port) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          if (!res.ok) return null;
          return port;
        } catch {
          // Expected: port not responding
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || result.value === null) continue;
      const port = result.value;

      const slug = await this.findSlugByPort(port);
      if (!slug || found.has(slug)) continue;

      const stateDir = `${this.openclawHome}/${constants.OPENCLAW_STATE_PREFIX}${slug}`;
      const configPath = `${stateDir}/openclaw.json`;
      const instance = await this.parseInstance(slug, stateDir, configPath, "port");
      if (instance) found.set(slug, instance);
    }
  }

  // --- Shared parsing logic ---

  private async parseInstance(
    slug: string,
    stateDir: string,
    configPath: string,
    source: DiscoveredInstance["source"],
    portOverride?: number,
  ): Promise<DiscoveredInstance | null> {
    let configRaw: string;
    try {
      configRaw = await this.conn.readFile(configPath);
    } catch (err) {
      logger.dim(`[discovery] Cannot read config at ${configPath}: ${err}`);
      return null;
    }

    // Parse with Zod schema (safeParse to handle invalid configs gracefully)
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(configRaw);
    } catch (err) {
      logger.dim(`[discovery] Invalid JSON in ${configPath}: ${err}`);
      return null;
    }

    const parsed = OpenClawConfigSchema.safeParse(rawJson);
    if (!parsed.success) {
      logger.dim(`[discovery] Invalid openclaw.json at ${configPath}: ${parsed.error.message}`);
      return null;
    }
    const config = parsed.data;

    const portFromConfig = config.gateway?.port;
    // Accept port from config JSON or from systemd unit env (portOverride)
    const port = typeof portFromConfig === "number" ? portFromConfig : portOverride;
    if (typeof port !== "number") return null;

    // Extract agents
    const agents: DiscoveredAgent[] = [];
    const agentsConf = config.agents;
    const agentsDefaults = agentsConf?.defaults;
    const agentsList = agentsConf?.list ?? [];
    // model can be a string or an object like {"primary": "..."}
    const defaultModel: string | null = normaliseModel(agentsDefaults?.model);

    // Main agent
    agents.push({
      id: "main",
      name: agentsDefaults?.name ?? "Main",
      model: defaultModel,
      workspacePath: resolveAgentWorkspacePath(
        stateDir,
        "main",
        agentsDefaults?.workspace,
        agentsList as Array<Record<string, unknown>>,
      ),
      isDefault: true,
    });

    for (const agent of agentsList) {
      if (!agent.id) continue;
      agents.push({
        id: agent.id,
        name: agent.name ?? agent.id,
        model: normaliseModel(agent.model) ?? defaultModel,
        workspacePath: resolveAgentWorkspacePath(
          stateDir,
          agent.id,
          agent.workspace,
          agentsList as Array<Record<string, unknown>>,
        ),
        isDefault: false,
      });
    }

    // Telegram bot
    let telegramBot: string | null = null;
    const telegram = config.channels?.telegram;
    if (telegram && (telegram as Record<string, unknown>)["botUsername"]) {
      telegramBot = `@${(telegram as Record<string, unknown>)["botUsername"]}`;
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

    // Service status (systemd or launchd)
    let systemdUnit: string | null = null;
    let systemdState: DiscoveredInstance["systemdState"] = null;
    if (getServiceManager() === "systemd") {
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
    } else {
      // launchd
      const label = getLaunchdLabel(slug);
      const result = await this.conn.execFile("launchctl", ["list", label]);
      if (result.exitCode === 0) {
        systemdUnit = label;
        systemdState = "active";
      } else {
        const plistPath = getLaunchdPlistPath(slug);
        if (await this.conn.exists(plistPath)) {
          systemdUnit = label;
          systemdState = "inactive";
        }
      }
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
      systemdUnit: instance.systemdUnit ?? `openclaw-${instance.slug}.service`,
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

    // Optional deep sync of workspace files and agent links
    if (agentSync) {
      try {
        await agentSync.sync(record);
      } catch (err) {
        logger.dim(`[discovery] Agent sync failed for ${instance.slug} (non-fatal): ${err}`);
      }
    }
  }

  // --- Helpers ---

  private async findSlugByPort(port: number): Promise<string | null> {
    let entries: string[];
    try {
      entries = await this.conn.readdir(this.openclawHome);
    } catch {
      // intentionally ignored — openclaw home not accessible, cannot resolve slug by port
      return null;
    }

    const prefix = constants.OPENCLAW_STATE_PREFIX;
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const configPath = `${this.openclawHome}/${entry}/openclaw.json`;
      try {
        const raw = await this.conn.readFile(configPath);
        const parsed = OpenClawConfigSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.gateway?.port === port) {
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

// resolveAgentWorkspacePath is defined in agent-workspace.ts (re-exported for
// backward compatibility with any external callers that import from discovery.ts)
export { resolveAgentWorkspacePath } from "./agent-workspace.js";
