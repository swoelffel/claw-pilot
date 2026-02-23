// src/lib/xdg.ts
import type { ServerConnection } from "../server/connection.js";

/**
 * Resolve the XDG_RUNTIME_DIR for the current user by querying `id -u`.
 * Falls back to UID 1000 if the command fails or returns a non-numeric value.
 *
 * Call this once at startup and pass the result to classes that need it
 * (Lifecycle, HealthChecker, Destroyer, Discovery).
 */
export async function resolveXdgRuntimeDir(
  conn: ServerConnection,
): Promise<string> {
  try {
    const result = await conn.exec("id -u");
    const uid = parseInt(result.stdout.trim(), 10);
    if (!isNaN(uid) && uid > 0) {
      return `/run/user/${uid}`;
    }
  } catch {
    // id -u failed — fall through to default UID 1000
  }
  return "/run/user/1000";
}
