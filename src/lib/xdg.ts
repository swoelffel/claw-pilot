// src/lib/xdg.ts
import type { ServerConnection } from "../server/connection.js";
import { isDarwin } from "./platform.js";

/**
 * Resolve the XDG_RUNTIME_DIR for the current user by querying `id -u`.
 * Falls back to UID 1000 if the command fails or returns a non-numeric value.
 *
 * On macOS, XDG_RUNTIME_DIR is Linux-only — returns an empty string (or the
 * env var if set). Callers use this value only for systemctl env, which is
 * never invoked on macOS.
 *
 * Call this once at startup and pass the result to classes that need it
 * (Lifecycle, HealthChecker, Destroyer, Discovery).
 */
export async function resolveXdgRuntimeDir(
  conn: ServerConnection,
): Promise<string> {
  if (isDarwin()) {
    return process.env["XDG_RUNTIME_DIR"] ?? "";
  }
  // Linux: derive from UID
  try {
    const result = await conn.exec("id -u");
    const uid = parseInt(result.stdout.trim(), 10);
    if (!isNaN(uid) && uid > 0) return `/run/user/${uid}`;
  } catch {
    // fall through
  }
  return "/run/user/1000";
}
