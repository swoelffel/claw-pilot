# Claw Pilot -- MVP Technical Specifications (V1)

**Version**: 1.1
**Date**: 2026-02-22
**Source**: CDC-claw-pilot.md v1.2 + SPEC-multi-instances.md v1.5
**Repo**: https://github.com/swoelffel/claw-pilot
**License**: MIT

---

## 0. Purpose

This document translates the CDC (cahier des charges / product brief) into implementable
technical specifications. It describes every module, interface, and file to create for the MVP.
This is the authoritative reference for development.

**MVP scope**: single-server, full CLI + web dashboard, instance discovery & adoption,
creation wizard, automated provisioning, lifecycle management, clean destruction, doctor.

---

## 1. Project structure

```
claw-pilot/
  docs/
    SPEC-MVP.md              # This document
  src/
    index.ts                 # CLI entry point (Commander.js)
    commands/                # CLI commands
      init.ts
      create.ts
      destroy.ts
      list.ts
      start.ts
      stop.ts
      restart.ts
      status.ts
      logs.ts
      dashboard.ts
      doctor.ts
    core/                    # Business logic
      registry.ts            # SQLite CRUD (instances, ports, agents, servers)
      discovery.ts           # Scan & adopt existing OpenClaw instances
      provisioner.ts         # Full instance creation
      destroyer.ts           # Full instance removal
      lifecycle.ts           # Start/stop/restart via systemd
      health.ts              # Health checks (gateway HTTP, systemd status)
      pairing.ts             # Device pairing bootstrap + Telegram pairing
      config-generator.ts    # Generate openclaw.json from wizard answers
      systemd-generator.ts   # Generate .service file
      secrets.ts             # Crypto-random token generation
      port-allocator.ts      # Registry-based port allocation
      openclaw-cli.ts        # Wrapper around the openclaw CLI (plugins, devices, pairing)
    server/                  # Server abstraction layer
      connection.ts          # ServerConnection interface
      local.ts               # LocalConnection (V1)
    wizard/                  # Interactive creation wizard
      wizard.ts              # Wizard orchestrator (steps 1-10)
      prompts.ts             # Interactive prompts (@inquirer/prompts)
      templates.ts           # Workspace bootstrap templates (AGENTS.md, SOUL.md, etc.)
    dashboard/               # Web dashboard
      server.ts              # HTTP server (Hono) + WS
      monitor.ts             # Health polling + WS push to clients
      auth.ts                # Token-based auth
      api/                   # REST API routes
        instances.ts         # GET/POST/DELETE /api/instances
        health.ts            # GET /api/health
      ui/                    # Lit web components (Vite build)
        index.html
        app.ts               # Router + shell
        components/
          cluster-view.ts    # Cluster overview (cards)
          instance-card.ts   # Instance card (status, actions)
          instance-detail.ts # Instance detail (agents, logs, actions)
          log-viewer.ts      # Real-time logs (WS)
          create-dialog.ts   # Creation wizard (web version)
    db/                      # Database
      schema.ts              # SQLite schema + initialization
      migrations.ts          # Versioned migrations
    lib/                     # Utilities
      logger.ts              # Structured logger (console, ANSI colors)
      errors.ts              # Custom error classes
      constants.ts           # Constants (ports, paths, timeouts)
      platform.ts            # OS detection, paths
  templates/                 # Template files (copied during provisioning)
    systemd.service.hbs      # Handlebars template for systemd service
    workspace/               # Workspace bootstrap files
      AGENTS.md.hbs
      SOUL.md.hbs
      TOOLS.md.hbs
      USER.md.hbs
      MEMORY.md
  ui/                        # Dashboard source (Vite build)
    vite.config.ts
    tsconfig.json
  install.sh                 # Shell installer
  package.json
  tsconfig.json
  tsdown.config.ts           # Build config (tsdown/rolldown)
  vitest.config.ts
  oxlint.json
  .gitignore
  LICENSE
  README.md
```

---

## 2. Tech stack and dependencies

### 2.1 Runtime and build

| Tool | Version | Role |
|------|---------|------|
| Node.js | >= 22.12.0 | Runtime |
| TypeScript | ~5.7 | Strict typing |
| pnpm | >= 9 | Package manager |
| tsdown | latest | CLI build (rolldown) |
| Vite | ^6 | Dashboard UI build |

### 2.2 Runtime dependencies

| Package | Version | Role |
|---------|---------|------|
| `commander` | ^13 | CLI framework |
| `@inquirer/prompts` | ^7 | Interactive wizard prompts |
| `better-sqlite3` | ^11 | Embedded SQLite |
| `hono` | ^4 | Dashboard HTTP server (lightweight, Node-compatible) |
| `ws` | ^8 | WebSocket server (dashboard push) |
| `handlebars` | ^4 | Templates (systemd, workspace files) |
| `chalk` | ^5 | ANSI terminal colors |
| `ora` | ^8 | Terminal spinners |
| `cli-table3` | ^0.6 | Terminal tables |
| `nanoid` | ^5 | Short ID generation |

### 2.3 Dev dependencies

| Package | Version | Role |
|---------|---------|------|
| `vitest` | ^3 | Tests |
| `oxlint` | latest | Linting |
| `@types/better-sqlite3` | latest | SQLite types |
| `@types/ws` | latest | WS types |
| `lit` | ^3 | Dashboard web components |
| `typescript` | ~5.7 | Compiler |
| `tsdown` | latest | Bundler |

### 2.4 package.json (skeleton)

```json
{
  "name": "claw-pilot",
  "version": "1.0.0",
  "description": "Orchestrator for OpenClaw multi-instance clusters",
  "type": "module",
  "license": "MIT",
  "bin": {
    "claw-pilot": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsdown --watch",
    "build": "tsdown && pnpm build:ui",
    "build:ui": "vite build ui/",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "oxlint src/",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22.12.0"
  },
  "files": ["dist/", "templates/", "install.sh"]
}
```

---

## 3. Server abstraction layer (`src/server/`)

### 3.1 `ServerConnection` interface

All server operations go through this interface.
In V1, only `LocalConnection` is implemented. In V2, `SSHConnection` will be added.

```typescript
// src/server/connection.ts

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // ms, default 30_000
}

export interface ServerConnection {
  /** Execute a shell command */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /** Read file contents as UTF-8 */
  readFile(path: string): Promise<string>;

  /** Write file contents (creates parent dirs if needed) */
  writeFile(path: string, content: string, mode?: number): Promise<void>;

  /** Create directory (recursive) */
  mkdir(path: string, options?: { mode?: number }): Promise<void>;

  /** Check if path exists */
  exists(path: string): Promise<boolean>;

  /** Remove file or directory */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Set permissions (chmod) */
  chmod(path: string, mode: number): Promise<void>;

  /** List directory contents */
  readdir(path: string): Promise<string[]>;

  /** Copy file */
  copyFile(src: string, dest: string): Promise<void>;

  /** Server info */
  hostname(): Promise<string>;
  platform(): Promise<string>;
}
```

### 3.2 `LocalConnection` (V1)

```typescript
// src/server/local.ts
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import type { ServerConnection, ExecResult, ExecOptions } from "./connection.js";

const execAsync = promisify(execCb);

export class LocalConnection implements ServerConnection {
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        timeout: options?.timeout ?? 30_000,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exitCode: error.code ?? 1,
      };
    }
  }

  async readFile(path: string): Promise<string> {
    return fs.readFile(path, "utf-8");
  }

  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf("/"));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, content, { mode: mode ?? 0o644 });
  }

  async mkdir(path: string, options?: { mode?: number }): Promise<void> {
    await fs.mkdir(path, { recursive: true, mode: options?.mode });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(path, { recursive: options?.recursive ?? false, force: true });
  }

  async chmod(path: string, mode: number): Promise<void> {
    await fs.chmod(path, mode);
  }

  async readdir(path: string): Promise<string[]> {
    return fs.readdir(path);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(src, dest);
  }

  async hostname(): Promise<string> {
    return os.hostname();
  }

  async platform(): Promise<string> {
    return os.platform();
  }
}
```

---

## 4. Database (`src/db/`)

### 4.1 SQLite schema

