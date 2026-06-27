import { NextResponse } from "next/server";
import { findBuyerByLogin, rateLimited, ensureStudentForCustomer, claimGuestAttempts } from "@/lib/dataProvider";
import { signBuyerToken } from "@/lib/auth";
import { BUYER_COOKIE, SESSION_MAX_AGE } from "@/lib/config";
import { normalizeIndianMobile } from "@/lib/phone";
import { normalizeLoginCode } from "@/lib/buyerCode";

export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const n = normalizeIndianMobile(body.phone);
    const code = normalizeLoginCode(body.code);
    if (!n.ok || !n.digits10 || !code) {
      return NextResponse.json({ ok: false, error: "Enter your mobile number and login code." }, { status: 400 });
    }
    const phone = n.digits10;
    const ip = clientIp(req);

    // Convenience-grade rate-limiting (per phone + per IP). Generic message — no account-existence leak.
    if ((await rateLimited(`login:${phone}`, 8, 600)) || (await rateLimited(`login-ip:${ip}`, 40, 600))) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }

    const buyer = await findBuyerByLogin(phone, code);
    if (!buyer) {
      return NextResponse.json(
        { ok: false, error: "We couldn't verify those details. Please double-check your mobile number and login code." },
        { status: 401 }
      );
    }

    // Unify quiz history on login: ensure a canonical student row for this phone,
    // then claim any pre-login GUEST attempts made with this number so the lead's
    // dashboard, resume and retakes all work through the normal user_id path.
    // Skipped for STAFF test accounts (deliberately buyer-only — kept out of
    // real-student analytics). Non-fatal — login never fails on housekeeping.
    if (!buyer.is_staff) {
      try {
        const student = await ensureStudentForCustomer(buyer.phone, buyer.name, buyer.login_code);
        if (student?.id) await claimGuestAttempts(buyer.phone, student.id);
      } catch { /* best-effort */ }
    }

    const token = await signBuyerToken({ buyer_id: buyer.id, phone: buyer.phone, name: buyer.name, sv: buyer.session_version ?? 0 });
    const res = NextResponse.json({ ok: true, name: buyer.name });
    res.cookies.set(BUYER_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Login failed. Please try again." }, { status: 500 });
  }
}
