import { cache } from "react";
import { cookies } from "next/headers";
import { STUDENT_COOKIE, ADMIN_COOKIE, BUYER_COOKIE } from "./config";
import { verifyStudentToken, verifyAdminToken, verifyBuyerToken } from "./auth";
import { getBuyerSessionVersion, getAdminStatus } from "./dataProvider";
import type { SessionPayload, AdminSessionPayload, BuyerSessionPayload } from "./types";

/** Read & verify the student session from the httpOnly cookie (server-side). */
export async function getStudentSession(): Promise<SessionPayload | null> {
  const token = cookies().get(STUDENT_COOKIE)?.value;
  return verifyStudentToken(token);
}

/**
 * Read & verify the buyer (post-payment portal) session from the httpOnly cookie.
 *
 * Beyond the JWT signature/expiry, this ALSO validates the token's session/access
 * version against the buyer's current server-side version. When access changes
 * (lead->paid, admin payment accept, staff access change, login-code regen) we
 * bump that buyer's version, so stale tokens on ANY device fail here and are
 * forced to re-authenticate — that's what refreshes every device, not just one.
 *
 * Fail-open: if the version can't be read (infra hiccup / pre-migration) we trust
 * the signed token, so we never mass-logout users by accident. Per-request cached.
 */
export const getBuyerSession = cache(async (): Promise<BuyerSessionPayload | null> => {
  const token = cookies().get(BUYER_COOKIE)?.value;
  const payload = await verifyBuyerToken(token);
  if (!payload) return null;
  const current = await getBuyerSessionVersion(payload.buyer_id);
  if (current == null) return payload; // unknown → fail-open
  const tokenSv = typeof payload.sv === "number" ? payload.sv : 0;
  return tokenSv === current ? payload : null;
});

/** Read & verify the admin session from the httpOnly cookie (server-side). */
/**
 * Read & verify the admin session. Beyond the signed token, this re-validates the
 * admin's CURRENT status against the DB on each request, so a disabled/deleted
 * admin loses access immediately on ALL devices (not after the 7-day token TTL).
 * Fail-open if status can't be read (infra hiccup never locks out every admin).
 * Per-request cached so the extra read happens at most once per request.
 */
export const getAdminSession = cache(async (): Promise<AdminSessionPayload | null> => {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  const payload = await verifyAdminToken(token);
  if (!payload) return null;
  const status = await getAdminStatus(payload.admin_id);
  if (status === null) return payload; // unknown → fail-open
  return status === "active" ? payload : null;
});
