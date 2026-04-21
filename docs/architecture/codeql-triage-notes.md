# CodeQL Triage Notes — Session 2026-04-21

Reference brief: `ai-docs/tech-debt-codeql-triage.md` (internal, parent repo).
Starting state: 28 alerts open on `main` (v0.80.6).

Alert numbers below reference GitHub Security / Code Scanning IDs.

## Dismissed (12)

| # | Path | Rule | Reason |
|---|------|------|--------|
| 1–8 | `src/runtime/tool/built-in/web-fetch.ts` | `js/incomplete-multi-character-sanitization`, `js/bad-tag-filter` | HTML stripping for LLM consumption; output is never rendered in a browser context, so partial sanitization is acceptable. |
| 10–11 | `src/runtime/channel/telegram/formatter.ts` | `js/incomplete-sanitization` | Output consumed by the Telegram Bot API (not a browser); scoped to Telegram's MarkdownV2 rules. |
| 12 | `src/runtime/session/system-prompt.ts` | `js/incomplete-sanitization` | Escaping inside a system prompt string passed to the LLM; no browser context. |
| 29 | `src/core/auth/providers/password.ts` | `js/biased-cryptographic-random` | Standard OWASP scrypt salt — `crypto.randomBytes(16)` = 128 bits of entropy, canonical pattern. |

## P1 — Audited

### #13 / #18 — `src/server/local.ts:18` — command injection from environment
Code : `execAsync(command, { env: { ...process.env, ...options?.env } })`.
- `command` is a string provided by trusted callers (provisioner, installer, SSH fallback). No HTTP/user input reaches this API.
- An `execFile` path (argv-based) is already provided by `LocalConnection.execFile` for callers that can avoid shell parsing (e.g. `shell.ts` uses `shellEscape` before concatenating).
- Dismissing both alerts. If a future caller exposes `exec` to untrusted input, the fix is to switch that caller to `execFile`.

### #14 — `src/runtime/engine/internal-api.ts:410` — stack-trace exposure
`_json(res, status, data)` serializes plain objects. The only 5xx path (line 283) builds `{ error: msg, code: "INTERNAL_ERROR" }` where `msg = err instanceof Error ? err.message : String(err)` — the Error message, never the stack. Dismissing.

### #15 — `src/commands/auth.ts:84` — clear-text logging of password
Vrai positif intentionnel. This is the initial admin password display at account creation, shown once so the operator can save it. Added a `codeql[js/clear-text-logging]` inline suppression comment documenting the design. Dismissing.

### #17 — `src/runtime/channel/telegram/polling.ts:433` — file access to HTTP
`req.write(body)` uploads a multipart form to the Telegram Bot API. The file path originates from `getFile()` on Telegram's API (trusted source, bot-scoped), and the content is buffered in memory. Dismissing.

### #20 — `src/runtime/tool/built-in/_skill-remote.ts:150` — http-to-file-access
**Fixed.** Added `SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` validation and a containment check ensuring `localDir` stays inside `SKILL_CACHE_DIR`. Alert should auto-close on the next scan.

### #31 — `src/dashboard/routes/instances/agents/skills.ts:376` — http-to-file-access
**Fixed.** Added validation of `file.relativePath` (non-empty, no null byte, not absolute) plus a `path.resolve` containment check against `targetDir`. Alert should auto-close on the next scan.

## P3 — File-system races

- **#22** `src/runtime/session/workspace-cache.ts:82` — **Dismissed** as false positive. Synchronous `statSync + readFileSync` on the same path are not interleavable with a concurrent writer in a single event loop; `stat` is used only to validate the cache mtime, not to gate access. Refactoring to a shared file handle broke test mocks with no real safety gain.
- **#23** `src/runtime/tool/built-in/write.ts:38` — **Fixed.** Replaced `fs.access + writeFile` with a single `writeFile(..., {flag: "wx"})` attempt that falls back to plain overwrite on `EEXIST`. Atomic: no TOCTOU window.
- **#32** `src/dashboard/routes/instances/workspace-download.ts` — **Fixed.** Open once via `fs.open`, then `stat` and `readFile` through the file handle so size and content always reference the same inode.

## P2 — Content-Disposition sanitization (#30)

**Fixed.** Replaced the single-quote escape with RFC 5987/6266 percent-encoding, plus explicit CR/LF/NUL stripping to prevent header injection.

## P4 — Code quality

- **#25** `ui/src/components/flow-sessions.ts:60` — **Fixed.** Removed `iso ?? "--"` redundancy (iso already truthy at that point).
- **#26, #27** `ui/src/components/agent-detail-panel.ts`, **#28** `ui/src/components/instance-shared-files.ts` — **Dismissed.** Lit's `.prop=${null}` syntax passes `null` as a property value, not an attribute string; CodeQL's JS analyzer does not model Lit's dot-prefixed binding semantics.
- **#33** `src/dashboard/routes/instances/runtime-tools.ts:172` — **Fixed.** Removed the dead `= "ok"` initializer; every branch of the if/else-if/else that follows assigns to `status`.

## Policy

See `docs/architecture/codeql-policy.md` (created in this session) for triage guidelines applied to future findings.
