# Security architecture

> **Audience** : operators deploying ClawPilot, customers evaluating it for
> regulated environments, and contributors touching authentication, secret,
> or signing code paths.
>
> **Scope** : Community Edition (this repo) plus the integration points it
> exposes to the Enterprise Edition (`claw-pilot-enterprise`) and to the
> licensing service (`claw-pilot-licensing`).

This document is intentionally short. Each section points at the file path
where the actual logic lives so you can verify claims directly. When this
document and the code disagree, the code wins — please open a PR to fix
the doc.

---

## Threat model

| Actor | Capability | Goal | Mitigation summary |
|-------|------------|------|--------------------|
| Local user (multi-tenant) | Authenticated CE/EE account | Escape their tenant, read other tenants' data | Per-row `org_id` slot on every user-resource table; capability registry gates Enterprise features |
| LAN attacker | Sniffs unencrypted HTTP between browser and dashboard | Steal session cookie, replay it, impersonate the user | `SameSite=Strict` cookies; session fixation defense rotates IDs after auth (audit 2026-05 F-1); HTTPS at the reverse proxy in production |
| External attacker | Reaches the public IdP only | CSRF on OIDC callback, open-redirect via `redirect_uri`, replay state | PKCE-S256 only; one-shot state with 256-bit entropy; redirect URI exact-match enforced by IdP; `return_to` allowlisted to relative paths |
| Pre-existing local user | Has a local CE account with email = future OIDC email | Hijack the OIDC user once SSO is connected | Resolver keys on `oidc_sub`, never on email; new OIDC user gets a `-2` suffix instead of taking over the local account |

**Out of scope** : compromise of the upstream IdP, supply-chain compromise of
`oauth4webapi` / `jose` / `@fastify/rate-limit`, physical access to the host,
side-channel attacks on the underlying Node `crypto` primitives.

The May 2026 security audit walks each entry above and is archived under
`claw-pilot-enterprise/docs/security/2026-05-sso-audit.md`. The accompanying
pen-test report for the licensing service lives at
`claw-pilot-licensing/docs/security/2026-05-pentest.md`.

---

## Secret handling — discipline R5

Every secret read at runtime goes through `secretProvider.get(name)`.
There is **no other supported pattern**: direct `process.env.*_SECRET`
access, direct `fs.readFileSync` on `*.pem` / `*.key` paths, and ad-hoc
secret manager calls are blocked at the lint stage.

- Provider interface : [`src/core/secrets/index.ts`](../src/core/secrets/index.ts)
- Default env-backed implementation : [`src/core/secrets/providers/env.ts`](../src/core/secrets/providers/env.ts)
- Discipline rule (lint) : [`tools/eslint-plugin-clawpilot-discipline/rules/no-direct-secret-access.js`](../tools/eslint-plugin-clawpilot-discipline/rules/no-direct-secret-access.js)

Adding a new secret consumer :

1. Pick a stable name (`MYSERVICE_API_KEY`, never the value).
2. Read it from `await secretProvider.get("MYSERVICE_API_KEY", { audit: true })`.
3. Document it in your subsystem's README and add an entry to the deployment
   `.env` template if relevant.

Never commit secrets, never log them. The Hono request logger is configured
to redact `Authorization` and `X-API-Key` headers globally.

---

## Webhook signing — canonical HMAC module

All shared-secret HTTP signatures (today: webhook triggers ; soon:
A2A peers, dashboard outbound notifications) use the same wire format and
the same constant-time compare path :

- Module : [`src/core/security/hmac.ts`](../src/core/security/hmac.ts)
- API : `signPayload(secret, payload, algo='sha256') → "<algo>=<hex>"` and
  `verifySignature(secret, payload, header, opts?) → boolean`
- Header convention : `X-ClawPilot-Signature: sha256=<hex>` (compatible with
  GitHub / Stripe / Slack)
- Algorithms : `sha256` (default), `sha384`, `sha512` — opt-in via
  `allowedAlgos`. A header that announces a stronger algorithm than the
  caller opted into is rejected before the digest compare, defeating
  downgrade attempts that flip the prefix without flipping the digest.
- Comparison : SHA digests are decoded to `Buffer` and compared via
  `crypto.timingSafeEqual`. Any malformed input returns `false` rather
  than throwing — callers do not need a try/catch.

The only call site today is the inbound webhook verifier
([`src/runtime/triggers/webhook-verifier.ts`](../src/runtime/triggers/webhook-verifier.ts)),
which is a thin wrapper around `verifySignature`. Future surfaces should
do the same — never reinvent the verifier.

