# Debugging — Diagnostic tooling

Central reference for all opt-in diagnostic tooling shipped with the dashboard UI. Add new entries here when you introduce a new debug facility.

---

## UI: opt-in console logging

`ui/src/services/debug.ts` exports a handful of helpers that each no-op unless their matching `localStorage` flag is set. Zero runtime cost when disabled, so call sites can live anywhere without guard conditions.

### Flags

| Flag | What it logs | Prefix in console |
|---|---|---|
| `cp:debug-sse` | Every SSE bus event received by a chat/pilot component (type, sessionId, role, agentId, messageId, deltaLen) | `[cp:sse]` |
| `cp:debug-chat` | Chat/pilot state transitions (start streaming, idle, ended) | `[cp:chat]` |
| `cp:debug-render` | Invariant guards at render time (e.g. in-flight assistant filter) | `[cp:render]` |
| `cp:debug-api` | Outbound `fetchSessionMessages` load / refresh / reload | `[cp:api]` |
| `cp:debug` | Master flag — enables all categories at once | — |

### Enable / disable

In the browser devtools console:

```javascript
// Enable a single category
localStorage.setItem("cp:debug-sse", "1");

// Enable everything
localStorage.setItem("cp:debug", "1");

// Disable
localStorage.removeItem("cp:debug-sse");
localStorage.removeItem("cp:debug");
```

No reload required — the helpers re-read the flag on every call.

### Filter in devtools

All helpers use `console.debug` with a stable bracketed prefix. Type the prefix in the devtools filter box to isolate one category:

- `[cp:sse]`
- `[cp:chat]`
- `[cp:render]`
- `[cp:api]`

### Call sites

Currently instrumented:

- [`ui/src/components/home-chat.ts`](../ui/src/components/home-chat.ts) — Home screen chat
- [`ui/src/components/runtime-pilot.ts`](../ui/src/components/runtime-pilot.ts) — Full pilot inspector

### Adding new call sites

Import the appropriate helper and call it wherever the diagnostic is useful. Guidelines:

- Keep payloads small and pre-filtered (shallow objects, counts, lengths — not whole state).
- Never log secrets, tokens, or user content verbatim — summarize (length, truncated preview).
- Use a stable human label as the first argument so devtools filtering stays useful.

```typescript
import { debugSse } from "../services/debug.js";

debugSse("home-chat recv", event.type, { sessionId, messageId });
```

### Adding new categories

1. Export a new `debugXxx` helper in `ui/src/services/debug.ts` gated by a `cp:debug-xxx` flag.
2. Document the flag in the table above.
3. Instrument the relevant call sites.

---

## Backend

No backend equivalent yet. When we add one (e.g. verbose runtime logging toggled by env var or DB config), document it here.

---

*See also: [sse-architecture.md](./sse-architecture.md) for the streaming pipeline itself.*