```typescript
// src/db/schema.ts
import Database from "better-sqlite3";
import { constants } from "../lib/constants.js";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- Physical server (V1: always a single "local" record)
CREATE TABLE IF NOT EXISTS servers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname        TEXT NOT NULL,
  ip              TEXT,
  ssh_user        TEXT,
  ssh_port        INTEGER DEFAULT 22,
  openclaw_home   TEXT NOT NULL,
  openclaw_bin    TEXT,
  openclaw_version TEXT,
  os              TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- OpenClaw instance
CREATE TABLE IF NOT EXISTS instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id       INTEGER NOT NULL REFERENCES servers(id),
  slug            TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  port            INTEGER NOT NULL UNIQUE,
  state           TEXT DEFAULT 'unknown' CHECK(state IN ('running','stopped','error','unknown')),
  config_path     TEXT NOT NULL,
  state_dir       TEXT NOT NULL,
  systemd_unit    TEXT NOT NULL,
  telegram_bot    TEXT,
  default_model   TEXT,
  discovered      INTEGER DEFAULT 0,  -- 1 if adopted from existing infra, 0 if created by claw-pilot
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Instance agents
CREATE TABLE IF NOT EXISTS agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  model           TEXT,
  workspace_path  TEXT NOT NULL,
  is_default      INTEGER DEFAULT 0,
  UNIQUE(instance_id, agent_id)
);

-- Allocated port registry
CREATE TABLE IF NOT EXISTS ports (
  server_id       INTEGER NOT NULL REFERENCES servers(id),
  port            INTEGER NOT NULL,
  instance_slug   TEXT,
  PRIMARY KEY (server_id, port)
);

-- Global key-value configuration
CREATE TABLE IF NOT EXISTS config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);

-- Event/history log (audit trail)
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_slug   TEXT,
  event_type      TEXT NOT NULL,
  detail          TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
`;

const DEFAULT_CONFIG: Record<string, string> = {
  port_range_start: "18789",
  port_range_end: "18799",
  dashboard_port: "19000",
  health_check_interval_ms: "10000",
  openclaw_user: "openclaw",
};

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if schema exists
  const hasSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!hasSchema) {
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);

    // Insert default config
    const insert = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      insert.run(key, value);
    }
  }

  return db;
}
```

### 4.2 Registry (`src/core/registry.ts`)

```typescript
// src/core/registry.ts
import type Database from "better-sqlite3";

export interface ServerRecord {
  id: number;
  hostname: string;
  ip: string | null;
  openclaw_home: string;
  openclaw_bin: string | null;
  openclaw_version: string | null;
}

export interface InstanceRecord {
  id: number;
  server_id: number;
  slug: string;
  display_name: string | null;
  port: number;
  state: "running" | "stopped" | "error" | "unknown";
  config_path: string;
  state_dir: string;
  systemd_unit: string;
  telegram_bot: string | null;
  default_model: string | null;
  discovered: number;
  created_at: string;
  updated_at: string;
}

export interface AgentRecord {
  id: number;
  instance_id: number;
  agent_id: string;
  name: string;
  model: string | null;
  workspace_path: string;
  is_default: number;
}

export class Registry {
  constructor(private db: Database.Database) {}

  // --- Servers ---

  getLocalServer(): ServerRecord | undefined {
    return this.db.prepare("SELECT * FROM servers WHERE id = 1").get() as ServerRecord | undefined;
  }

  upsertLocalServer(hostname: string, openclawHome: string, ip?: string): ServerRecord {
    const existing = this.getLocalServer();
    if (existing) {
      this.db
        .prepare(
          `UPDATE servers SET hostname=?, openclaw_home=?, ip=?, updated_at=datetime('now') WHERE id=1`
        )
        .run(hostname, openclawHome, ip ?? null);
    } else {
      this.db
        .prepare("INSERT INTO servers (hostname, openclaw_home, ip) VALUES (?, ?, ?)")
        .run(hostname, openclawHome, ip ?? null);
    }
    return this.getLocalServer()!;
  }

  // --- Instances ---

  listInstances(): InstanceRecord[] {
    return this.db.prepare("SELECT * FROM instances ORDER BY port ASC").all() as InstanceRecord[];
  }

  getInstance(slug: string): InstanceRecord | undefined {
    return this.db.prepare("SELECT * FROM instances WHERE slug = ?").get(slug) as
      | InstanceRecord
      | undefined;
  }

