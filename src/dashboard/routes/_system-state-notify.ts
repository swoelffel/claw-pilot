// src/dashboard/routes/_system-state-notify.ts
//
// Relay the SystemStateChanged event to the cp-system runtime daemon
// when a ClawPilot platform resource (named key, instance, blueprint) is
// created, updated, or deleted via the dashboard API. The cp-system engine
// subscribes to this event to invalidate cached system prompts that embed
// a live platform state snapshot.
//
// Best-effort: if the daemon is not running, the publish silently fails.

import { SYSTEM_INSTANCE_SLUG } from "../../core/system-instance.js";
import { publishRuntimeEvent } from "./_internal-api-client.js";

/**
 * Notify the cp-system runtime that a platform resource changed.
 * Safe to call even when cp-system is not running (no-op in that case).
 */
export function notifySystemStateChanged(
  resource: "named-key" | "instance" | "blueprint",
  action: "create" | "update" | "delete",
): void {
  void publishRuntimeEvent(SYSTEM_INSTANCE_SLUG, "system.state.changed", { resource, action });
}
