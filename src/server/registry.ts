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
  list(): readonly ServerNode[];
  get(id: string): ServerNode | null;
  getLocal(): ServerNode;
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
 * Test-only. Resets the registry to its initial unregistered state.
 */
export function resetServerRegistry(): void {
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