  createInstance(data: {
    serverId: number;
    slug: string;
    displayName?: string;
    port: number;
    configPath: string;
    stateDir: string;
    systemdUnit: string;
    telegramBot?: string;
    defaultModel?: string;
    discovered?: boolean;
  }): InstanceRecord {
    this.db
      .prepare(
        `INSERT INTO instances (server_id, slug, display_name, port, config_path, state_dir,
         systemd_unit, telegram_bot, default_model, discovered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.serverId,
        data.slug,
        data.displayName ?? null,
        data.port,
        data.configPath,
        data.stateDir,
        data.systemdUnit,
        data.telegramBot ?? null,
        data.defaultModel ?? null,
        data.discovered ? 1 : 0
      );
    return this.getInstance(data.slug)!;
  }

  updateInstanceState(slug: string, state: InstanceRecord["state"]): void {
    this.db
      .prepare(`UPDATE instances SET state=?, updated_at=datetime('now') WHERE slug=?`)
      .run(state, slug);
  }

  deleteInstance(slug: string): void {
    this.db.prepare("DELETE FROM instances WHERE slug = ?").run(slug);
  }

  // --- Agents ---

  listAgents(instanceSlug: string): AgentRecord[] {
    return this.db
      .prepare(
        `SELECT a.* FROM agents a
         JOIN instances i ON a.instance_id = i.id
         WHERE i.slug = ?
         ORDER BY a.is_default DESC, a.agent_id ASC`
      )
      .all(instanceSlug) as AgentRecord[];
  }

  createAgent(instanceId: number, data: {
    agentId: string;
    name: string;
    model?: string;
    workspacePath: string;
    isDefault?: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO agents (instance_id, agent_id, name, model, workspace_path, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        instanceId,
        data.agentId,
        data.name,
        data.model ?? null,
        data.workspacePath,
        data.isDefault ? 1 : 0
      );
  }

  deleteAgents(instanceId: number): void {
    this.db.prepare("DELETE FROM agents WHERE instance_id = ?").run(instanceId);
  }

  // --- Ports ---

  allocatePort(serverId: number, port: number, instanceSlug: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO ports (server_id, port, instance_slug) VALUES (?, ?, ?)")
      .run(serverId, port, instanceSlug);
  }

  releasePort(serverId: number, port: number): void {
    this.db.prepare("DELETE FROM ports WHERE server_id = ? AND port = ?").run(serverId, port);
  }

  getUsedPorts(serverId: number): number[] {
    const rows = this.db
      .prepare("SELECT port FROM ports WHERE server_id = ? ORDER BY port")
      .all(serverId) as { port: number }[];
    return rows.map((r) => r.port);
  }

  // --- Config ---

  getConfig(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
  }

  // --- Events ---

  logEvent(instanceSlug: string | null, eventType: string, detail?: string): void {
    this.db
      .prepare("INSERT INTO events (instance_slug, event_type, detail) VALUES (?, ?, ?)")
      .run(instanceSlug, eventType, detail ?? null);
  }
}
```

---

## 5. Constants and utilities (`src/lib/`)

### 5.1 Constants

```typescript
// src/lib/constants.ts

export const constants = {
  // Claw Pilot data directory
  DATA_DIR: ".claw-pilot",
  DB_FILE: "registry.db",
  CONFIG_FILE: "config.json",
  DASHBOARD_TOKEN_FILE: "dashboard-token",

  // OpenClaw defaults
  OPENCLAW_HOME: "/opt/openclaw",
  OPENCLAW_STATE_PREFIX: ".openclaw-",    // ~/.openclaw-<slug>/
  OPENCLAW_LEGACY_DIR: ".openclaw",       // legacy single-instance directory
  OPENCLAW_USER: "openclaw",
  OPENCLAW_UID: 996,

  // Ports
  PORT_RANGE_START: 18789,
  PORT_RANGE_END: 18799,
  DASHBOARD_PORT: 19000,

  // Timeouts (ms)
  HEALTH_CHECK_TIMEOUT: 5_000,
  SYSTEMD_START_TIMEOUT: 15_000,
  GATEWAY_READY_TIMEOUT: 30_000,
  PAIRING_DETECT_TIMEOUT: 60_000,

  // Health check polling
  HEALTH_POLL_INTERVAL: 10_000,

  // File permissions
  DIR_MODE: 0o700,
  ENV_FILE_MODE: 0o600,
  CONFIG_FILE_MODE: 0o644,

  // Systemd
  XDG_RUNTIME_DIR: "/run/user/996",

  // Templates
  WORKSPACE_FILES: ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md", "MEMORY.md"],
} as const;
```

### 5.2 Platform detection

```typescript
// src/lib/platform.ts
import * as os from "node:os";
import * as path from "node:path";
import { constants } from "./constants.js";

export function getDataDir(): string {
  return path.join(os.homedir(), constants.DATA_DIR);
}

export function getDbPath(): string {
  return path.join(getDataDir(), constants.DB_FILE);
}

export function getDashboardTokenPath(): string {
  return path.join(getDataDir(), constants.DASHBOARD_TOKEN_FILE);
}

export function isLinux(): boolean {
  return os.platform() === "linux";
}

export function isDarwin(): boolean {
  return os.platform() === "darwin";
}

export function getOpenClawHome(): string {
  // Production (Linux): /opt/openclaw
  // Dev (macOS): ~/
  return isLinux() ? constants.OPENCLAW_HOME : os.homedir();
}

export function getStateDir(slug: string): string {
  return path.join(getOpenClawHome(), `${constants.OPENCLAW_STATE_PREFIX}${slug}`);
}

export function getConfigPath(slug: string): string {
  return path.join(getStateDir(slug), "openclaw.json");
}

export function getSystemdDir(): string {
  return path.join(getOpenClawHome(), ".config/systemd/user");
}

export function getSystemdUnit(slug: string): string {
  return `openclaw-${slug}.service`;
}
```

### 5.3 Custom errors

```typescript
// src/lib/errors.ts

export class ClawPilotError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ClawPilotError";
  }
}

export class InstanceNotFoundError extends ClawPilotError {
  constructor(slug: string) {
    super(`Instance "${slug}" not found in registry`, "INSTANCE_NOT_FOUND");
  }
}

export class InstanceAlreadyExistsError extends ClawPilotError {
  constructor(slug: string) {
    super(`Instance "${slug}" already exists`, "INSTANCE_EXISTS");
  }
}

export class PortConflictError extends ClawPilotError {
  constructor(port: number) {
    super(`Port ${port} is already in use`, "PORT_CONFLICT");
  }
}

export class OpenClawNotFoundError extends ClawPilotError {
  constructor() {
    super(
      "OpenClaw CLI not found. Install it first: https://docs.openclaw.ai",
      "OPENCLAW_NOT_FOUND"
    );
  }
}

export class GatewayUnhealthyError extends ClawPilotError {
  constructor(slug: string, port: number) {
    super(
      `Gateway for "${slug}" not responding on port ${port}`,
      "GATEWAY_UNHEALTHY"
    );
  }
}
```

---

## 6. Secrets and tokens (`src/core/secrets.ts`)

```typescript
// src/core/secrets.ts
import { randomBytes } from "node:crypto";

/** Generate a 48-char hex gateway auth token */
export function generateGatewayToken(): string {
  return randomBytes(24).toString("hex");
}

/** Generate a dashboard access token */
export function generateDashboardToken(): string {
  return randomBytes(32).toString("hex");
}

/** Mask a secret for display: show first 8 chars + *** */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "***";
  return secret.slice(0, 8) + "***";
}
```

---

## 7. Port allocator (`src/core/port-allocator.ts`)

```typescript
// src/core/port-allocator.ts
import type { Registry } from "./registry.js";
import type { ServerConnection } from "../server/connection.js";
import { PortConflictError } from "../lib/errors.js";

export class PortAllocator {
  constructor(
    private registry: Registry,
    private conn: ServerConnection
  ) {}

  /** Find the first free port in the configured range */
  async findFreePort(serverId: number): Promise<number> {
    const start = parseInt(this.registry.getConfig("port_range_start") ?? "18789");
    const end = parseInt(this.registry.getConfig("port_range_end") ?? "18799");
    const usedPorts = new Set(this.registry.getUsedPorts(serverId));

    for (let port = start; port <= end; port++) {
      if (!usedPorts.has(port)) {
        // Double-check: is the port actually free on the system?
        const isFree = await this.isPortFree(port);
        if (isFree) return port;
      }
    }

    throw new PortConflictError(-1);
  }

  /** Check if a specific port is free */
  async isPortFree(port: number): Promise<boolean> {
    const result = await this.conn.exec(`ss -tlnp | grep :${port} || true`);
    return result.stdout.trim() === "";
  }

  /** Verify a specific port is available (not in registry AND free on system) */
  async verifyPort(serverId: number, port: number): Promise<boolean> {
    const usedPorts = new Set(this.registry.getUsedPorts(serverId));
    if (usedPorts.has(port)) return false;
    return this.isPortFree(port);
  }
}
```

---

## 8. Instance discovery (`src/core/discovery.ts`)

The discovery module scans the local system for existing OpenClaw instances and adopts them
into the Claw Pilot registry. This is a **first-class feature**: most early adopters will
already have manually-deployed instances in production.

### 8.1 Design principles

- **Read-only**: discovery never modifies existing files, configs, or services
- **Non-destructive**: secrets (`.env`) are detected but never copied or stored in the registry
- **Idempotent**: running `init` again detects additions and removals since the last scan
- **Multi-heuristic**: uses 4 complementary strategies to find instances

### 8.2 Interface

```typescript
// src/core/discovery.ts

export interface DiscoveredInstance {
  slug: string;
  stateDir: string;
  configPath: string;
  port: number;
  agents: DiscoveredAgent[];
  systemdUnit: string | null;       // null if no systemd service found
  systemdState: "active" | "inactive" | "failed" | null;
  gatewayHealthy: boolean;
  telegramBot: string | null;       // @username if configured
  defaultModel: string | null;
  source: "directory" | "systemd" | "port" | "legacy";  // which heuristic found it
}

export interface DiscoveredAgent {
  id: string;
  name: string;
  model: string | null;
  workspacePath: string;
  isDefault: boolean;
}

export interface DiscoveryResult {
  instances: DiscoveredInstance[];
  newInstances: DiscoveredInstance[];       // not yet in registry
  removedSlugs: string[];                   // in registry but no longer on disk
  unchangedSlugs: string[];                 // in registry and still on disk
}
```

### 8.3 Discovery heuristics

The scanner runs 4 strategies in order, deduplicating by slug:

```typescript
export class InstanceDiscovery {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
    private openclawHome: string
  ) {}

  /**
   * Scan the local system for existing OpenClaw instances.
   * Returns all discovered instances along with their reconciliation status
   * against the current registry.
   */
  async scan(): Promise<DiscoveryResult> {
    const found = new Map<string, DiscoveredInstance>();

    // Strategy 1: Directory scan
    // Look for <openclawHome>/.openclaw-*/openclaw.json
    await this.scanDirectories(found);

    // Strategy 2: Systemd scan
    // List units matching 'openclaw-*' pattern, extract slug from unit name
    await this.scanSystemdUnits(found);

    // Strategy 3: Port scan
    // Check ports in range 18789-18799 for listening gateways
    // If a gateway responds, try to extract config from /health endpoint
    await this.scanPorts(found);

    // Strategy 4: Legacy directory
    // Check <openclawHome>/.openclaw/openclaw.json (old single-instance convention)
    await this.scanLegacy(found);

    // Reconcile against registry
    return this.reconcile(found);
  }

  // --- Strategy 1: Directory scan ---

  private async scanDirectories(found: Map<string, DiscoveredInstance>): Promise<void> {
    const prefix = constants.OPENCLAW_STATE_PREFIX;
    let entries: string[];

    try {
      entries = await this.conn.readdir(this.openclawHome);
    } catch {
      return; // Home directory doesn't exist or not readable
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

  // --- Strategy 2: Systemd unit scan ---

  private async scanSystemdUnits(found: Map<string, DiscoveredInstance>): Promise<void> {
    const result = await this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user list-units 'openclaw-*' --no-pager --plain --no-legend 2>/dev/null || true`
    );

    for (const line of result.stdout.split("\n")) {
      // Expected format: "openclaw-demo1.service loaded active running ..."
      const match = line.match(/^openclaw-([a-z0-9-]+)\.service/);
      if (!match) continue;
      const slug = match[1];
      if (found.has(slug)) {
        // Already found by directory scan, just enrich with systemd info
        const existing = found.get(slug)!;
        existing.systemdUnit = `openclaw-${slug}.service`;
        existing.systemdState = line.includes("active") ? "active"
          : line.includes("failed") ? "failed" : "inactive";
        continue;
      }

      // Instance found via systemd but not via directory — try to find its config
      // Read ExecStart from the service to find the state dir
      const showResult = await this.conn.exec(
        `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user show openclaw-${slug}.service --property=Environment --value 2>/dev/null || true`
      );
      const stateDirMatch = showResult.stdout.match(/OPENCLAW_STATE_DIR=(\S+)/);
      if (!stateDirMatch) continue;

      const stateDir = stateDirMatch[1];
      const configPath = `${stateDir}/openclaw.json`;
      if (!(await this.conn.exists(configPath))) continue;

      const instance = await this.parseInstance(slug, stateDir, configPath, "systemd");
      if (instance) {
        instance.systemdUnit = `openclaw-${slug}.service`;
        instance.systemdState = line.includes("active") ? "active"
          : line.includes("failed") ? "failed" : "inactive";
        found.set(slug, instance);
      }
    }
  }

