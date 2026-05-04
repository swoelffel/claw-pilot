/**
 * ui/src/components/triggers/__tests__/cp-cron-picker.test.ts
 *
 * Pure-function tests for the cron compilation logic. The Lit element itself
 * is not exercised here (vitest.ui.config.ts uses environment:"node" with no
 * DOM library) — we mock `lit`, `lit/decorators.js`, and `@lit/localize` so
 * the module loads in Node, then call the exported `compileCron()` directly.
 */

import { describe, it, expect, vi } from "vitest";

// --- Mocks -------------------------------------------------------------------

vi.mock("lit", () => {
  class FakeLitElement {
    dispatchEvent(_event: Event): boolean {
      return true;
    }
  }
  return {
    LitElement: FakeLitElement,
    html: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values),
    css: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values),
  };
});

vi.mock("lit/decorators.js", () => ({
  customElement: () => (cls: unknown) => cls,
  property: () => () => {},
  state: () => () => {},
}));

vi.mock("@lit/localize", () => ({
  localized: () => (cls: unknown) => cls,
  msg: (s: string) => s,
}));

vi.mock("../../../styles/tokens.js", () => ({ tokenStyles: "" }));
vi.mock("../../../styles/shared.js", () => ({ buttonStyles: "" }));

// --- Imports under test ------------------------------------------------------

import {
  compileCron,
  defaultIntervalState,
  parseCron,
  type CronIntervalState,
} from "../cp-cron-picker.js";

// --- Tests -------------------------------------------------------------------

function base(overrides: Partial<CronIntervalState>): CronIntervalState {
  return { ...defaultIntervalState(), ...overrides };
}

describe("compileCron — Minute(s)", () => {
  it("compiles every 1 minute", () => {
    const r = compileCron(base({ unit: "minute", every: 1 }));
    expect(r.cron).toBe("*/1 * * * *");
    expect(r.humanReadable).toBe("Runs every minute");
  });

  it("compiles every 5 minutes", () => {
    const r = compileCron(base({ unit: "minute", every: 5 }));
    expect(r.cron).toBe("*/5 * * * *");
    expect(r.humanReadable).toBe("Runs every 5 minutes");
  });

  it("clamps every to 1..99", () => {
    expect(compileCron(base({ unit: "minute", every: 0 })).cron).toBe("*/1 * * * *");
    expect(compileCron(base({ unit: "minute", every: 999 })).cron).toBe("*/99 * * * *");
  });
});

describe("compileCron — Hour(s)", () => {
  it("compiles every 1 hour at :00", () => {
    const r = compileCron(base({ unit: "hour", every: 1, minute: 0 }));
    expect(r.cron).toBe("0 * * * *");
    expect(r.humanReadable).toBe("Runs every hour at minute :00");
  });

  it("compiles every 2 hours at :15", () => {
    const r = compileCron(base({ unit: "hour", every: 2, minute: 15 }));
    expect(r.cron).toBe("15 */2 * * *");
    expect(r.humanReadable).toBe("Runs every 2 hours at minute :15");
  });

  it("clamps minute to 0..59", () => {
    expect(compileCron(base({ unit: "hour", every: 1, minute: 75 })).cron).toBe("59 * * * *");
  });
});

describe("compileCron — Day(s)", () => {
  it("compiles every day at 09:00 (N=1 → no */1)", () => {
    const r = compileCron(base({ unit: "day", every: 1, hour: 9, minute: 0 }));
    expect(r.cron).toBe("0 9 * * *");
    expect(r.humanReadable).toBe("Runs every day at 09:00");
  });

  it("compiles every 3 days at 18:30", () => {
    const r = compileCron(base({ unit: "day", every: 3, hour: 18, minute: 30 }));
    expect(r.cron).toBe("30 18 */3 * *");
    expect(r.humanReadable).toBe("Runs every 3 days at 18:30");
  });
});

