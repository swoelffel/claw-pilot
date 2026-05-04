// src/core/security/hmac.ts
//
// Canonical HMAC signing + verification helpers for ClawPilot's
// webhook-style integrations (TRIGGER-001 inbound webhooks today, and
// any future surface that needs a shared-secret signature: A2A peers,
// Telegram bot bridges, dashboard outbound notifications, …).
//
// One implementation, one algorithm allowlist, one constant-time
// compare path. Adding a second consumer should never mean reinventing
// the wire format or the timing-safe equality dance.
//
// Wire format (matches GitHub / Stripe / Slack convention):
//
//     X-ClawPilot-Signature: <algo>=<hex>
//
// where `<algo>` is one of the entries in `HMAC_ALGOS` and `<hex>` is
// the lowercase hexadecimal HMAC digest of the raw request body.

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../../lib/logger.js";

/** Algorithms callers are allowed to opt into. */
export const HMAC_ALGOS = ["sha256", "sha384", "sha512"] as const;
export type HmacAlgo = (typeof HMAC_ALGOS)[number];

/** Default (and only currently used) algorithm. */
export const DEFAULT_HMAC_ALGO: HmacAlgo = "sha256";

export interface VerifySignatureOptions {
  /**
   * Algorithms accepted by this verification call. Defaults to
   * `["sha256"]` — callers must opt into stronger algorithms
   * explicitly so a downgrade in the header alone cannot succeed.
   */
  allowedAlgos?: readonly HmacAlgo[];
}

/**
 * Sign a payload with HMAC and return a wire-ready header value of
 * the form `<algo>=<hex>`. Pure function, never throws on valid input.
 */
export function signPayload(
  secret: string,
  payload: string | Buffer,
  algo: HmacAlgo = DEFAULT_HMAC_ALGO,
): string {
  if (!HMAC_ALGOS.includes(algo)) {
    throw new Error(`Unsupported HMAC algorithm: ${algo}`);
  }
  const mac = createHmac(algo, secret);
  if (typeof payload === "string") {
    mac.update(payload, "utf8");
  } else {
    mac.update(payload);
  }
  return `${algo}=${mac.digest("hex")}`;
}

/**
 * Verify an `<algo>=<hex>` header against the payload using a
 * constant-time comparison. Returns `false` (never throws) for
 * malformed headers, empty inputs, length mismatches, or any other
 * unexpected condition — callers do not wrap this in try/catch.
 *
 * The header `<algo>` must appear in `opts.allowedAlgos` (default:
 * `["sha256"]`). A header that announces a stronger algorithm than
 * the caller opted into is rejected, defeating downgrade attempts
 * that flip the prefix without flipping the digest.
 */
export function verifySignature(
  secret: string,
  payload: string | Buffer,
  header: string,
  opts: VerifySignatureOptions = {},
): boolean {
  if (!secret || !header) return false;

  const eq = header.indexOf("=");
  if (eq <= 0) return false;
  const algoRaw = header.slice(0, eq).toLowerCase();
  if (!isHmacAlgo(algoRaw)) return false;

  const allowed = opts.allowedAlgos ?? [DEFAULT_HMAC_ALGO];
  if (!allowed.includes(algoRaw)) return false;

  const provided = header
    .slice(eq + 1)
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]+$/.test(provided)) return false;

  const mac = createHmac(algoRaw, secret);
  if (typeof payload === "string") {
    mac.update(payload, "utf8");
  } else {
    mac.update(payload);
  }
  const expected = mac.digest("hex");
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch (err) {
    logger.debug("hmac_compare_failed", { error: String(err) });
    return false;
  }
}

function isHmacAlgo(value: string): value is HmacAlgo {
  return (HMAC_ALGOS as readonly string[]).includes(value);
}
