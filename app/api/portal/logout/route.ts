import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { BUYER_COOKIE, STUDENT_COOKIE } from "@/lib/config";
import { verifyBuyerToken } from "@/lib/auth";
import { bumpBuyerSessionVersion } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

// Guest-quiz identity cookie (mirrors lib/quizOwner QUIZ_GUEST_COOKIE).
const QUIZ_GUEST_COOKIE = "quiz_guest";
const KILL = { httpOnly: true, path: "/", maxAge: 0 } as const;

/**
 * TRUE logout. Beyond clearing this device's cookies, we BUMP the buyer's
 * session/access version so every OTHER device holding this session is forced to
 * re-authenticate too (no stale "still logged in / still registered" anywhere).
 * Only this user's version moves — other users are untouched. Best-effort: a
 * bump failure never blocks logout.
 */
export async function POST() {
  try {
    const payload = await verifyBuyerToken(cookies().get(BUYER_COOKIE)?.value);
    if (payload?.phone) await bumpBuyerSessionVersion(payload.phone);
  } catch {
    /* ignore */
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(BUYER_COOKIE, "", KILL);
  res.cookies.set(STUDENT_COOKIE, "", KILL); // clear the unified-login sibling too
  res.cookies.set(QUIZ_GUEST_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
