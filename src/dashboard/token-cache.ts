// src/dashboard/token-cache.ts
//
// In-memory cache for gateway tokens to avoid reading .env files on every API call.
// Invalidated on lifecycle events (create, destroy, restart).

import type { ServerConnection } from "../server/connection.js";
import { readGatewayToken } from "../lib/env-reader.js";

export class TokenCache {
  private cache = new Map<string, string | null>();

  constructor(private conn: ServerConnection) {}

  /** Get a cached gateway token, reading from disk on cache miss. */
  async get(slug: string, stateDir: string): Promise<string | null> {
    if (this.cache.has(slug)) return this.cache.get(slug)!;
    const token = await readGatewayToken(this.conn, stateDir);
    this.cache.set(slug, token);
    return token;
  }

  /** Invalidate a single entry (call on create/destroy/restart). */
  invalidate(slug: string): void {
    this.cache.delete(slug);
  }

  /** Invalidate all entries. */
  clear(): void {
    this.cache.clear();
  }
}
