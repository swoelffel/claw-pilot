// Verifies that starting a new poll cycle aborts the previous one.
import { describe, it, expect } from "vitest";

// We test the abort logic in isolation via a small helper extracted from
// dashboard-pilot.ts (see createPollController).
import { createPollController } from "../dashboard-pilot.js";

describe("createPollController", () => {
  it("aborts previous controller when called again", () => {
    const [first, abortFirst] = createPollController(null);
    const [second] = createPollController(first);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    void abortFirst; // satisfy linter
    void second;
  });

  it("handles null previous gracefully", () => {
    const [ctrl] = createPollController(null);
    expect(ctrl.signal.aborted).toBe(false);
  });
});
