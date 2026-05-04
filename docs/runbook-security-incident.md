# Runbook — Security incident response

> **Role** : operator on call. Single-dev coverage today (Stephane, Castelis).
> Victor is in onboarding and does not yet take incident calls.
>
> **Scope** : security incidents on a deployed ClawPilot stack (CE on MAC
> integration, EE on MAC integration, licence server on MAC integration,
> production CHRONOS). Outage triage is in `runbook-deploy.md`; this
> document is for events with a confidentiality / integrity / authenticity
> impact.

---

## 0. Triage in 60 seconds

1. **Is something actively bleeding?** Compromised credentials being used,
   unknown licences being issued, OIDC sessions being hijacked, secrets
   leaked publicly.
   - Yes → go to **Section 1** (contain) and skip everything else until
     contained.
   - No → go to **Section 2** (assess).

2. **Document the time you started.** Every step below has a "what to log"
   line. Use ISO 8601 timestamps (UTC) so they line up with `audit_events`
   and Fastify request logs.

---

## 1. Containment

### 1.1 Suspected leaked admin API key (licence server)

```sh
ssh swoelffel@macmini.thiers
# Rotate the env var in the LaunchDaemon plist
sudo plutil -replace EnvironmentVariables.LICENSING_ADMIN_API_KEY \
  -string "$(openssl rand -hex 24)" \
  /Library/LaunchDaemons/io.clawpilot.licensing.plist
cp-lic-restart
# Verify
curl -s http://localhost:19100/health
```

Then update the value in macOS Keychain (`security add-generic-password
-s clawpilot-licensing -a admin-api-key -w …`) and in any operator
tooling that talks to `/admin/*`.

What to log : timestamp, old key fingerprint (last 6 chars), new key
fingerprint, reason. Do NOT log the full keys.

### 1.2 Suspected stolen dashboard session

```sh
# CE
ssh swoelffel@macmini.thiers
sudo -u clawpilot-ce sqlite3 /var/clawpilot-ce/registry.db \
  "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '<victim>');"
# EE — same DB path, different user
sudo -u clawpilot-ee sqlite3 /var/clawpilot-ee/registry.db \
  "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '<victim>');"
```

This invalidates every active session for that user. The next request
from any browser holding the cookie gets a 401 and is bounced to the
login page.

If the victim authenticates via OIDC and you also need to kill the IDP
session, ask the IDP admin (Entra ID console → user → Sign out everywhere)
or have the victim go through `_logout` in the UI — the new audit-2026-05
flow propagates to the IDP.

What to log : timestamp, victim username, who triggered, why.

### 1.3 Suspected compromised licence

```sh
# Find the licence id from the customer
ssh swoelffel@macmini.thiers
sudo -u clawpilot-licence sqlite3 /var/clawpilot-licence/licensing.db \
  "SELECT id FROM licences WHERE customer_id = '<customer>' AND revoked_at IS NULL;"

# Revoke (admin path)
LIC_KEY="$(security find-generic-password -s clawpilot-licensing -a admin-api-key -w)"
curl -s -X POST -H "x-api-key: $LIC_KEY" \
  http://localhost:19100/admin/licences/<id>/revoke
```

EE installations using that licence will start failing validation on
their next call (`LICENCE_REVOKED`). Notify the customer with the
revocation timestamp and the reissue plan.

What to log : licence id, customer, timestamp, reason. The licence
server writes a `licence.revoked` row in `audit_events` automatically.

### 1.4 Suspected leaked HMAC webhook secret

```sh
# Identify the trigger
ssh swoelffel@macmini.thiers
sudo -u clawpilot-ce sqlite3 /var/clawpilot-ce/registry.db \
  "SELECT id, name FROM rt_flow_definitions WHERE trigger_json LIKE '%webhook%';"
```

Then in the dashboard or via the trigger admin endpoint, rotate the
secret used by `verifyHmacSignature`. Communicate the new secret to
the upstream caller out-of-band (Telegram / Signal). Old payloads
signed with the previous secret will fail with the standard `false`
return — no exceptional handling needed.

What to log : trigger id, old secret fingerprint, new fingerprint,
upstream caller notified at HH:MM.

### 1.5 Public secret leak (committed to git)

If a secret landed in a public ClawPilot repository :

1. Rotate it (sections 1.1–1.4).
2. Force-push history rewrite is **NOT** acceptable on `main` /
   `develop` — assume the secret is permanently compromised.
3. Open a private security advisory on the affected GitHub repo with
   the commit SHA and the rotation timestamp.