  // --- Strategy 3: Port scan ---

  private async scanPorts(found: Map<string, DiscoveredInstance>): Promise<void> {
    const start = parseInt(this.registry.getConfig("port_range_start") ?? "18789");
    const end = parseInt(this.registry.getConfig("port_range_end") ?? "18799");
    const knownPorts = new Set([...found.values()].map((i) => i.port));

    for (let port = start; port <= end; port++) {
      if (knownPorts.has(port)) continue;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) continue;

        // A gateway is listening — but we don't know the slug
        // Try to find which directory has this port configured
        const slug = await this.findSlugByPort(port);
        if (!slug || found.has(slug)) continue;

        const stateDir = `${this.openclawHome}/${constants.OPENCLAW_STATE_PREFIX}${slug}`;
        const configPath = `${stateDir}/openclaw.json`;
        const instance = await this.parseInstance(slug, stateDir, configPath, "port");
        if (instance) found.set(slug, instance);
      } catch {
        // Port not responding, skip
      }
    }
  }

  // --- Strategy 4: Legacy single-instance directory ---

  private async scanLegacy(found: Map<string, DiscoveredInstance>): Promise<void> {
    const legacyDir = `${this.openclawHome}/${constants.OPENCLAW_LEGACY_DIR}`;
    const legacyConfig = `${legacyDir}/openclaw.json`;

    if (!(await this.conn.exists(legacyConfig))) return;

    // Use "default" as slug for legacy instances
    const slug = "default";
    if (found.has(slug)) return;

    const instance = await this.parseInstance(slug, legacyDir, legacyConfig, "legacy");
    if (instance) found.set(slug, instance);
  }

  // --- Shared parsing logic ---

  /**
   * Parse an openclaw.json file and enrich with health/systemd info.
   * Returns null if the config is unreadable or invalid.
   */
  private async parseInstance(
    slug: string,
    stateDir: string,
    configPath: string,
    source: DiscoveredInstance["source"]
  ): Promise<DiscoveredInstance | null> {
    let configRaw: string;
    try {
      configRaw = await this.conn.readFile(configPath);
    } catch {
      return null;
    }

    let config: any;
    try {
      config = JSON.parse(configRaw);
    } catch {
      return null; // Malformed JSON
    }

    const port = config?.gateway?.port;
    if (typeof port !== "number") return null;

    // Extract agents
    const agents: DiscoveredAgent[] = [];
    const agentsList = config?.agents?.list ?? [];
    const defaultModel = config?.agents?.defaults?.model ?? null;

    // Add main agent
    agents.push({
      id: "main",
      name: config?.agents?.defaults?.name ?? "Main",
      model: defaultModel,
      workspacePath: `${stateDir}/workspaces/main`,
      isDefault: true,
    });

    for (const agent of agentsList) {
      if (!agent.id) continue;
      agents.push({
        id: agent.id,
        name: agent.name ?? agent.id,
        model: agent.model ?? defaultModel,
        workspacePath: `${stateDir}/workspaces/${agent.workspace ?? agent.id}`,
        isDefault: false,
      });
    }

    // Extract telegram bot
    let telegramBot: string | null = null;
    if (config?.channels?.telegram?.botUsername) {
      telegramBot = `@${config.channels.telegram.botUsername}`;
    }

    // Check gateway health
    let gatewayHealthy = false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(constants.HEALTH_CHECK_TIMEOUT),
      });
      gatewayHealthy = res.ok;
    } catch {
      // not healthy
    }

    // Check systemd (if not already set by strategy 2)
    let systemdUnit: string | null = null;
    let systemdState: DiscoveredInstance["systemdState"] = null;
    const unitName = `openclaw-${slug}.service`;
    const systemdResult = await this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user is-active ${unitName} 2>/dev/null || true`
    );
    const state = systemdResult.stdout.trim();
    if (["active", "inactive", "failed"].includes(state)) {
      systemdUnit = unitName;
      systemdState = state as "active" | "inactive" | "failed";
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

  /**
   * Compare discovered instances against the registry to determine
   * what's new, what's gone, and what's unchanged.
   */
  private reconcile(found: Map<string, DiscoveredInstance>): DiscoveryResult {
    const registered = new Map(
      this.registry.listInstances().map((i) => [i.slug, i])
    );

    const newInstances: DiscoveredInstance[] = [];
    const unchangedSlugs: string[] = [];
    const removedSlugs: string[] = [];

    // New instances (on disk but not in registry)
    for (const [slug, instance] of found) {
      if (registered.has(slug)) {
        unchangedSlugs.push(slug);
      } else {
        newInstances.push(instance);
      }
    }

    // Removed instances (in registry but no longer on disk)
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
   * Registers the instance, its agents, and its port.
   */
  async adopt(instance: DiscoveredInstance, serverId: number): Promise<void> {
    const record = this.registry.createInstance({
      serverId,
      slug: instance.slug,
      displayName: instance.slug,
      port: instance.port,
      configPath: instance.configPath,
      stateDir: instance.stateDir,
      systemdUnit: instance.systemdUnit ?? `openclaw-${instance.slug}.service`,
      telegramBot: instance.telegramBot ?? undefined,
      defaultModel: instance.defaultModel ?? undefined,
      discovered: true,
    });

    // Register agents
    for (const agent of instance.agents) {
      this.registry.createAgent(record.id, {
        agentId: agent.id,
        name: agent.name,
        model: agent.model ?? undefined,
        workspacePath: agent.workspacePath,
        isDefault: agent.isDefault,
      });
    }

    // Register port
    this.registry.allocatePort(serverId, instance.port, instance.slug);

    // Update state
    const state = instance.gatewayHealthy ? "running"
      : instance.systemdState === "active" ? "running"
      : instance.systemdState === "inactive" ? "stopped"
      : "unknown";
    this.registry.updateInstanceState(instance.slug, state);

    // Log event
    this.registry.logEvent(
      instance.slug,
      "discovered",
      `Adopted from existing infra (source: ${instance.source}, ${instance.agents.length} agents, port ${instance.port})`
    );
  }

  // --- Helpers ---

  private async findSlugByPort(port: number): Promise<string | null> {
    // Scan all .openclaw-* directories looking for a config with this port
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
        const config = JSON.parse(raw);
        if (config?.gateway?.port === port) {
          return entry.slice(prefix.length);
        }
      } catch {
        continue;
      }
    }
    return null;
  }
}
```

### 8.4 Test file

```
src/core/__tests__/discovery.test.ts
```

Uses `MockConnection` with pre-populated files and directories to verify:
- Each of the 4 heuristics finds instances correctly
- Deduplication across heuristics (directory + systemd for same slug)
- Reconciliation: new, unchanged, removed
- `adopt()` correctly populates registry (instance + agents + port + event)
- Legacy directory detected with slug "default"
- Malformed `openclaw.json` is skipped gracefully
- Unreachable gateway does not prevent adoption

---

## 9. Generators (`src/core/`)

### 9.1 Config generator (`config-generator.ts`)

Generates a complete `openclaw.json` from wizard answers.

**Inputs** (WizardAnswers):
```typescript
export interface WizardAnswers {
  slug: string;
  displayName: string;
  port: number;
  agents: AgentDefinition[];
  defaultModel: string;
  anthropicApiKey: "reuse" | string;  // "reuse" = copy from existing instance
  telegram: {
    enabled: boolean;
    botToken?: string;
  };
  mem0: {
    enabled: boolean;
    ollamaUrl?: string;
    qdrantHost?: string;
    qdrantPort?: number;
  };
}

export interface AgentDefinition {
  id: string;
  name: string;
  model?: string;          // override of defaultModel
  isDefault?: boolean;     // true for main
  workspace?: string;      // custom files (LLM-assisted mode)
}
```

**Output**: valid JSON string (openclaw.json)

**Logic**:
1. Build `meta`, `env` (variable references `${VAR}`)
2. Build `models.providers.anthropic` with the 3 Claude models
3. Build `agents.defaults` (main workspace, model, cache, heartbeat)
4. Build `agents.list` from `answers.agents`
5. Build `tools` (coding profile, agentToAgent enable with all agents)
6. Build `bindings` (webchat binding per non-main agent)
7. If telegram: build `channels.telegram`
8. Build `gateway` (port, loopback, token auth, trustedProxies)
9. If mem0: build `plugins` with full OSS config
10. Serialize as 2-space indented JSON

