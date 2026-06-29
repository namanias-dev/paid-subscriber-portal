import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBuyerSession, getStudentSession, getAdminSession } from "@/lib/session";
import { BUYER_COOKIE, STUDENT_COOKIE, ADMIN_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Client session self-heal probe.
 *   authenticated → at least one VALID session (buyer / student / admin).
 *   stale         → a session cookie is present but NONE of them are valid
 *                   (logged out elsewhere, bumped session_version, legacy/expired
 *                   cookie). Only then should the client clear cookies + re-route.
 *
 * Deliberately conservative: if ANY session is valid we report stale:false, so a
 * legitimately logged-in user is NEVER told to clear (no force-logout on deploy).
 */
export async function GET() {
  const jar = cookies();
  const hasCookie =
    !!jar.get(BUYER_COOKIE)?.value || !!jar.get(STUDENT_COOKIE)?.value || !!jar.get(ADMIN_COOKIE)?.value;

  const [buyer, student, admin] = await Promise.all([
    getBuyerSession(),
    getStudentSession(),
    getAdminSession(),
  ]);
  const authenticated = !!(buyer || student || admin);

  return NextResponse.json(
    { authenticated, stale: !authenticated && hasCookie },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
  );
}
