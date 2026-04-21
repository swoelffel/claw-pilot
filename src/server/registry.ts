// src/server/registry.ts
import { ClawPilotError } from "../lib/errors.js";
import type { ServerConnection } from "./connection.js";

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

let current: ServerRegistry | null = null;
let locked = false;

/**
 * Register the ServerRegistry implementation. Must be called exactly once
 * during bootstrap. A second call throws a `ClawPilotError` with code
 * `SERVER_REGISTRY_LOCKED`.
 */
export function registerServerRegistry(impl: ServerRegistry): void {
  if (locked) {
    throw new ClawPilotError(
      "ServerRegistry already locked — registerServerRegistry() must be called exactly once during bootstrap",
      "SERVER_REGISTRY_LOCKED",
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
