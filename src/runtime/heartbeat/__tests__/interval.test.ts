import { describe, it, expect, vi, afterEach } from "vitest";
import { parseInterval, isWithinActiveHours } from "../interval.js";

describe("parseInterval", () => {
  it('[positive] "30m" → 1_800_000 ms', () => {
    expect(parseInterval("30m")).toBe(1_800_000);
  });

  it('[positive] "1h" → 3_600_000 ms', () => {
    expect(parseInterval("1h")).toBe(3_600_000);
  });

  it('[positive] "5m" → 300_000 ms', () => {
    expect(parseInterval("5m")).toBe(300_000);
  });

  it('[positive] "24h" → 86_400_000 ms', () => {
    expect(parseInterval("24h")).toBe(86_400_000);
  });

  it("[negative] unknown format throws", () => {
    expect(() => parseInterval("2d")).toThrow();
  });

  it("[negative] empty string throws", () => {
    expect(() => parseInterval("")).toThrow();
  });
});

describe("isWithinActiveHours", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[edge] returns true when activeHours is undefined (no restriction)", () => {
    expect(isWithinActiveHours(undefined)).toBe(true);
  });

  it("[positive] returns true when current time is within active window", () => {
    // Fix time to 10:00 UTC (which is 11:00 Europe/Paris in winter, 12:00 in summer)
    // Use UTC+1 (Europe/Paris winter) → set UTC time to 09:00 so Paris = 10:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T09:00:00Z")); // Paris winter = UTC+1 → 10:00
    expect(isWithinActiveHours({ start: "09:00", end: "17:00", tz: "Europe/Paris" })).toBe(true);
  });

  it("[negative] returns false when current time is before start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T07:00:00Z")); // Paris winter = 08:00
    expect(isWithinActiveHours({ start: "09:00", end: "17:00", tz: "Europe/Paris" })).toBe(false);
  });

  it("[negative] returns false when current time is after end", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T17:00:00Z")); // Paris winter = 18:00
    expect(isWithinActiveHours({ start: "09:00", end: "17:00", tz: "Europe/Paris" })).toBe(false);
  });

  it("[edge] handles midnight-crossing window (22:00–06:00)", () => {
    vi.useFakeTimers();
    // 23:00 Paris winter = 22:00 UTC
    vi.setSystemTime(new Date("2024-01-15T22:00:00Z")); // Paris = 23:00
    expect(isWithinActiveHours({ start: "22:00", end: "06:00", tz: "Europe/Paris" })).toBe(true);

    // 12:00 Paris = outside window
    vi.setSystemTime(new Date("2024-01-15T11:00:00Z")); // Paris = 12:00
    expect(isWithinActiveHours({ start: "22:00", end: "06:00", tz: "Europe/Paris" })).toBe(false);
  });
});
