import { SignJWT, jwtVerify } from "jose";
import { SESSION_DAYS } from "./config";
import type { SessionPayload, AdminSessionPayload, BuyerSessionPayload } from "./types";

const enc = (s: string) => new TextEncoder().encode(s);
const TTL = `${SESSION_DAYS}d`;

/** Public demo fallbacks. Safe only when Supabase is not configured. */
const DEMO_JWT_SECRET = "demo-dev-secret-change-me";
const DEMO_ADMIN_JWT_SECRET = "demo-admin-secret-change-me";

function liveMode(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
}

/**
 * Runtime secret. Computed env access so Next does not inline the value into a
 * browser bundle. In live mode the public demo fallback is refused (returns
 * null) so a missing Vercel secret cannot mint forgeable sessions.
 */
function resolveSecret(name: string, demoFallback: string): string | null {
  const value = (process.env[name] || "").trim();
  if (value && value !== demoFallback) return value;
  if (!liveMode()) return demoFallback;
  return null;
}

async function sign(payload: object, secret: string | null): Promise<string> {
  if (!secret) throw new Error("Session secret is not configured");
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(enc(secret));
}

async function verify<T>(token: string | undefined | null, secret: string | null): Promise<T | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, enc(secret));
    return payload as unknown as T;
  } catch {
    return null;
  }
}

export async function signStudentToken(payload: SessionPayload): Promise<string> {
  return sign(payload, resolveSecret("JWT_SECRET", DEMO_JWT_SECRET));
}

export async function verifyStudentToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  return verify<SessionPayload>(token, resolveSecret("JWT_SECRET", DEMO_JWT_SECRET));
}

export async function signBuyerToken(payload: BuyerSessionPayload): Promise<string> {
  return sign(payload, resolveSecret("JWT_SECRET", DEMO_JWT_SECRET));
}

export async function verifyBuyerToken(
  token: string | undefined | null
): Promise<BuyerSessionPayload | null> {
  return verify<BuyerSessionPayload>(token, resolveSecret("JWT_SECRET", DEMO_JWT_SECRET));
}

export async function signAdminToken(payload: AdminSessionPayload): Promise<string> {
  return sign(payload, resolveSecret("ADMIN_JWT_SECRET", DEMO_ADMIN_JWT_SECRET));
}

export async function verifyAdminToken(
  token: string | undefined | null
): Promise<AdminSessionPayload | null> {
  return verify<AdminSessionPayload>(token, resolveSecret("ADMIN_JWT_SECRET", DEMO_ADMIN_JWT_SECRET));
}