The generator does NOT perform variable substitution -- it writes `${ANTHROPIC_API_KEY}`
literally. OpenClaw resolves variables from the `.env` file at runtime.

### 9.2 Systemd generator (`systemd-generator.ts`)

**Inputs**:
```typescript
export interface SystemdOptions {
  slug: string;
  displayName: string;
  port: number;
  stateDir: string;
  configPath: string;
  openclawHome: string;
  openclawBin: string;   // path to the openclaw binary
}
```

**Output**: string of the `.service` file

Handlebars template (`templates/systemd.service.hbs`):
```ini
[Unit]
Description=OpenClaw Gateway - Instance {{slug}} ({{displayName}})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={{openclawBin}} gateway --port {{port}} --profile {{slug}}
Restart=always
RestartSec=5
KillMode=process
StandardOutput=append:{{stateDir}}/logs/gateway.log
StandardError=append:{{stateDir}}/logs/gateway.log
Environment=HOME={{openclawHome}}
Environment=PATH={{openclawHome}}/.local/bin:{{openclawHome}}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
Environment=OPENCLAW_PROFILE={{slug}}
Environment=OPENCLAW_STATE_DIR={{stateDir}}
Environment=OPENCLAW_CONFIG_PATH={{configPath}}
Environment=OPENCLAW_GATEWAY_PORT={{port}}
Environment=OPENCLAW_SYSTEMD_UNIT=openclaw-{{slug}}.service
Environment=OPENCLAW_SERVICE_MARKER=openclaw
Environment=OPENCLAW_SERVICE_KIND=gateway

[Install]
WantedBy=default.target
```

**Critical rule**: the 3 variables `OPENCLAW_PROFILE`, `OPENCLAW_STATE_DIR`,
`OPENCLAW_CONFIG_PATH` are ALWAYS present (trap 1 from the CDC).

### 9.3 .env generator

Generates the `.env` file:
```
ANTHROPIC_API_KEY=<value>
TELEGRAM_BOT_TOKEN=<value>
OPENCLAW_GW_AUTH_TOKEN=<generated token>
```

The gateway token is generated via `secrets.generateGatewayToken()`.

---

## 10. Provisioner (`src/core/provisioner.ts`)

Main orchestrator for `claw-pilot create`. Executes the 20+ steps in sequence.

```typescript
// src/core/provisioner.ts

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
    private portAllocator: PortAllocator
  ) {}

  async provision(answers: WizardAnswers): Promise<ProvisionResult> {
    // Step 1: Validation
    //   - slug unique (registry)
    //   - port free (registry + system)

    // Step 2: Create directory structure
    //   - stateDir/ (chmod 700)
    //   - stateDir/workspaces/
    //   - stateDir/logs/
    //   - /data/projects/<slug>/

    // Step 3: Generate secrets
    //   - gatewayToken = generateGatewayToken()
    //   - Write .env (chmod 600)

    // Step 4: Generate openclaw.json
    //   - configGenerator.generate(answers)
    //   - Write to stateDir/openclaw.json

    // Step 5: Create workspaces
    //   - For each agent: mkdir workspaces/<agentId>/
    //   - Copy bootstrap templates (AGENTS.md, SOUL.md, TOOLS.md, USER.md, MEMORY.md)
    //   - Substitute variables in templates (slug, agentName, etc.)

    // Step 6: Generate and install systemd service
    //   - systemdGenerator.generate(options)
    //   - Write to .config/systemd/user/openclaw-<slug>.service
    //   - systemctl --user daemon-reload

    // Step 7: Start instance
    //   - systemctl --user enable --now openclaw-<slug>
    //   - Wait for gateway to respond (health check, max 30s)

    // Step 8: Install mem0 plugin (if enabled)
    //   - openclaw --profile <slug> plugins install @mem0/openclaw-mem0@0.1.2
    //   - Re-inject OSS config into openclaw.json (trap 4)
    //   - Restart service
    //   - Verify "openclaw-mem0: initialized" in logs

    // Step 9: Bootstrap device pairing (trap 2)
    //   - Attempt HTTP connection to gateway (generates pending request)
    //   - openclaw --profile <slug> devices list -> extract request ID
    //   - openclaw --profile <slug> devices approve <request-id>

    // Step 10: Register in registry
    //   - Instance + agents + port

    // Step 11: Log event
    //   - registry.logEvent(slug, "created", detail)

    // Return result
  }
}
```

**Error handling**: each step is wrapped in try/catch. On failure, the provisioner
attempts a rollback of already-executed steps (deletes created files, stops service
if started, releases port).

---

## 11. Destroyer (`src/core/destroyer.ts`)

Symmetric to the provisioner -- cleans up everything:

```typescript
export class Destroyer {
  constructor(
    private conn: ServerConnection,
    private registry: Registry
  ) {}

  async destroy(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    // 1. Stop service
    await this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user stop ${instance.systemd_unit}`
    );

    // 2. Disable service
    await this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user disable ${instance.systemd_unit}`
    );

    // 3. Remove service file
    const serviceFile = path.join(getSystemdDir(), instance.systemd_unit);
    await this.conn.remove(serviceFile);

    // 4. Reload systemd
    await this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user daemon-reload`
    );

    // 5. Remove state directory
    await this.conn.remove(instance.state_dir, { recursive: true });

    // 6. Remove project directory
    await this.conn.remove(`/data/projects/${slug}`, { recursive: true });

    // 6. Release port in registry
    this.registry.releasePort(instance.server_id, instance.port);

    // 7. Delete agents from registry
    this.registry.deleteAgents(instance.id);

    // 8. Delete instance from registry
    this.registry.deleteInstance(slug);

    // 9. Log event
    this.registry.logEvent(slug, "destroyed");
  }
}
```

---

## 12. Lifecycle (`src/core/lifecycle.ts`)

```typescript
export class Lifecycle {
  constructor(
    private conn: ServerConnection,
    private registry: Registry
  ) {}

  private systemctl(action: string, unit: string): Promise<ExecResult> {
    return this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user ${action} ${unit}`
    );
  }

  async start(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.systemctl("start", instance.systemd_unit);
    // Wait for gateway to respond
    await this.waitForHealth(instance.port, constants.GATEWAY_READY_TIMEOUT);
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "started");
  }

  async stop(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.systemctl("stop", instance.systemd_unit);
    this.registry.updateInstanceState(slug, "stopped");
    this.registry.logEvent(slug, "stopped");
  }

  async restart(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    await this.systemctl("restart", instance.systemd_unit);
    await this.waitForHealth(instance.port, constants.GATEWAY_READY_TIMEOUT);
    this.registry.updateInstanceState(slug, "running");
    this.registry.logEvent(slug, "restarted");
  }

  private async waitForHealth(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new GatewayUnhealthyError("", port);
  }
}
```

---

## 13. Health checks (`src/core/health.ts`)

```typescript
export interface HealthStatus {
  slug: string;
  port: number;
  gateway: "healthy" | "unhealthy" | "unknown";
  systemd: "active" | "inactive" | "failed" | "unknown";
  pid?: number;
  uptime?: string;
  agentCount?: number;
  telegram?: "connected" | "disconnected" | "not_configured";
  pairedDevices?: number;
}

export class HealthChecker {
  constructor(
    private conn: ServerConnection,
    private registry: Registry
  ) {}

  async check(slug: string): Promise<HealthStatus> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    const status: HealthStatus = {
      slug,
      port: instance.port,
      gateway: "unknown",
      systemd: "unknown",
    };

    // 1. Systemd status
    const systemdResult = await this.conn.exec(
      `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user is-active ${instance.systemd_unit} 2>/dev/null || true`
    );
    const systemdState = systemdResult.stdout.trim();
    status.systemd = (["active", "inactive", "failed"].includes(systemdState)
      ? systemdState
      : "unknown") as HealthStatus["systemd"];

    // 2. Gateway health (HTTP)
    try {
      const res = await fetch(`http://127.0.0.1:${instance.port}/health`, {
        signal: AbortSignal.timeout(constants.HEALTH_CHECK_TIMEOUT),
      });
      status.gateway = res.ok ? "healthy" : "unhealthy";
    } catch {
      status.gateway = "unhealthy";
    }

    // 3. PID and uptime (from systemd)
    if (status.systemd === "active") {
      const pidResult = await this.conn.exec(
        `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user show ${instance.systemd_unit} --property=MainPID --value`
      );
      status.pid = parseInt(pidResult.stdout.trim()) || undefined;

      const uptimeResult = await this.conn.exec(
        `XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR} systemctl --user show ${instance.systemd_unit} --property=ActiveEnterTimestamp --value`
      );
      status.uptime = uptimeResult.stdout.trim() || undefined;
    }

    // 4. Agent count (from registry)
    const agents = this.registry.listAgents(slug);
    status.agentCount = agents.length;

    // 5. Telegram status
    if (instance.telegram_bot) {
      // Check gateway logs for telegram connection
      const logResult = await this.conn.exec(
        `tail -50 ${instance.state_dir}/logs/gateway.log 2>/dev/null | grep -c "telegram.*connected" || echo 0`
      );
      const connected = parseInt(logResult.stdout.trim()) > 0;
      status.telegram = connected ? "connected" : "disconnected";
    } else {
      status.telegram = "not_configured";
    }

    // Update registry state
    const newState = status.gateway === "healthy" ? "running" : status.systemd === "inactive" ? "stopped" : "error";
    this.registry.updateInstanceState(slug, newState);

    return status;
  }

  async checkAll(): Promise<HealthStatus[]> {
    const instances = this.registry.listInstances();
    return Promise.all(instances.map((i) => this.check(i.slug)));
  }
}
```

---

## 14. Pairing (`src/core/pairing.ts`)

### 14.1 Device pairing bootstrap (trap 2)

```typescript
export class PairingManager {
  constructor(
    private conn: ServerConnection,
    private registry: Registry
  ) {}

