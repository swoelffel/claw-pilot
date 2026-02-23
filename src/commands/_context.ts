// src/commands/_context.ts
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { LocalConnection } from "../server/local.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { getDbPath } from "../lib/platform.js";
import type { Database } from "better-sqlite3";

export interface CommandContext {
  db: Database;
  registry: Registry;
  conn: LocalConnection;
  xdgRuntimeDir: string;
}

/**
 * Initialize command context and guarantee database closure via try/finally,
 * even when an error is thrown.
 */
export async function withContext<T>(
  fn: (ctx: CommandContext) => Promise<T>,
): Promise<T> {
  const db = initDatabase(getDbPath());
  try {
    const registry = new Registry(db);
    const conn = new LocalConnection();
    const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);
    return await fn({ db, registry, conn, xdgRuntimeDir });
  } finally {
    db.close();
  }
}