describe("compileCron — Week(s)", () => {
  it("compiles single Mon at 09:00", () => {
    const r = compileCron(base({ unit: "week", days: [1], hour: 9, minute: 0 }));
    expect(r.cron).toBe("0 9 * * 1");
    expect(r.humanReadable).toBe("Runs every Monday at 09:00");
  });

  it("compiles Mon+Wed at 09:00", () => {
    const r = compileCron(base({ unit: "week", days: [1, 3], hour: 9, minute: 0 }));
    expect(r.cron).toBe("0 9 * * 1,3");
    expect(r.humanReadable).toBe("Runs every Monday and Wednesday at 09:00");
  });

  it("sorts days ascending in cron CSV", () => {
    const r = compileCron(base({ unit: "week", days: [5, 1, 3], hour: 8, minute: 0 }));
    expect(r.cron).toBe("0 8 * * 1,3,5");
  });

  it("falls back to Mon if no days selected", () => {
    const r = compileCron(base({ unit: "week", days: [], hour: 9, minute: 0 }));
    expect(r.cron).toBe("0 9 * * 1");
  });

  it("ignores 'every' > 1 (week locked to 1)", () => {
    const r = compileCron(base({ unit: "week", every: 4, days: [1], hour: 9, minute: 0 }));
    // No */N in DOW slot — locked to single week period.
    expect(r.cron).toBe("0 9 * * 1");
  });
});

describe("compileCron — Month(s)", () => {
  it("compiles every month on day 1 at 09:00", () => {
    const r = compileCron(base({ unit: "month", every: 1, daysOfMonth: [1], hour: 9, minute: 0 }));
    expect(r.cron).toBe("0 9 1 * *");
    expect(r.humanReadable).toBe("Runs every month on day 1 at 09:00");
  });

  it("compiles every 2 months on days 1,15 at 06:30", () => {
    const r = compileCron(
      base({ unit: "month", every: 2, daysOfMonth: [1, 15], hour: 6, minute: 30 }),
    );
    expect(r.cron).toBe("30 6 1,15 */2 *");
    expect(r.humanReadable).toBe("Runs every 2 months on day 1 and 15 at 06:30");
  });

  it("sorts days of month ascending", () => {
    const r = compileCron(
      base({ unit: "month", every: 1, daysOfMonth: [15, 1, 28], hour: 9, minute: 0 }),
    );
    expect(r.cron).toBe("0 9 1,15,28 * *");
  });

  it("supports day 31 with no special encoding", () => {
    const r = compileCron(base({ unit: "month", every: 1, daysOfMonth: [31], hour: 9, minute: 0 }));
    expect(r.cron).toBe("0 9 31 * *");
  });
});

// ---------------------------------------------------------------------------
// parseCron — round-trip and fallback coverage.
// ---------------------------------------------------------------------------