---

## Authentication

### Local password backend

- Storage : `users.password_hash`, scrypt via `crypto.scryptSync`
- Login route : [`src/dashboard/routes/auth.ts`](../src/dashboard/routes/auth.ts)
- Rate-limit on `/api/auth/login` : `loginRateLimiter` (in-memory sliding
  window per IP)
- Session storage : `sessions` table keyed by a nanoid cookie, 24 h sliding
  TTL, `SameSite=Strict` + `HttpOnly`

### OIDC (Enterprise only)

The OIDC routes are mounted by the Enterprise edition on the same Hono app
as the local backend. CE-only deployments do not expose them.

- Routes : `claw-pilot-enterprise/src/enterprise/routes/oidc.ts`
- Flow : Authorization Code with PKCE-S256 (no `plain` fallback)
- State : 256-bit random, persisted with TTL ≤ 10 minutes, atomic
  read-then-delete on callback (one-shot, replay-resistant)
- ID token validation : signature + `iss` + `aud` + `exp` + `nbf` + `iat` +
  `nonce`, JWKS auto-rotated on `kid` miss

The May 2026 audit confirmed the implementation closes the OWASP-style
12-item OIDC checklist. Three findings were patched in the same sprint :
session fixation rotation, complete `/logout` handling, and a JIT race
window. Details : `claw-pilot-enterprise/docs/security/2026-05-sso-audit.md`.

### Logout

The dashboard UI tries the OIDC logout path first
(`GET /api/auth/oidc/me` → `POST /api/auth/oidc/logout` if linked) and
falls back to `POST /api/auth/logout` for password-authenticated or
CE-only users. The OIDC logout :

1. Deletes the local dashboard session (always, regardless of provider
   settings).
2. Returns the IDP `end_session_endpoint` URL when `propagate_logout=1`,
   so the UI can redirect there (RP-Initiated Logout).

**Limitation** : Back-channel logout (RFC OIDC BCL) is *not* supported.
A user closing their browser without clicking "Sign out" leaves the IDP
session valid. Operators that require this guarantee should configure
short IDP session lifetimes.

---

## Licence server contract (Enterprise)

The Enterprise licence server (`claw-pilot-licensing`, separate repo) issues
ed25519-signed JWTs that EE consumes via `verifyLicence` in
`claw-pilot-enterprise/src/enterprise/capabilities/licence-verifier.ts`.

Public claims expected by EE :

| Claim | Source | Notes |
|-------|--------|-------|
| `iss` | always `clawpilot-licensing` | hard-coded in the verifier |
| `sub` | customer id | opaque |
| `aud` | always `claw-pilot-enterprise` | introduced 2026-05; legacy licences without `aud` accepted during a 30-day rotation window |
| `iat` / `exp` | unix seconds | 60 s clock tolerance |
| `licence_id` | UUID | preferred; legacy `jti` is read as a fallback |
| `capabilities` | `string[]` | preferred; legacy `features` is read as a fallback |

The licence server hardens its admin surface with :

- `X-API-Key` constant-time compare via `crypto.timingSafeEqual` over
  SHA-256 digests
- IP allowlist on `/admin/*`
- `@fastify/rate-limit` (60 req/min global, 10 req/min on `/admin/licences`)
- Stable error codes returned as `{ code, message }` (e.g. `LICENCE_REVOKED`,
  `RATE_LIMIT_EXCEEDED`, `AUTH_API_KEY_INVALID`)
- `audit_events` ledger row on every auth failure

A pen-test driver lives at
`claw-pilot-licensing/scripts/pentest-licence.ts` (run via `pnpm tsx`) and
exercises the full set of probes; the most recent report is committed to
`docs/security/2026-05-pentest.md` in that repo.

---

## Reporting a vulnerability

ClawPilot is built and operated by Stephane (Castelis). Single-dev coverage
applies — no 24/7 on-call.

- **Email** : security@castelis.com (preferred)
- **Telegram** : `@swoelffel` (fastest path, business hours CET/CEST)
- **GitHub** : private security advisory on the affected repo

Please give the operator at least 7 days to reproduce and fix before
disclosure. Critical vulnerabilities (CVSS ≥ 9.0) targeting reachable
production deployments will be acknowledged within 24 hours.

---

## Change log of this document

- **2026-05-04** — initial version after the May 2026 security sprint
  (audit C1, R5 ESLint extension, HMAC canonical module, licence server
  hardening, OIDC logout follow-up).
