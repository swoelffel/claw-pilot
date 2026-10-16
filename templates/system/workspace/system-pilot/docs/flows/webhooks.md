<!-- cspell:ignore HMAC Hmac -->

# Incoming Webhooks, Secrets and Revocation

Reviewed against Community 0.84.13. A service sends an authenticated JSON HTTP call to start a flow:

POST /webhooks/triggers/:instanceSlug/:webhookSlug

The creator supplies a masked initial secret (16–256 characters, no control characters or surrounding whitespace). Metadata creation does not reveal stored values. Exchange the secret with the sender through an approved secure channel, not an agent conversation, log or published example.

## New webhooks: HMAC v2

Send a UTF-8 JSON body of at most 64 KiB with these headers:

| Header | Value |
|---|---|
| X-ClawPilot-Timestamp | Unix seconds, within five minutes of server time |
| Idempotency-Key | 1–128 visible ASCII characters identifying this event |
| X-ClawPilot-Signature | v2= followed by the hex HMAC-SHA256 |

The signed bytes are `<timestamp>.<event-key>.<exact transmitted body>`. Do not serialize JSON again after signing. Keep the same event key and body for a delivery retry, with a fresh timestamp and signature. Existing v1 webhooks retain body-only signing; use the version-aware example in their detail drawer rather than silently switching protocols.

Example signing calculation in Node.js (the environment is populated securely; this prints only the signature):

```javascript
import { createHmac } from "node:crypto";
const body = JSON.stringify({ ticket: "EXAMPLE-42" });
const timestamp = String(Math.floor(Date.now() / 1000));
const eventKey = "example-event-42";
const signature = createHmac("sha256", process.env.WEBHOOK_SECRET)
  .update(`${timestamp}.${eventKey}.${body}`, "utf8").digest("hex");
console.log(`v2=${signature}`);
```

Transmit that exact body and the matching timestamp/eventKey headers. The UI provides a complete version-aware Bash/Node.js request example; do not embed or print a stored secret in it.

## Interpret the response

| HTTP status | Meaning |
|---|---|
| 202 | Admitted; inspect the linked flow run for completion |
| 200 | Valid duplicate event within 24 hours; original admission returned, no new execution |
| 401 | Invalid signature or stale timestamp |
| 403 | Revoked secret, disallowed IP or ineligible unattended workflow |
| 409 | Same event key with conflicting body, or a concurrency conflict |
| 413 / 429 | Oversized request / rate limit |
| 503 | Disabled webhook |

Legacy requests without an event key deduplicate identical bodies over five minutes. ClawPilot does not retry the sender's HTTP delivery automatically. Treat duplicate delivery, uncertain execution and a failed business task separately.

## Secret administration

Creation and ordinary trigger management do not grant reveal, rotation or revocation. The detail API returns allowed secret actions; dedicated permissions are enforced by the backend.

- **Reveal:** authorized administrators can read the current non-revoked value. Responses are no-store, access is audited/rate-limited, and the operation is repeatable rather than a one-shot guarantee.
- **Rotate:** generate a fresh secret/reference and clear revocation. Update the sender securely; the old secret stops authenticating new calls.
- **Revoke:** persistently block new external admission immediately. Switching enabled off/on does not remove revocation. Rotation is required to restore access.

Already-admitted runs continue after revocation. Do not expose plaintext in reports or audit data. Revocation confirmation should identify the trigger and observed state only. Workflow/trigger management rights and secret rights are separate.

## Payload and network restrictions

JSONPath mapping exposes selected data as {{trigger.mapped.variable}}; raw fields are available through {{trigger.payload.field}}. Treat external data as untrusted input and constrain the flow's tools and side effects accordingly.

Optional IP restrictions supplement HMAC. Forwarded IP headers are ignored unless trusted proxy addresses are explicitly configured by the administrator. Proxy configuration alone does not establish a network boundary. Do not disable restrictions or broaden permissions to make a failed call pass.
