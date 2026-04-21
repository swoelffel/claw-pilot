// src/server/__tests__/_helpers/with-registry.ts
import type Database from "better-sqlite3";
import { Registry } from "../../../core/registry.js";
import { LocalConnection } from "../../local.js";
import { bootstrapServerRegistry, resetServerRegistry } from "../../registry.js";

/**
 * Upsert a local server row and bootstrap the ServerRegistry on the given DB.
 * Use in tests that need `serverRegistry.getLocal()` to work.
 */
export function bootstrapTestRegistry(
  db: Database.Database,
  hostname = "localhost",
  home = "/tmp/test-home",
): void {
  new Registry(db).upsertLocalServer(hostname, home);
  resetServerRegistry();
  bootstrapServerRegistry(db, new LocalConnection());
}

export { resetServerRegistry };
