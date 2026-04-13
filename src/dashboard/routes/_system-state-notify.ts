// src/dashboard/routes/_system-state-notify.ts
//
// Helper for publishing the SystemStateChanged event on the cp-system bus
// when a ClawPilot platform resource (named key, instance, blueprint) is
// created, updated, or deleted via the dashboard API. The cp-system engine
// subscribes to this event to invalidate cached system prompts that embed
// a live platform state snapshot.
//
// Emission is best-effort: if the cp-system runtime is not running, the bus
// may not exist — we swallow the error silently.

import { getBus } from "../../runtime/bus/index.js";
import { SystemStateChanged } from "../../runtime/bus/events.js";
import { SYSTEM_INSTANCE_SLUG } from "../../core/system-instance.js";
import { logger } from "../../lib/logger.js";

/**
 * Notify the cp-system runtime that a platform resource changed.
 * Safe to call even when cp-system is not running (no-op in that case).
 */
export function notifySystemStateChanged(
  resource: "named-key" | "instance" | "blueprint",
  action: "create" | "update" | "delete",
): void {
  try {
    const bus = getBus(SYSTEM_INSTANCE_SLUG);
    bus.publish(SystemStateChanged, { resource, action });
  } catch (err) {
    // cp-system may not be running — the next startup will rebuild the prompt anyway
    logger.debug("[system-state-notify] publish skipped (bus unavailable)", {
      error: String(err),
    });
  }
}
