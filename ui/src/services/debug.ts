// ui/src/services/debug.ts
//
// Opt-in diagnostic logging for the dashboard UI. Each category is gated by a
// separate localStorage flag so developers can enable exactly what they need
// without drowning the console.
//
// Enable in the browser console (effective on the next call site evaluation;
// no reload needed):
//
//   localStorage.setItem('cp:debug-sse', '1')     // SSE bus events received
//   localStorage.setItem('cp:debug-chat', '1')    // chat/pilot state transitions
//   localStorage.setItem('cp:debug-render', '1')  // render collisions / guards
//   localStorage.setItem('cp:debug-api', '1')     // outbound API calls
//
// Enable all at once:
//   localStorage.setItem('cp:debug', '1')
//
// Disable: `localStorage.removeItem('cp:debug-<category>')` (or set to '0').
//
// Guidelines for call sites:
// - Keep payloads small and pre-filtered (shallow objects, not whole state).
// - Use a stable tag as the first argument so devtools filtering stays useful.
// - Never log secrets, tokens, or user content verbatim — summarize (length,
//   truncated preview, counts).

const MASTER_KEY = "cp:debug";

function readFlag(key: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(key) === "1" || localStorage.getItem(MASTER_KEY) === "1";
  } catch {
    // Access to localStorage can throw in some sandboxed contexts — fail closed.
    return false;
  }
}

function emit(prefix: string, args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.debug(prefix, ...args);
}

/** Diagnostic log for the SSE event stream (bus events received by the UI). */
export function debugSse(...args: unknown[]): void {
  if (!readFlag("cp:debug-sse")) return;
  emit("[cp:sse]", args);
}

/** Diagnostic log for chat/pilot state transitions (status, streaming vars). */
export function debugChat(...args: unknown[]): void {
  if (!readFlag("cp:debug-chat")) return;
  emit("[cp:chat]", args);
}

/** Diagnostic log for render-time decisions and collision guards. */
export function debugRender(...args: unknown[]): void {
  if (!readFlag("cp:debug-render")) return;
  emit("[cp:render]", args);
}

/** Diagnostic log for outbound API calls from the dashboard UI. */
export function debugApi(...args: unknown[]): void {
  if (!readFlag("cp:debug-api")) return;
  emit("[cp:api]", args);
}
