// src/server/registry.ts
import type Database from "better-sqlite3";
import { ClawPilotError } from "../lib/errors.js";
import type { ServerConnection } from "./connection.js";
import { capabilities } from "../core/capabilities.js";
import { ServerRepository } from "../core/repositories/server-repository.js";

export type ServerKind = "local" | "remote";

export interface ServerNode {
  id: string;
  kind: ServerKind;
  hostname: string;
  connection: ServerConnection;
}

export interface ResourceRef {
  kind: "instance" | "agent" | "session";
  id: string;
  /** Enterprise-only slot — carries the organization id through the routing pipeline. Community ignores this field. */
  orgId?: string;
}

export interface ServerRegistry {
  /**
   * Returns all known `ServerNode`s. Community returns `[getLocal()]`.
   */
  list(): readonly ServerNode[];

  /**
   * Returns the `ServerNode` for a given id, or `null` if unknown.
   */
  get(id: string): ServerNode | null;

  /**
   * Returns the local `ServerNode` for this process. Every `ServerRegistry`
   * implementation MUST have a local node.
   */
  getLocal(): ServerNode;

  /**
   * Returns the `ServerNode` that owns/serves the given resource. Community
   * returns the local node unconditionally; Enterprise uses a routing strategy
   * (hash ring, explicit mapping, geographic).
   */
  route(resource: ResourceRef): ServerNode;
}

export const SINGLE_SERVER_BRAND: unique symbol = Symbol("single-server-registry");

export class SingleServerRegistry implements ServerRegistry {
  /**
   * Brand symbol used by `isSingleRegistry` to bypass the capability gate in
   * `registerServerRegistry`. Presence of this symbol on an instance signals
   * that the registry is a single-server (Community) implementation and does
   * not require the `multi-server` capability.
   */
  readonly [SINGLE_SERVER_BRAND] = true;
  private readonly node: ServerNode;

  constructor(db: Database.Database, connection: ServerConnection) {
    const row = new ServerRepository(db).getLocalServer();
    if (!row) {
      throw new ClawPilotError(
        "ServerRegistry requires a local server row — run Registry.upsertLocalServer() first",
        "SERVER_REGISTRY_NOT_BOOTSTRAPPED",
      );
    }
    this.node = {
      id: String(row.id), // ServerNode.id is typed as string (UUID-ready for Enterprise); SQLite returns a number, hence the cast.
      kind: "local",
      hostname: row.hostname,
      connection,
    };
  }

  list(): readonly ServerNode[] {
    return [this.node];
  }
  get(id: string): ServerNode | null {
    return id === this.node.id ? this.node : null;
  }
  getLocal(): ServerNode {
    return this.node;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  route(_resource: ResourceRef): ServerNode {
    return this.node;
  }
}

function isSingleRegistry(impl: ServerRegistry): boolean {
  return (impl as unknown as Record<symbol, unknown>)[SINGLE_SERVER_BRAND] === true;
}

let current: ServerRegistry | null = null;
let locked = false;

/**
 * Register the ServerRegistry implementation. Must be called exactly once
 * during bootstrap. A second call throws a `ClawPilotError` with code
 * `SERVER_REGISTRY_LOCKED`.
 *
 * Accepts `SingleServerRegistry` instances without any capability check.
 * Any other `ServerRegistry` implementation is only accepted when
 * `capabilities.has('multi-server')` returns true. Enterprise implementations
 * that wrap or extend `SingleServerRegistry` inherit the brand automatically;
 * standalone Enterprise implementations must rely on the capability gate.
 */
export function registerServerRegistry(impl: ServerRegistry): void {
  if (locked) {
    throw new ClawPilotError(
      "ServerRegistry already locked — registerServerRegistry() must be called exactly once during bootstrap",
      "SERVER_REGISTRY_LOCKED",
    );
  }
  if (!isSingleRegistry(impl) && !capabilities.has("multi-server")) {
    throw new ClawPilotError(
      "Registering a non-single ServerRegistry requires the 'multi-server' capability",
      "MULTI_SERVER_CAPABILITY_REQUIRED",
    );
  }
  current = impl;
  locked = true;
}

/**
 * Test-only: reset the singleton between tests. Silently no-ops in production
 * (NODE_ENV !== 'test'). Prefer vi.resetModules() if stricter isolation is needed.
 */
export function resetServerRegistry(): void {
  if (process.env.NODE_ENV !== "test") return;
  current = null;
  locked = false;
}

/**
 * Returns the registered ServerRegistry implementation.
 * Throws `ClawPilotError` with code `SERVER_REGISTRY_NOT_REGISTERED` if not
 * yet registered.
 */
export function getServerRegistry(): ServerRegistry {
  if (current === null) {
    throw new ClawPilotError(
      "ServerRegistry not registered — call registerServerRegistry() during bootstrap",
      "SERVER_REGISTRY_NOT_REGISTERED",
    );
  }
  return current;
}

/**
 * Idempotent bootstrap used by withContext() and dashboard server startup.
 * No-ops if the registry is already registered (since this function may be
 * called multiple times across nested command invocations).
 */
export function bootstrapServerRegistry(db: Database.Database, conn: ServerConnection): void {
  if (locked) return;
  registerServerRegistry(new SingleServerRegistry(db, conn));
}

/**
 * Unlike `capabilities`, `serverRegistry` has no default Community
 * implementation. All methods throw `SERVER_REGISTRY_NOT_REGISTERED` until
 * `registerServerRegistry()` is called during bootstrap (see
 * `bootstrapServerRegistry` in T3).
 *
 * Singleton proxy that delegates every method to the registered implementation.
 * Consumers can import once and keep a stable reference even though the
 * underlying registry is set at bootstrap.
 */
export const serverRegistry: ServerRegistry = {
  list: () => getServerRegistry().list(),
  get: (id) => getServerRegistry().get(id),
  getLocal: () => getServerRegistry().getLocal(),
  route: (resource) => getServerRegistry().route(resource),
};
