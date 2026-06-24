import { NextResponse } from "next/server";
import { findStudentByLogin, findStudentByPhone, findBuyerByLogin, touchStreakOnLogin, logAccess, rateLimited } from "@/lib/dataProvider";
import { signStudentToken, signBuyerToken } from "@/lib/auth";
import { STUDENT_COOKIE, BUYER_COOKIE, SESSION_MAX_AGE } from "@/lib/config";
import { isExpired, formatDate } from "@/lib/dates";
import { normalizeIndianMobile } from "@/lib/phone";
import { normalizeLoginCode } from "@/lib/buyerCode";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Unified login. The portal has two kinds of accounts that share one form:
 *  1. Buyers   — phone + post-payment login code (buyers table) -> /portal
 *  2. Students — phone + subscription access code (students table) -> /dashboard
 *
 * We check buyers first (that's the code shown on the receipt + admin Payments),
 * then fall back to the existing student check, so BOTH keep working.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawPhone = String(body.phone || "").trim();
    if (!rawPhone || !String(body.code || "").trim()) {
      return NextResponse.json({ ok: false, error: "Please enter both your phone number and login code." }, { status: 400 });
    }

    const n = normalizeIndianMobile(rawPhone);
    const phoneDigits = n.ok && n.digits10 ? n.digits10 : rawPhone.replace(/\D/g, "");
    const codeAlnum = normalizeLoginCode(body.code); // buyer codes: A-Z0-9, no separators
    const codeRaw = String(body.code || "").trim().toUpperCase(); // student codes keep dashes (NS-XXXX-XXXX)

    // Light, durable rate-limiting per phone + IP (no-op in demo mode).
    if ((await rateLimited(`login:${phoneDigits}`, 12, 600)) || (await rateLimited(`login-ip:${clientIp(req)}`, 50, 600))) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }

    // 1) Buyer (post-payment) login — the code shown on the receipt / admin Payments.
    const buyer = codeAlnum ? await findBuyerByLogin(phoneDigits, codeAlnum) : null;
    if (buyer) {
      const token = await signBuyerToken({ buyer_id: buyer.id, phone: buyer.phone, name: buyer.name });
      const res = NextResponse.json({ ok: true, kind: "buyer", redirect: "/portal" });
      res.cookies.set(BUYER_COOKIE, token, COOKIE_OPTS);
      return res;
    }

    // 2) Student (subscription) login — existing behaviour, unchanged.
    const student = (await findStudentByLogin(rawPhone, codeRaw)) || (await findStudentByLogin(phoneDigits, codeRaw));
    if (!student) {
      // Distinguish a REVOKED account (correct code, but access paused) so we can
      // show a clear, trustworthy message instead of a generic failure.
      const byPhone = (await findStudentByPhone(phoneDigits)) || (await findStudentByPhone(rawPhone));
      if (byPhone && byPhone.access_code.toUpperCase() === codeRaw && byPhone.is_active === false) {
        return NextResponse.json(
          { ok: false, revoked: true, error: "Your access has been paused. Please contact us to restore it." },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "We couldn't verify those details. Please check your mobile number and login code." },
        { status: 401 }
      );
    }

    // A course/webinar customer (no LMS subscription) is a first-class student in the
    // admin list, but the /dashboard (LMS content) is not theirs — their purchases live
    // in the portal (reached via their buyer login, which is checked above). Guard here
    // so a customer access code can never unlock subscription content.
    if (!student.plan) {
      return NextResponse.json(
        { ok: false, error: "This login code is for your course purchases — please use it to open your portal." },
        { status: 403 }
      );
    }

    if (isExpired(student.expiry_date)) {
      return NextResponse.json(
        {
          ok: false,
          expired: true,
          expiry_date: student.expiry_date,
          error: `Access expired on ${formatDate(student.expiry_date)} — renew here.`,
        },
        { status: 403 }
      );
    }

    const updated = await touchStreakOnLogin(student);
    await logAccess(student.id, "login");

    const plan = updated.plan ?? student.plan; // guaranteed non-null by the guard above
    const token = await signStudentToken({
      student_id: updated.id,
      name: updated.name,
      plan,
      expiry_date: updated.expiry_date,
    });

    const res = NextResponse.json({
      ok: true,
      kind: "student",
      redirect: "/dashboard",
      student: { id: updated.id, name: updated.name, plan },
    });
    res.cookies.set(STUDENT_COOKIE, token, COOKIE_OPTS);
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