  /**
   * Bootstrap device pairing for a new instance.
   * Resolves the chicken-and-egg problem (trap 2 from CDC).
   */
  async bootstrapDevicePairing(slug: string): Promise<void> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    // Step 1: Trigger a pairing request by attempting an HTTP connection
    try {
      await fetch(`http://127.0.0.1:${instance.port}/`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Expected: connection rejected or 1008, but pairing request is now pending
    }

    // Step 2: List pending device requests
    const envVars = this.getOpenClawEnv(instance);
    const listResult = await this.conn.exec(
      `${envVars} openclaw --profile ${slug} devices list --json 2>/dev/null || true`
    );

    // Step 3: Parse the pending request ID
    const requestId = this.parsePendingRequestId(listResult.stdout);
    if (!requestId) {
      throw new ClawPilotError(
        `No pending pairing request found for "${slug}"`,
        "PAIRING_NO_REQUEST"
      );
    }

    // Step 4: Approve the request
    const approveResult = await this.conn.exec(
      `${envVars} openclaw --profile ${slug} devices approve ${requestId}`
    );
    if (approveResult.exitCode !== 0) {
      throw new ClawPilotError(
        `Failed to approve pairing: ${approveResult.stderr}`,
        "PAIRING_APPROVE_FAILED"
      );
    }
  }

  /**
   * Guide Telegram pairing (trap 3).
   * Watches gateway logs for the pairing code, then auto-approves.
   */
  async waitForTelegramPairing(
    slug: string,
    timeoutMs: number = constants.PAIRING_DETECT_TIMEOUT
  ): Promise<string> {
    const instance = this.registry.getInstance(slug);
    if (!instance) throw new InstanceNotFoundError(slug);

    const envVars = this.getOpenClawEnv(instance);
    const logPath = `${instance.state_dir}/logs/gateway.log`;
    const start = Date.now();

    // Poll logs for telegram pairing code
    while (Date.now() - start < timeoutMs) {
      const result = await this.conn.exec(
        `tail -20 ${logPath} 2>/dev/null | grep "pairing.*telegram" || true`
      );

      const code = this.parseTelegramPairingCode(result.stdout);
      if (code) {
        // Auto-approve
        await this.conn.exec(
          `${envVars} openclaw --profile ${slug} pairing approve telegram ${code}`
        );
        return code;
      }

      await new Promise((r) => setTimeout(r, 2_000));
    }

    throw new ClawPilotError(
      "Telegram pairing code not detected within timeout",
      "TELEGRAM_PAIRING_TIMEOUT"
    );
  }

  private getOpenClawEnv(instance: InstanceRecord): string {
    return `OPENCLAW_STATE_DIR=${instance.state_dir} OPENCLAW_CONFIG_PATH=${instance.config_path}`;
  }

  private parsePendingRequestId(output: string): string | null {
    // Parse JSON output from `devices list --json` or fallback to regex
    try {
      const data = JSON.parse(output);
      const pending = data.find?.((d: any) => d.status === "pending");
      return pending?.id ?? null;
    } catch {
      // Fallback: regex parse
      const match = output.match(/id:\s*(\S+).*pending/i);
      return match?.[1] ?? null;
    }
  }

  private parseTelegramPairingCode(output: string): string | null {
    const match = output.match(/code[:\s]+([A-Z0-9]{8})/i);
    return match?.[1] ?? null;
  }
}
```

---

## 15. OpenClaw CLI wrapper (`src/core/openclaw-cli.ts`)

Encapsulates calls to the `openclaw` CLI with the correct environment variables.

```typescript
export class OpenClawCLI {
  constructor(private conn: ServerConnection) {}

