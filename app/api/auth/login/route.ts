import { NextResponse } from "next/server";
import { findStudentByLogin, findBuyerByLogin, touchStreakOnLogin, logAccess, rateLimited } from "@/lib/dataProvider";
import { signStudentToken, signBuyerToken } from "@/lib/auth";
import { STUDENT_COOKIE, BUYER_COOKIE } from "@/lib/config";
import { isExpired, formatDate } from "@/lib/dates";
import { normalizeIndianMobile } from "@/lib/phone";
import { normalizeLoginCode } from "@/lib/buyerCode";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
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
      return NextResponse.json(
        { ok: false, error: "We couldn't verify those details. Please check your mobile number and login code." },
        { status: 401 }
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

    const token = await signStudentToken({
      student_id: updated.id,
      name: updated.name,
      plan: updated.plan,
      expiry_date: updated.expiry_date,
    });

    const res = NextResponse.json({
      ok: true,
      kind: "student",
      redirect: "/dashboard",
      student: { id: updated.id, name: updated.name, plan: updated.plan },
    });
    res.cookies.set(STUDENT_COOKIE, token, COOKIE_OPTS);
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