4. Search GitHub (and `pnpm audit` / `gh secret-scanning alerts list`)
   for any auto-detected leaks of the same value elsewhere.

What to log : commit SHA, file path, secret type, rotation timestamps.

---

## 2. Assessment

Once nothing is actively bleeding, build a timeline.

### 2.1 Pull the relevant audit rows

```sh
# Auth failures on the licence server
sudo -u clawpilot-licence sqlite3 /var/clawpilot-licence/licensing.db \
  "SELECT ts, kind, payload_json FROM audit_events
   WHERE kind LIKE 'auth.%' AND ts > strftime('%s', 'now', '-24 hours') * 1000
   ORDER BY ts;"

# Licence activity
sudo -u clawpilot-licence sqlite3 /var/clawpilot-licence/licensing.db \
  "SELECT ts, kind, licence_id, payload_json FROM audit_events
   WHERE kind LIKE 'licence.%' AND ts > strftime('%s', 'now', '-24 hours') * 1000
   ORDER BY ts;"

# CE / EE login attempts (Hono request logs go to stdout — capture via
# log -f on the LaunchDaemon, or read the rotated archive)
log show --predicate 'subsystem == "io.claw-pilot"' --last 24h \
  | grep -E '"/api/auth/(login|logout|oidc)"'
```

### 2.2 Determine the attacker capability

Use the threat-model table in `docs/security.md` as a checklist :

- Did the attacker need a valid account ? (T1)
- Did they need LAN access ? (T2)
- Did they need a pre-existing local user ? (T3)
- Did they reach only the public IDP ? (T4)

Each row tells you what you can rule out. If the attacker capability
exceeds the threat model — for example, they tampered with the issuer's
ed25519 private key — escalate to "we have a Critical that wasn't in the
model" and treat the rest of this runbook as advisory only.

### 2.3 Classify the severity

Use **CVSS 3.1** to score what the attacker could do given the observed
capability. Critical (≥9) means stop everything else and fix; High
(7.0–8.9) means fix in this sprint with an issue tracker pin; Medium /
Low go to the next sprint backlog.

---

## 3. Recovery

Once the bleed is stopped and you know what happened :

1. **Reset all primary credentials** that may have been exposed (admin
   API keys, dashboard tokens, MASTER_ENCRYPTION_KEY if any encrypted
   row could have been read).
2. **Force a key rotation cycle** on the licence ed25519 keypair if there
   is any chance the private PEM was read. This requires re-issuing every
   active licence and pushing a new EE bundle with the new public-key
   constant — work with the deployment runbook.
3. **Re-run the pen-test driver** :
   ```sh
   cd claw-pilot-licensing
   pnpm tsx scripts/pentest-licence.ts
   ```
   If any probe goes from PASS to FAIL, you have a regression — file it
   as a P0.

4. **Smoke-test the deployment** :
   - `cp-ce-restart && cp-ee-restart && cp-lic-restart`
   - Login on `http://clawpilot.ee.mac` with a known-good account
   - `curl -s -X POST http://localhost:19100/licences/validate -d '{"jwt":"<test>"}'`
   - Run the daily Web Maintenance flow (HOMEBOT) — confirms agent path
     still works end to end.

---

## 4. Post-mortem

Within 72 hours of containment, write a short post-mortem under
`ai-docs/_archives/incident-YYYY-MM-DD.md`. Template :

```md
# Incident YYYY-MM-DD — <one-line title>

## Timeline (UTC)
- HH:MM detection
- HH:MM containment
- HH:MM root cause identified
- HH:MM recovery complete

## Impact
- Confidentiality / Integrity / Availability — what was actually affected
- Number of users / customers / licences

## Root cause
<technical explanation>

## What worked
<≥ 1 bullet>

## What did not work
<≥ 1 bullet>

## Corrective actions
- [ ] action 1 — owner + ETA
- [ ] action 2 — owner + ETA
```

Share it with anyone who participated in the response. Schedule a
calendar reminder for the corrective actions.

---

## 5. Escalation contacts

| Role | Contact | When |
|------|---------|------|
| Product owner | Stephane (Castelis) | Always. `swoelffel@castelis.com` / Telegram `@swoelffel` |
| Customer-facing legal | Castelis legal team | Suspected data breach involving customer data, before any external comms |
| GitHub security | `gh secret-scanning alerts list` + private advisory | Public secret leak |
| IDP admin (Entra ID) | Customer's tenant admin | Forcing OIDC sign-out everywhere |

This list will grow as the team grows. Until then, every escalation
goes through Stephane.
