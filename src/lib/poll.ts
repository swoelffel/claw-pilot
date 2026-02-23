// src/lib/poll.ts

export interface PollOptions {
  /** Check function — returns true when the condition is met */
  check: () => Promise<boolean>;
  /** Interval between attempts in ms (default: 1000) */
  intervalMs?: number;
  /** Total timeout in ms */
  timeoutMs: number;
  /** Label for error messages */
  label?: string;
}

/**
 * Poll until a condition is true or the timeout is exceeded.
 * Throws an error if the timeout is reached.
 */
export async function pollUntilReady(opts: PollOptions): Promise<void> {
  const { check, intervalMs = 1_000, timeoutMs, label } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // check() may throw if the service is not ready yet — treat as false
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Timeout after ${timeoutMs}ms${label ? ` waiting for ${label}` : ""}`,
  );
}