describe("parseCron — round-trip from compileCron output", () => {
  it("round-trips minute/5", () => {
    const input = base({ unit: "minute", every: 5 });
    const expr = compileCron(input).cron;
    const parsed = parseCron(expr);
    expect(parsed.fallbackMode).toBe("interval");
    expect(parsed.state).not.toBeNull();
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips hour/2 at :15", () => {
    const input = base({ unit: "hour", every: 2, minute: 15 });
    const expr = compileCron(input).cron;
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("hour");
    expect(parsed.state?.every).toBe(2);
    expect(parsed.state?.minute).toBe(15);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips hour/1 at :00 (canonical '0 * * * *')", () => {
    const expr = "0 * * * *";
    const parsed = parseCron(expr);
    expect(parsed.fallbackMode).toBe("interval");
    expect(parsed.state?.unit).toBe("hour");
    expect(parsed.state?.every).toBe(1);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips day/1 at 09:00", () => {
    const expr = "0 9 * * *";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("day");
    expect(parsed.state?.every).toBe(1);
    expect(parsed.state?.hour).toBe(9);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips day/3 at 18:30", () => {
    const expr = "30 18 */3 * *";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("day");
    expect(parsed.state?.every).toBe(3);
    expect(parsed.state?.hour).toBe(18);
    expect(parsed.state?.minute).toBe(30);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips week single Monday", () => {
    const expr = "0 9 * * 1";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("week");
    expect(parsed.state?.days).toEqual([1]);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips multi-day week (Mon+Wed+Fri)", () => {
    const expr = "0 9 * * 1,3,5";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("week");
    expect(parsed.state?.days).toEqual([1, 3, 5]);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("normalizes Sunday-as-0 (cron) to 7 in week", () => {
    const expr = "0 9 * * 0";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("week");
    expect(parsed.state?.days).toEqual([7]);
    // Re-compile uses 7 → "0 9 * * 7"
    expect(compileCron(parsed.state!).cron).toBe("0 9 * * 7");
  });

  it("round-trips month every 1 on day 1 ('0 9 1 * *')", () => {
    const expr = "0 9 1 * *";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("month");
    expect(parsed.state?.every).toBe(1);
    expect(parsed.state?.daysOfMonth).toEqual([1]);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips month multi-day '0 9 1,15 * *'", () => {
    const expr = "0 9 1,15 * *";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("month");
    expect(parsed.state?.daysOfMonth).toEqual([1, 15]);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });

  it("round-trips month/2 multi-day '30 6 1,15 */2 *'", () => {
    const expr = "30 6 1,15 */2 *";
    const parsed = parseCron(expr);
    expect(parsed.state?.unit).toBe("month");
    expect(parsed.state?.every).toBe(2);
    expect(parsed.state?.daysOfMonth).toEqual([1, 15]);
    expect(compileCron(parsed.state!).cron).toBe(expr);
  });
});

describe("parseCron — fallback paths", () => {
  it("falls back on empty input", () => {
    expect(parseCron("").fallbackMode).toBe("expression");
    expect(parseCron("   ").state).toBeNull();
  });

  it("falls back on wrong field count", () => {
    expect(parseCron("0 9 * *").state).toBeNull();
    expect(parseCron("0 9 * * * *").state).toBeNull();
  });

  it("falls back on named months ('JAN')", () => {
    const r = parseCron("0 9 1 JAN *");
    expect(r.state).toBeNull();
    expect(r.fallbackMode).toBe("expression");
  });

  it("falls back on ranges ('1-5')", () => {
    expect(parseCron("0 9 * * 1-5").state).toBeNull();
  });

  it("falls back on '?' chars", () => {
    expect(parseCron("0 9 ? * *").state).toBeNull();
  });

  it("falls back on minute literal lists ('0,30 * * * *')", () => {
    // Compound minute lists are not part of the canonical interval grammar.
    expect(parseCron("0,30 * * * *").state).toBeNull();
  });

  it("falls back on out-of-range DOW (8)", () => {
    expect(parseCron("0 9 * * 8").state).toBeNull();
  });

  it("falls back on out-of-range DOM (32)", () => {
    expect(parseCron("0 9 32 * *").state).toBeNull();
  });

  it("falls back on out-of-range hour (25)", () => {
    expect(parseCron("0 25 * * *").state).toBeNull();
  });

  it("falls back on out-of-range minute (60)", () => {
    expect(parseCron("60 9 * * *").state).toBeNull();
  });
});

describe("defaultIntervalState", () => {
  it("returns sensible defaults", () => {
    const s = defaultIntervalState();
    expect(s.unit).toBe("day");
    expect(s.every).toBe(1);
    expect(s.hour).toBe(9);
    expect(s.minute).toBe(0);
    expect(s.days).toEqual([1]);
    expect(s.daysOfMonth).toEqual([1]);
  });

  it("default state compiles to '0 9 * * *'", () => {
    expect(compileCron(defaultIntervalState()).cron).toBe("0 9 * * *");
  });
});
