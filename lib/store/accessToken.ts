/**
 * Order-page access tokens for the Notes Store.
 *
 * The raw token is a capability (URL query or httpOnly cookie). Only a SHA-256
 * hash is persisted on store_orders.tracking_token_hash. The plaintext must
 * never be logged, written to analytics, or stored in the database.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie that carries the raw capability for the paying browser after checkout. */
export const STORE_ORDER_ACCESS_COOKIE = "nsa_store_order_access";

/** 24 bytes → 192 bits of entropy (base64url). */
export const STORE_ACCESS_TOKEN_BYTES = 24;

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days — covers dispatch window

function pepper(): string {
  // Dedicated pepper only. Do not fall back to JWT_SECRET: rotating session
  // keys must not invalidate existing Notes Store order links. The historical
  // default matches every order hashed before a dedicated pepper was set.
  return (process.env.STORE_ACCESS_TOKEN_PEPPER || "").trim() || "nsa-store-access-v1";
}

/** Cryptographically secure opaque token (≥128 bits). */
export function mintStoreAccessToken(): string {
  return randomBytes(STORE_ACCESS_TOKEN_BYTES).toString("base64url");
}

/** One-way hash for durable storage. Never reverse. */
export function hashStoreAccessToken(raw: string): string {
  const token = (raw || "").trim();
  return createHash("sha256").update(`${pepper()}:${token}`, "utf8").digest("hex");
}

/** Constant-time compare of two hex digests (or equal-length utf8 strings). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function verifyRawTokenAgainstHash(raw: string, storedHash: string | null | undefined): boolean {
  if (!raw || !storedHash) return false;
  return timingSafeEqualHex(hashStoreAccessToken(raw), storedHash);
}

/** Cookie value: `<orderNo>.<rawToken>` — orderNo is uppercase NIAS-N-…. */
export function encodeOrderAccessCookie(orderNo: string, rawToken: string): string {
  return `${orderNo.trim().toUpperCase()}.${rawToken.trim()}`;
}

export function parseOrderAccessCookie(
  value: string | undefined | null,
  expectedOrderNo?: string,
): { orderNo: string; token: string } | null {
  const v = (value || "").trim();
  if (!v) return null;
  const dot = v.indexOf(".");
  if (dot <= 0 || dot === v.length - 1) return null;
  const orderNo = v.slice(0, dot).toUpperCase();
  const token = v.slice(dot + 1);
  if (!orderNo.startsWith("NIAS-N-") || token.length < 20) return null;
  if (expectedOrderNo && orderNo !== expectedOrderNo.trim().toUpperCase()) return null;
  return { orderNo, token };
}

/**
 * Cookie that lets the paying browser reopen the order after ICICI.
 * On namanias.com it must be SameSite=None and parent-domain scoped: the
 * return is a cross-site POST, and UPI often takes longer than Chrome's
 * two-minute Lax exemption. Local and preview hosts stay Lax.
 */
export function storeOrderAccessCookieOptions(host?: string | null) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  const bare = (host || "").split(":")[0].toLowerCase();
  const onAcademy = bare === "namanias.com" || bare.endsWith(".namanias.com");
  return {
    httpOnly: true,
    secure,
    sameSite: (secure && onAcademy ? "none" : "lax") as "none" | "lax",
    ...(onAcademy ? { domain: ".namanias.com" } : {}),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  };
}

/** Redact anything that looks like an access token from log/analytics payloads. */
export function redactAccessSecrets<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return value
      .replace(/([?&]t=)[^&]+/gi, "$1[redacted]")
      .replace(/(access_token["']?\s*[:=]\s*["']?)[^"'&\s]+/gi, "$1[redacted]") as T;
  }
  if (Array.isArray(value)) return value.map((x) => redactAccessSecrets(x)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(t|access_token|tracking_token|token)$/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactAccessSecrets(v);
      }
    }
    return out as T;
  }
  return value;
}
