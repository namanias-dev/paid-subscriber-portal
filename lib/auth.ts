import { SignJWT, jwtVerify } from "jose";
import { JWT_SECRET, ADMIN_JWT_SECRET } from "./config";
import type { SessionPayload, AdminSessionPayload } from "./types";

const enc = (s: string) => new TextEncoder().encode(s);
const SEVEN_DAYS = "7d";

export async function signStudentToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SEVEN_DAYS)
    .sign(enc(JWT_SECRET));
}

export async function verifyStudentToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc(JWT_SECRET));
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function signAdminToken(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SEVEN_DAYS)
    .sign(enc(ADMIN_JWT_SECRET));
}

export async function verifyAdminToken(
  token: string | undefined | null
): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc(ADMIN_JWT_SECRET));
    return payload as unknown as AdminSessionPayload;
  } catch {
    return null;
  }
}
