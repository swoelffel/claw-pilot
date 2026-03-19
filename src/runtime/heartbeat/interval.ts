/**
 * runtime/heartbeat/interval.ts
 *
 * Utilities for parsing heartbeat intervals and checking active hours.
 */

/** Parse a heartbeat interval string to milliseconds. */
export function parseInterval(every: string): number {
  const match = every.match(/^(\d+)(m|h)$/);
  if (!match) {
    throw new Error(`Invalid heartbeat interval: "${every}". Use "5m", "30m", "1h", "24h", etc.`);
  }
  const n = parseInt(match[1]!, 10);
  const unit = match[2]!;
  return unit === "m" ? n * 60_000 : n * 3_600_000;
}

/** Check if the current time is within the active hours window. */
export function isWithinActiveHours(
  activeHours: { start: string; end: string; tz?: string } | undefined,
): boolean {
  if (!activeHours) return true;

  const now = new Date();
  const tzOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(activeHours.tz ? { timeZone: activeHours.tz } : {}),
  };
  const formatter = new Intl.DateTimeFormat("en-GB", tzOptions);
  const current = formatter.format(now); // "HH:MM"

  const { start, end } = activeHours;

  // Handle midnight-crossing windows (e.g. "22:00" to "06:00")
  if (start <= end) {
    return current >= start && current < end;
  } else {
    // Crosses midnight
    return current >= start || current < end;
  }
}
