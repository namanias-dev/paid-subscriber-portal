/**
 * AI Counselor Agent — HMAC REQUEST VERIFICATION (portal side). PHASE 5.
 *
 * The optional local worker (agent-worker/) talks to the portal ONLY via
 * HMAC-signed HTTPS requests. This module verifies those signatures server-side
 * before any worker endpoint does anything.
 *
 * Security properties:
 *  - The endpoints are DISABLED (treated as "no secret") whenever
 *    AI_AGENT_HMAC_SECRET is unset — so nothing is exposed by default.
 *  - Constant-time signature comparison (timingSafeEqual).
 *  - Timestamp window: a request whose timestamp is outside ±maxSkew is rejected
 *    (blunts replay + stale-request attacks).
 *  - Nonce replay guard: a best-effort in-memory nonce cache rejects a repeated
 *    (nonce) within the skew window on the same server instance.
 *
 * Canonical signing string (worker MUST match, see agent-worker/src/security/hmac.ts):
 *     `${timestamp}\n${nonce}\n${rawBody}`
 * signed as HMAC-SHA256(secret) and hex-encoded.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const HMAC_HEADERS = {
  timestamp: "x-ai-agent-timestamp",
  nonce: "x-ai-agent-nonce",
  signature: "x-ai-agent-signature",
} as const;

/** Compute the hex HMAC-SHA256 of the canonical string. */
export function signPayload(secret: string, timestamp: string, nonce: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${nonce}\n${rawBody}`)
    .digest("hex");
}

/* --------------------------------------------------------------------------
 * Best-effort in-memory nonce replay cache (per server instance).
 * ------------------------------------------------------------------------ */
const seenNonces = new Map<string, number>();

function rememberNonce(nonce: string, ttlMs: number): boolean {
  const now = Date.now();
  // Opportunistic purge so the map can't grow unbounded.
  if (seenNonces.size > 5000) {
    for (const [k, exp] of seenNonces) if (exp <= now) seenNonces.delete(k);
  }
  const existing = seenNonces.get(nonce);
  if (existing && existing > now) return false; // replay
  seenNonces.set(nonce, now + ttlMs);
  return true;
}

export interface HmacVerifyInput {
  rawBody: string;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  secret: string | undefined;
  maxSkewMs: number;
}

export interface HmacVerifyResult {
  ok: boolean;
  /** Machine-readable failure reason (never surfaced to the client verbatim). */
  reason?: "disabled" | "missing" | "skew" | "replay" | "bad_signature";
}

/**
 * Verify an HMAC-signed worker request. Returns { ok:false, reason:"disabled" }
 * when no secret is configured — callers MUST treat that as "endpoint disabled"
 * (respond 404) so nothing is exposed by default.
 */
export function verifyHmacRequest(input: HmacVerifyInput): HmacVerifyResult {
  if (!input.secret) return { ok: false, reason: "disabled" };
  if (!input.timestamp || !input.nonce || !input.signature) {
    return { ok: false, reason: "missing" };
  }

  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "missing" };
  const skew = Math.abs(Date.now() - ts);
  if (skew > input.maxSkewMs) return { ok: false, reason: "skew" };

  const expected = signPayload(input.secret, input.timestamp, input.nonce, input.rawBody);
  // Constant-time compare; length mismatch fails fast without leaking timing.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Signature valid → guard against replay of this exact nonce.
  if (!rememberNonce(input.nonce, input.maxSkewMs)) {
    return { ok: false, reason: "replay" };
  }
  return { ok: true };
}

/** Test hook: clear the in-memory nonce cache. */
export function _clearNonceCache(): void {
  seenNonces.clear();
}
