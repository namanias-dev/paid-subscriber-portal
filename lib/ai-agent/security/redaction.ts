/**
 * AI Counselor Agent — PII / SECRET REDACTION.
 *
 * Pure, dependency-free utilities that scrub sensitive tokens from any free text
 * or object BEFORE it could be (a) sent to a model, or (b) persisted as a stored
 * summary / event payload. Redaction is defense-in-depth: structured lead fields
 * (phone/email) are stored deliberately in ai_leads, but conversation SUMMARIES
 * and EVENT PAYLOADS must never carry raw PII or credentials.
 *
 * What gets redacted:
 *  - phone numbers (Indian 10-digit, +91, spaced/dashed variants)
 *  - email addresses
 *  - login codes / access codes (e.g. NS-1234-ABCD style) and generic OTPs
 *  - payment / transaction references (txn/order/payment/ref ids)
 *  - signatures / secrets (long hex/base64-ish blobs, "signature"/"secret" values)
 *
 * The goal is to be aggressive on obvious identifiers while keeping the text
 * readable for a human admin reviewing a redacted summary.
 */

export const REDACTED = "[redacted]";

/** Ordered list of patterns. Order matters (emails before phones, etc.). */
const PATTERNS: { name: string; re: RegExp; replace?: string }[] = [
  // Emails first so their digits aren't eaten by the phone rule.
  { name: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, replace: "[email]" },
  // key: value style secrets/signatures/tokens/passwords.
  {
    name: "secret_kv",
    re: /\b(signature|secret|password|passwd|pwd|api[_-]?key|token|auth[_-]?key|access[_-]?token)\b\s*[:=]\s*["']?[^\s"',}]+/gi,
    replace: "$1: [redacted]",
  },
  // Login / access codes like NS-1234-ABCD or ABCD-1234.
  { name: "login_code", re: /\b[A-Z]{2,}-[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+\b/g, replace: "[code]" },
  // Payment / transaction / order references.
  {
    name: "txn_ref",
    re: /\b(txn|transaction|order|payment|pay|ref|utr|invoice)[\s#:_-]*[a-z0-9]{6,}\b/gi,
    replace: "[txn]",
  },
  // Indian phone numbers: optional +91/91/0 prefix, 10 core digits, allowing
  // spaces/dashes. Keep this AFTER email so we don't clobber the domain digits.
  {
    name: "phone",
    re: /(?:(?:\+?91|0)[\s-]?)?\b[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g,
    replace: "[phone]",
  },
  // Long opaque tokens (hex / base64-ish, 24+ chars) — likely signatures/keys.
  { name: "long_token", re: /\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g, replace: "[token]" },
  // Bare OTP-like 4–8 digit sequences that survived above (best-effort).
  { name: "otp", re: /\b\d{4,8}\b/g, replace: "[num]" },
];

/** Redact sensitive tokens from a single string. Safe on null/undefined. */
export function redactText(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  for (const p of PATTERNS) {
    s = s.replace(p.re, p.replace ?? REDACTED);
  }
  return s;
}

/** Keys whose VALUES are always fully dropped regardless of content. */
const SENSITIVE_KEYS = new Set(
  [
    "phone",
    "mobile",
    "email",
    "password",
    "passwd",
    "pwd",
    "login_code",
    "access_code",
    "otp",
    "token",
    "secret",
    "signature",
    "api_key",
    "authorization",
    "auth",
    "card",
    "cvv",
    "upi",
    "txn",
    "transaction_id",
    "order_id",
    "payment_id",
  ].map((k) => k.toLowerCase()),
);

/**
 * Deep-redact an arbitrary value: strings get pattern-scrubbed; objects have
 * sensitive keys fully removed and all other string values scrubbed. Arrays are
 * mapped. Non-string primitives pass through. Cyclic refs are guarded.
 */
export function redactObject<T>(input: T, _seen?: WeakSet<object>): T {
  const seen = _seen || new WeakSet<object>();

  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactText(input) as unknown as T;
  if (typeof input !== "object") return input; // number/boolean/bigint/symbol

  if (seen.has(input as object)) return "[circular]" as unknown as T;
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((v) => redactObject(v, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redactObject(v, seen);
  }
  return out as unknown as T;
}
