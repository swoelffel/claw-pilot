// src/lib/date.ts

/** Format ISO date for SQLite TEXT columns: "YYYY-MM-DD HH:MM:SS" */
export function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
