// ui/src/services/debug.ts
// Opt-in diagnostic logging for the SSE stream. Enable in the browser console
// via `localStorage.setItem('cp:debug-sse', '1')` then reload. Disable with
// `localStorage.removeItem('cp:debug-sse')`.
//
// Kept deliberately tiny so it can be imported everywhere without pulling deps.

const DEBUG_SSE_KEY = "cp:debug-sse";

function isEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_SSE_KEY) === "1";
  } catch {
    // Access to localStorage can throw in some sandboxed contexts — fail closed.
    return false;
  }
}

/** Log SSE diagnostic messages when `cp:debug-sse` is enabled in localStorage. */
export function debugSse(...args: unknown[]): void {
  if (!isEnabled()) return;
  // Using console.debug so it is filterable in devtools.
  // eslint-disable-next-line no-console
  console.debug("[cp:sse]", ...args);
}
