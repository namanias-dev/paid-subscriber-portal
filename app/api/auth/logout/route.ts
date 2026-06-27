import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STUDENT_COOKIE, BUYER_COOKIE } from "@/lib/config";
import { verifyBuyerToken } from "@/lib/auth";
import { bumpBuyerSessionVersion } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

const QUIZ_GUEST_COOKIE = "quiz_guest";
const KILL = { httpOnly: true, path: "/", maxAge: 0 } as const;

/**
 * TRUE logout for the unified login (student + buyer share one form). Clears BOTH
 * session cookies + the guest-quiz cookie, and bumps the buyer's session version
 * so the logout propagates across all of that user's devices. Best-effort bump.
 */
export async function POST() {
  try {
    const res = NextResponse.json({ ok: true });
    try {
      const payload = await verifyBuyerToken(cookies().get(BUYER_COOKIE)?.value);
      if (payload?.phone) await bumpBuyerSessionVersion(payload.phone);
    } catch {
      /* ignore */
    }
    res.cookies.set(STUDENT_COOKIE, "", KILL);
    res.cookies.set(BUYER_COOKIE, "", KILL);
    res.cookies.set(QUIZ_GUEST_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
