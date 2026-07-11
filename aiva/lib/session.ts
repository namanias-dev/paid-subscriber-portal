import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { env, hasAuth } from "./env";

export const AIVA_COOKIE = "aiva_session";

export type AivaSession = {
  admin_id: string;
  username: string;
  name?: string;
  role_id?: string;
  is_super: boolean;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function signSession(payload: AivaSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("aiva")
    .setAudience("aiva")
    .setExpirationTime(`${Math.min(Math.max(env.sessionDays, 1), 60)}d`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<AivaSession | null> {
  if (!token || !hasAuth()) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "aiva", audience: "aiva" });
    if (!payload.admin_id || !payload.username) return null;
    return {
      admin_id: String(payload.admin_id),
      username: String(payload.username),
      name: payload.name ? String(payload.name) : undefined,
      role_id: payload.role_id ? String(payload.role_id) : undefined,
      is_super: payload.is_super === true,
    };
  } catch {
    return null;
  }
}

/** Read the current AIVA session from the request cookie (cached per request). */
export const getSession = cache(async (): Promise<AivaSession | null> => {
  const token = cookies().get(AIVA_COOKIE)?.value;
  return verifySession(token);
});

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.min(Math.max(env.sessionDays, 1), 60) * 86400,
  };
}
