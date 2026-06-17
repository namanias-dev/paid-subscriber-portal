import { cookies } from "next/headers";
import { STUDENT_COOKIE, ADMIN_COOKIE } from "./config";
import { verifyStudentToken, verifyAdminToken } from "./auth";
import type { SessionPayload, AdminSessionPayload } from "./types";

/** Read & verify the student session from the httpOnly cookie (server-side). */
export async function getStudentSession(): Promise<SessionPayload | null> {
  const token = cookies().get(STUDENT_COOKIE)?.value;
  return verifyStudentToken(token);
}

/** Read & verify the admin session from the httpOnly cookie (server-side). */
export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  return verifyAdminToken(token);
}
