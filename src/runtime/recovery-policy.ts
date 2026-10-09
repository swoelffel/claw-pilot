export interface RuntimeTimeoutPolicy {
  providerConnectionMs: number;
  firstTokenMs: number;
  chunkInactivityMs: number;
  toolMs: number;
  agentMs: number;
  reconnectionMs: number;
}
export const DEFAULT_RUNTIME_TIMEOUTS: RuntimeTimeoutPolicy = Object.freeze({
  providerConnectionMs: 30000,
  firstTokenMs: 60000,
  chunkInactivityMs: 120000,
  toolMs: 120000,
  agentMs: 300000,
  reconnectionMs: 30000,
});
export type OperationSafety = "read_only" | "idempotent" | "unsafe";
export const shouldAutomaticallyRetry = (
  s: OperationSafety,
  o: "failed_safely" | "uncertain" | "requires_review",
) => o === "failed_safely" && s !== "unsafe";

export async function withPhaseTimeout<T>(
  phase: keyof RuntimeTimeoutPolicy,
  work: (signal: AbortSignal) => Promise<T>,
  policy: RuntimeTimeoutPolicy = DEFAULT_RUNTIME_TIMEOUTS,
): Promise<T> {
  const timeoutMs = policy[phase];
  try {
    return await work(AbortSignal.timeout(timeoutMs));
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      const code = phase.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
      const timeoutError = new Error(`${phase} timed out after ${timeoutMs}ms`);
      Object.assign(timeoutError, { code: `TIMEOUT_${code}`, phase, timeoutMs });
      throw timeoutError;
    }
    throw error;
  }
}
