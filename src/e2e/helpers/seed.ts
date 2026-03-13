// src/e2e/helpers/seed.ts
// DB seeding helpers for e2e tests

import type Database from "better-sqlite3";
import { hashPassword } from "../../core/auth.js";
import { constants } from "../../lib/constants.js";
import type { Registry } from "../../core/registry.js";

export const SEED_PASSWORD = "E2eTestPassword1";

/** Seed the admin user with a known password. */
export async function seedAdmin(db: Database.Database, password = SEED_PASSWORD): Promise<void> {
  const hash = await hashPassword(password);
  db.prepare(
    "INSERT OR REPLACE INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
  ).run(constants.ADMIN_USERNAME, hash);
}

/** Seed the local server row (required for instance creation). */
export function seedLocalServer(registry: Registry): number {
  registry.upsertLocalServer("test-host", "/home/test/.openclaw");
  const server = registry.getLocalServer();
  if (!server) throw new Error("Failed to seed local server");
  return server.id;
}

export interface SeedInstanceOptions {
  slug: string;
  port: number;
  state?: "running" | "stopped" | "error";
  displayName?: string;
}

/** Seed an instance directly in the DB (bypasses provisioner). */
export function seedInstance(
  registry: Registry,
  serverId: number,
  opts: SeedInstanceOptions,
): void {
  const { slug, port, state = "stopped", displayName } = opts;
  registry.allocatePort(serverId, port, slug);
  registry.createInstance({
    serverId,
    slug,
    port,
    configPath: `/home/test/.openclaw-${slug}/runtime.json`,
    stateDir: `/home/test/.openclaw-${slug}`,
    systemdUnit: `claw-runtime-${slug}.service`,
    ...(displayName !== undefined ? { displayName } : {}),
  });
  // Set the desired state (createInstance defaults to 'unknown')
  registry.updateInstanceState(slug, state);
}