  /** Detect openclaw binary path and version */
  async detect(): Promise<{ bin: string; version: string } | null> {
    // Try common paths
    const paths = [
      "openclaw",
      "/opt/openclaw/.npm-global/bin/openclaw",
      `${process.env.HOME}/.npm-global/bin/openclaw`,
    ];

    for (const bin of paths) {
      const result = await this.conn.exec(`${bin} --version 2>/dev/null || true`);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return { bin, version: result.stdout.trim() };
      }
    }
    return null;
  }

  /** Run openclaw command for a specific instance */
  async run(slug: string, stateDir: string, configPath: string, args: string): Promise<ExecResult> {
    const env = [
      `OPENCLAW_STATE_DIR=${stateDir}`,
      `OPENCLAW_CONFIG_PATH=${configPath}`,
      `PATH=/opt/openclaw/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
    ].join(" ");

    return this.conn.exec(`${env} openclaw --profile ${slug} ${args}`);
  }

  /** Install a plugin for an instance */
  async installPlugin(slug: string, stateDir: string, configPath: string, pkg: string): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, `plugins install ${pkg}`);
  }

  /** Run doctor for an instance */
  async doctor(slug: string, stateDir: string, configPath: string): Promise<ExecResult> {
    return this.run(slug, stateDir, configPath, "doctor");
  }
}
```

---

## 16. Wizard (`src/wizard/`)

### 16.1 Flow

The wizard is a pipeline of 10 sequential steps. Each step is an async function
that collects answers via `@inquirer/prompts` and adds them to `WizardAnswers`.

```typescript
// src/wizard/wizard.ts

export async function runWizard(
  registry: Registry,
  portAllocator: PortAllocator,
  conn: ServerConnection
): Promise<WizardAnswers> {
  const answers: Partial<WizardAnswers> = {};

  // Step 1: Identity (slug + display name)
  // Step 2: Port (auto-suggest, override possible)
  // Step 3: Agent team (Custom / Minimal)
  // Step 4: Default model
  // Step 5: Anthropic API key (reuse existing / enter new)
  // Step 6: Telegram (enable + bot token)
  // Step 7: Nginx (enable + domain)
  // Step 8: mem0 (auto-detect Ollama+Qdrant)
  // Step 9: Summary + confirmation
  // (Step 10 = provisioning, outside wizard)

  return answers as WizardAnswers;
}
```

### 16.2 Detailed prompts (`src/wizard/prompts.ts`)

```typescript
import { input, select, confirm, password } from "@inquirer/prompts";

export async function promptSlug(registry: Registry): Promise<{ slug: string; displayName: string }> {
  const slug = await input({
    message: "Instance slug (lowercase, no spaces):",
    validate: (value) => {
      if (!/^[a-z][a-z0-9-]*$/.test(value)) return "Slug must be lowercase alphanumeric with hyphens";
      if (value.length < 2 || value.length > 30) return "Slug must be 2-30 characters";
      if (registry.getInstance(value)) return `Instance "${value}" already exists`;
      return true;
    },
  });

  const displayName = await input({
    message: "Display name:",
    default: slug.charAt(0).toUpperCase() + slug.slice(1),
  });

  return { slug, displayName };
}

export async function promptPort(portAllocator: PortAllocator, serverId: number): Promise<number> {
  const suggested = await portAllocator.findFreePort(serverId);

  const portStr = await input({
    message: `Gateway port (auto: ${suggested}):`,
    default: String(suggested),
    validate: async (value) => {
      const port = parseInt(value);
      if (isNaN(port) || port < 1024 || port > 65535) return "Invalid port number";
      const free = await portAllocator.verifyPort(serverId, port);
      if (!free) return `Port ${port} is already in use`;
      return true;
    },
  });

  return parseInt(portStr);
}

export async function promptAgents(): Promise<{ mode: "custom" | "minimal"; agents: AgentDefinition[] }> {
  const mode = await select({
    message: "How do you want to configure agents?",
    choices: [
      { value: "custom", name: "Custom (define agents one by one)" },
      { value: "minimal", name: "Minimal (main agent only)" },
    ],
  });

  if (mode === "minimal") {
    return {
      mode,
      agents: [{ id: "main", name: "Main", isDefault: true }],
    };
  }

  // Custom mode: loop to add agents
  const agents: AgentDefinition[] = [{ id: "main", name: "Main", isDefault: true }];
  let addMore = true;

  while (addMore) {
    const agentId = await input({
      message: "Agent ID (e.g., pm, dev-back):",
      validate: (v) => {
        if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Must be lowercase alphanumeric with hyphens";
        if (agents.some((a) => a.id === v)) return "Agent ID already used";
        return true;
      },
    });

    const name = await input({ message: "Agent name:" });

    const modelOverride = await input({
      message: "Model override (enter to use default):",
      default: "",
    });

    agents.push({
      id: agentId,
      name,
      model: modelOverride || undefined,
    });

    addMore = await confirm({ message: "Add another agent?", default: true });
  }

  return { mode, agents };
}

export async function promptModel(): Promise<string> {
  return select({
    message: "Default model for agents:",
    choices: [
      { value: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6 (recommended)" },
      { value: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" },
      { value: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  });
}

export async function promptApiKey(
  existingInstances: InstanceRecord[]
): Promise<"reuse" | string> {
  if (existingInstances.length > 0) {
    const source = await select({
      message: "Anthropic API key:",
      choices: [
        { value: "reuse", name: `Reuse from existing instance (${existingInstances[0].slug})` },
        { value: "new", name: "Enter new key" },
      ],
    });
    if (source === "reuse") return "reuse";
  }

  return password({ message: "Anthropic API key:" });
}

export async function promptTelegram(): Promise<{ enabled: boolean; botToken?: string }> {
  const enabled = await confirm({ message: "Enable Telegram bot?", default: false });
  if (!enabled) return { enabled: false };

  const botToken = await password({ message: "Telegram bot token:" });
  return { enabled: true, botToken };
}

```

### 16.3 Workspace templates (`src/wizard/templates.ts`)

Handlebars templates for workspace bootstrap files.

Templates are stored in `templates/workspace/` and compiled at runtime.

Available template variables:
- `{{slug}}`: instance slug
- `{{agentId}}`: agent ID
- `{{agentName}}`: agent name
- `{{displayName}}`: instance name
- `{{projectDir}}`: `/data/projects/<slug>/`

---

## 17. CLI commands (`src/commands/`)

### 17.1 Entry point (`src/index.ts`)

```typescript
#!/usr/bin/env node
import { Command } from "commander";
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

const program = new Command();

program
  .name("claw-pilot")
  .description("Orchestrator for OpenClaw multi-instance clusters")
  .version("1.0.0");

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

program.parse();
```

### 17.2 Each command follows the same pattern

```typescript
// src/commands/list.ts
import { Command } from "commander";
import Table from "cli-table3";
import { getDbPath } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { HealthChecker } from "../core/health.js";
import { LocalConnection } from "../server/local.js";

export function listCommand(): Command {
  return new Command("list")
    .description("List all instances with their status")
    .action(async () => {
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);
      const conn = new LocalConnection();
      const health = new HealthChecker(conn, registry);

      const statuses = await health.checkAll();

      const table = new Table({
        head: ["Instance", "Port", "Status", "Agents", "Telegram", "Uptime"],
      });

      for (const s of statuses) {
        table.push([
          s.slug,
          s.port,
          s.gateway === "healthy" ? "running" : s.systemd,
          s.agentCount ?? "?",
          s.telegram ?? "-",
          s.uptime ?? "-",
        ]);
      }

      console.log(table.toString());
      db.close();
    });
}
```

### 17.3 `init` command

The `init` command is the entry point for Claw Pilot. It handles both fresh installs and
re-scans on existing setups.

```typescript
// src/commands/init.ts
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { getDataDir, getDbPath, getOpenClawHome } from "../lib/platform.js";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { InstanceDiscovery } from "../core/discovery.js";
import { OpenClawCLI } from "../core/openclaw-cli.js";
import { LocalConnection } from "../server/local.js";

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize Claw Pilot (registry + discover existing instances)")
    .action(async () => {
      const conn = new LocalConnection();

      // 1. Create data directory
      await conn.mkdir(getDataDir(), { mode: 0o700 });

      // 2. Initialize database
      const db = initDatabase(getDbPath());
      const registry = new Registry(db);

      // 3. Detect OpenClaw
      const cli = new OpenClawCLI(conn);
      const openclaw = await cli.detect();
      if (!openclaw) {
        throw new OpenClawNotFoundError();
      }
      console.log(`OpenClaw detected: ${openclaw.version}`);

      // 4. Register local server
      const hostname = await conn.hostname();
      const openclawHome = getOpenClawHome();
      const server = registry.upsertLocalServer(hostname, openclawHome);

      // 5. Discover existing instances
      console.log("\nScanning for existing OpenClaw instances...");
      const discovery = new InstanceDiscovery(conn, registry, openclawHome);
      const result = await discovery.scan();

      // 5a. Show what was found
      if (result.instances.length === 0) {
        console.log("  No existing instances found.");
      } else {
        for (const inst of result.instances) {
          const stateLabel = inst.gatewayHealthy ? "healthy" :
            inst.systemdState === "active" ? "active" : "stopped";
          const registeredLabel = result.newInstances.includes(inst) ? "NEW" : "registered";
          console.log(
            `  [${registeredLabel}] ${inst.slug}  port:${inst.port}  ` +
            `systemd:${inst.systemdState ?? "none"}  gateway:${stateLabel}  ` +
            `agents:${inst.agents.length}  (source: ${inst.source})`
          );
        }
      }

      // 5b. Adopt new instances
      if (result.newInstances.length > 0) {
        const adoptAll = await confirm({
          message: `Adopt ${result.newInstances.length} new instance(s) into Claw Pilot registry?`,
          default: true,
        });

        if (adoptAll) {
          for (const inst of result.newInstances) {
            await discovery.adopt(inst, server.id);
            console.log(`  Adopted: ${inst.slug} (${inst.agents.length} agents, port ${inst.port})`);
          }
        }
      }

      // 5c. Handle removed instances
      if (result.removedSlugs.length > 0) {
        console.log("\nInstances in registry but no longer found on disk:");
        for (const slug of result.removedSlugs) {
          console.log(`  - ${slug}`);
        }
        const removeStale = await confirm({
          message: `Remove ${result.removedSlugs.length} stale instance(s) from registry?`,
          default: false,
        });

        if (removeStale) {
          for (const slug of result.removedSlugs) {
            const instance = registry.getInstance(slug);
            if (instance) {
              registry.releasePort(instance.server_id, instance.port);
              registry.deleteAgents(instance.id);
              registry.deleteInstance(slug);
              console.log(`  Removed: ${slug}`);
            }
          }
        }
      }

      // 6. Detect shared resources
      console.log("\nShared resources:");
      const ollamaResult = await conn.exec("curl -s http://127.0.0.1:11434/api/version 2>/dev/null || true");
      console.log(`  Ollama:  ${ollamaResult.stdout.trim() ? "running" : "not detected"}`);

      const qdrantResult = await conn.exec("curl -s http://127.0.0.1:6333/healthz 2>/dev/null || true");
      console.log(`  Qdrant:  ${qdrantResult.stdout.includes("ok") ? "running" : "not detected"}`);

      const dockerResult = await conn.exec("docker info --format '{{.ServerVersion}}' 2>/dev/null || true");
      console.log(`  Docker:  ${dockerResult.stdout.trim() || "not detected"}`);

      // 7. Summary
      const totalInstances = registry.listInstances().length;
      console.log(`\n${totalInstances} instance(s) in registry.`);
      console.log("Ready. Run 'claw-pilot create' to provision a new instance.");

      db.close();
    });
}
```

### 17.4 `create` command

- Runs the wizard (`runWizard()`)
- Runs the provisioner (`provisioner.provision(answers)`)
- Displays summary (URL, token, etc.)
- If Telegram enabled, runs the pairing guide

### 17.5 `destroy` command

- Asks for confirmation (re-type the slug)
- Runs the destroyer
- Displays summary

### 17.6 `doctor` command

- If a slug is provided: diagnose that instance
- Otherwise: diagnose all instances
- Checks: config valid, service enabled, gateway healthy, port conflict,
  lock file, Telegram, device pairing, mem0

---

## 18. Web dashboard (`src/dashboard/`)

### 18.1 Architecture

```
Browser  <--WS-->  Dashboard Server (Hono, port 19000)  <--HTTP/WS-->  Gateways (ports 18789+)
                         |
                    SQLite (registry)
```

The dashboard is a lightweight HTTP server (Hono) that:
1. Serves static files (Lit UI, built by Vite)
2. Exposes a REST API for CRUD operations
3. Maintains WebSocket connections with browser clients
4. Polls gateways every 10s and pushes updates to clients

### 18.2 REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/instances` | List all instances with status |
| `GET` | `/api/instances/:slug` | Instance detail |
| `GET` | `/api/instances/:slug/agents` | Instance agents |
| `GET` | `/api/instances/:slug/health` | Instance health check |
| `POST` | `/api/instances/:slug/start` | Start an instance |
| `POST` | `/api/instances/:slug/stop` | Stop an instance |
| `POST` | `/api/instances/:slug/restart` | Restart an instance |
| `DELETE` | `/api/instances/:slug` | Destroy an instance |
| `GET` | `/api/health` | Dashboard health |

Auth: `Authorization: Bearer <token>` header (token in `~/.claw-pilot/dashboard-token`).

### 18.3 WebSocket protocol

The server pushes JSON messages to connected clients:

```typescript
// Messages server -> client
interface WSMessage {
  type: "health_update" | "instance_created" | "instance_destroyed" | "log_line";
  payload: any;
}

// health_update payload:
{
  instances: HealthStatus[]  // All instances, refreshed every 10s
}

// log_line payload:
{
  slug: string;
  line: string;
  timestamp: string;
}
```

### 18.4 Monitor (`src/dashboard/monitor.ts`)

```typescript
export class Monitor {
  private interval: NodeJS.Timeout | null = null;
  private clients: Set<WebSocket> = new Set();

  constructor(
    private health: HealthChecker,
    private intervalMs: number = constants.HEALTH_POLL_INTERVAL
  ) {}

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  start(): void {
    this.interval = setInterval(async () => {
      const statuses = await this.health.checkAll();
      this.broadcast({
        type: "health_update",
        payload: { instances: statuses },
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private broadcast(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }
}
```

### 18.5 UI components (Lit)

| Component | Description |
|-----------|-------------|
| `<app-shell>` | Main shell (header, navigation, router) |
| `<cluster-view>` | Instance card grid (home page) |
| `<instance-card>` | Single instance card (slug, port, status, buttons) |
| `<instance-detail>` | Detail page (agents, logs, actions, Control UI link) |
| `<log-viewer>` | Real-time logs (auto-scroll, filter) |
| `<create-dialog>` | Creation dialog (simplified web version of wizard) |

The Vite build outputs a bundle in `dist/ui/` that Hono serves as static files.

### 18.6 Dashboard server (`src/dashboard/server.ts`)

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";

export function startDashboard(options: {
  port: number;
  token: string;
  registry: Registry;
  conn: ServerConnection;
}): void {
  const app = new Hono();
  const health = new HealthChecker(options.conn, options.registry);
  const lifecycle = new Lifecycle(options.conn, options.registry);
  const monitor = new Monitor(health);

  // Auth middleware
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${options.token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // API routes
  app.get("/api/instances", async (c) => {
    const statuses = await health.checkAll();
    return c.json(statuses);
  });

  app.post("/api/instances/:slug/start", async (c) => {
    await lifecycle.start(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    await lifecycle.stop(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    await lifecycle.restart(c.req.param("slug"));
    return c.json({ ok: true });
  });

  // Static files (Lit UI)
  app.use("/*", serveStatic({ root: "./dist/ui" }));

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port: options.port });

  // WebSocket server (piggyback on HTTP server)
  const wss = new WebSocketServer({ server: server as any });
  wss.on("connection", (ws) => {
    // Validate token from query string
    monitor.addClient(ws);
  });

  monitor.start();
}
```

---

## 19. Installer (`install.sh`)

POSIX-compatible shell script:

```bash
#!/bin/sh
set -e

REPO="swoelffel/claw-pilot"
MIN_NODE_VERSION=22

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error() { printf "${RED}[x]${NC} %s\n" "$1"; exit 1; }

# 1. Check OS
OS=$(uname -s)
case "$OS" in
  Linux)  log "Detected Linux" ;;
  Darwin) log "Detected macOS (dev mode)" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

# 2. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first."
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
  error "Node.js >= $MIN_NODE_VERSION required (found v$(node -v))"
fi
log "Node.js $(node -v)"

# 3. Check pnpm (install if missing)
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found, installing..."
  npm install -g pnpm
fi
log "pnpm $(pnpm --version)"

# 4. Check OpenClaw
if ! command -v openclaw >/dev/null 2>&1; then
  error "OpenClaw not found. Install it first: https://docs.openclaw.ai"
fi
log "OpenClaw $(openclaw --version 2>/dev/null || echo 'unknown')"

# 5. Install claw-pilot
log "Installing claw-pilot..."
pnpm install -g claw-pilot

# 6. Verify
if ! command -v claw-pilot >/dev/null 2>&1; then
  error "Installation failed. claw-pilot not found in PATH."
fi
log "claw-pilot $(claw-pilot --version) installed"

# 7. Initialize (includes automatic discovery)
log "Initializing..."
claw-pilot init

log "Done! Run 'claw-pilot create' to provision a new instance."
```

---

## 20. Tests (`vitest`)

### 20.1 Strategy

| Type | Coverage | Tools |
|------|----------|-------|
| **Unit** | core/ (registry, discovery, generators, secrets, port-allocator) | vitest, mocks |
| **Integration** | provisioner, destroyer, lifecycle (with real SQLite) | vitest, tmpdir |
| **E2E** | Full CLI on a test environment | vitest, execa |

### 20.2 Test files

```
src/
  core/
    __tests__/
      registry.test.ts
      discovery.test.ts
      secrets.test.ts
      port-allocator.test.ts
      config-generator.test.ts
      systemd-generator.test.ts
      provisioner.test.ts
      destroyer.test.ts
      health.test.ts
  server/
    __tests__/
      local.test.ts
  db/
    __tests__/
      schema.test.ts
```

### 20.3 Mock ServerConnection

For unit tests, a `MockConnection` is provided:

```typescript
export class MockConnection implements ServerConnection {
  public commands: string[] = [];
  public files: Map<string, string> = new Map();
  public dirs: Set<string> = new Set();

  async exec(command: string): Promise<ExecResult> {
    this.commands.push(command);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
  }

  // ... etc
}
```

---

## 21. Build and distribution

### 21.1 Build pipeline

```bash
pnpm build        # tsdown (CLI) + vite build (UI)
pnpm test:run     # vitest
pnpm lint         # oxlint
pnpm typecheck    # tsc --noEmit
```

### 21.2 tsdown config

```typescript
// tsdown.config.ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3"],
});
```

### 21.3 Distribution

- **npm**: `npm publish` (public package)
- **GitHub Releases**: tag + binary (optional)
- **install.sh**: curl | sh (installs via pnpm/npm)

---

## 22. Recommended implementation order

| Phase | Modules | Estimated effort |
|-------|---------|-----------------|
| **Phase 1: Foundations** | `lib/`, `db/schema`, `server/local`, `core/registry`, `core/secrets`, `core/port-allocator` | 2-3 days |
| **Phase 2: Discovery** | `core/discovery`, `commands/init` (with full scan + adopt flow) | 1-2 days |
| **Phase 3: Generators** | `core/config-generator`, `core/systemd-generator`, `templates/` | 2 days |
| **Phase 4: CLI base** | `index.ts`, `commands/list`, `commands/status`, `commands/doctor` | 2 days |
| **Phase 5: Wizard + Provisioner** | `wizard/`, `core/provisioner`, `commands/create` | 3 days |
| **Phase 6: Lifecycle + Destroy** | `core/lifecycle`, `core/destroyer`, `commands/start,stop,restart,destroy` | 1 day |
| **Phase 7: Pairing** | `core/pairing`, `core/openclaw-cli` | 1 day |
| **Phase 8: Dashboard** | `dashboard/server`, `dashboard/monitor`, `dashboard/api/`, `dashboard/ui/` | 3-4 days |
| **Phase 9: Logs + Doctor** | `commands/logs`, improved `commands/doctor` | 1 day |
| **Phase 10: Tests** | Unit + integration tests for each module | 2-3 days |
| **Phase 11: Installer + Packaging** | `install.sh`, final `package.json`, README | 1 day |

**Total estimate: ~19-24 days** for an experienced developer.

---

*Updated: 2026-02-22 - v1.1: Translated to English, added discovery module (section 8), updated init command with full discovery flow, added `discovered` column to instances schema*
