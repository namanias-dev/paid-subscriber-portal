import { cookies } from "next/headers";
import { STUDENT_COOKIE, ADMIN_COOKIE, BUYER_COOKIE } from "./config";
import { verifyStudentToken, verifyAdminToken, verifyBuyerToken } from "./auth";
import type { SessionPayload, AdminSessionPayload, BuyerSessionPayload } from "./types";

/** Read & verify the student session from the httpOnly cookie (server-side). */
export async function getStudentSession(): Promise<SessionPayload | null> {
  const token = cookies().get(STUDENT_COOKIE)?.value;
  return verifyStudentToken(token);
}

/** Read & verify the buyer (post-payment portal) session from the httpOnly cookie. */
export async function getBuyerSession(): Promise<BuyerSessionPayload | null> {
  const token = cookies().get(BUYER_COOKIE)?.value;
  return verifyBuyerToken(token);
}

/** Read & verify the admin session from the httpOnly cookie (server-side). */
export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  return verifyAdminToken(token);
}
