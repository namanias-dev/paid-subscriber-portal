import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getBuyerByPhone, ensureLeadBuyer, ensureStudentForCustomer, claimGuestAttempts, addLead,
} from "@/lib/dataProvider";
import { signBuyerToken } from "@/lib/auth";
import { BUYER_COOKIE, SESSION_MAX_AGE } from "@/lib/config";
import { normalizeIndianMobile } from "@/lib/phone";
import { VISITOR_COOKIE, ATTR_COOKIE, parseAttrCookie } from "@/lib/attribution";
import { stampBuyerAttribution, stitchIdentityOnLogin } from "@/lib/analytics/server";

export const dynamic = "force-dynamic";

/**
 * Quiz first-time login / lead capture → a real, logged-in student account.
 *
 * When someone fills the quiz lead form we, in ONE step (reusing the existing
 * login-code + dedup systems — no parallel auth, no duplicate students):
 *   1. create-or-reuse a non-paying LEAD buyer (deduped by phone) + login code,
 *   2. ensure their canonical `students` row (attempt ownership / performance),
 *   3. claim any earlier guest attempts made with this number,
 *   4. LOG THEM IN by setting the buyer session cookie, and
 *   5. capture the CRM lead (first-time only).
 *
 * After this, /api/public/quiz/start sees an authenticated learner and ties the
 * attempt to their student record. Grants ZERO paid access — the central gate
 * still governs entitlements. Returns the login code so the UI can show the
 * prominent "save this code" screen.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const n = normalizeIndianMobile(String(body.mobile || body.phone || ""));
    if (name.length < 2 || !n.ok || !n.digits10) {
      return NextResponse.json(
        { ok: false, error: "Enter your name and a valid 10-digit mobile number." },
        { status: 400 },
      );
    }
    const phone = n.digits10;

    // First-time vs returning (for messaging + to avoid duplicate CRM leads).
    const existing = await getBuyerByPhone(phone);
    const buyer = await ensureLeadBuyer(phone, name);
    if (!buyer) {
      return NextResponse.json({ ok: false, error: "Could not prepare your account. Please try again." }, { status: 500 });
    }

    // Canonical student row + claim earlier guest attempts so every attempt this
    // person ever made flows through the normal user_id path. Best-effort — a
    // housekeeping hiccup must never block the login/quiz.
    try {
      const student = await ensureStudentForCustomer(buyer.phone, buyer.name || name, buyer.login_code);
      if (student?.id) await claimGuestAttempts(buyer.phone, student.id);
    } catch { /* best-effort */ }

    // CRM lead capture (first-time only — returning visitors already exist).
    if (!existing) {
      try {
        await addLead({
          name, phone,
          source: "quiz_public",
          campaign: "quiz",
          course_interest: String(body.interest || body.slug || "Quiz"),
          ...(email ? { email } : {}),
        }, "quiz");
      } catch { /* non-fatal */ }
    }

    // Analytics (best-effort): attribution stamp + identity stitch.
    try {
      const jar = cookies();
      const visitorId = jar.get(VISITOR_COOKIE)?.value || null;
      const attr = parseAttrCookie(jar.get(ATTR_COOKIE)?.value);
      await stampBuyerAttribution(buyer.phone, attr);
      await stitchIdentityOnLogin({ visitorId, buyer: { id: buyer.id, phone: buyer.phone }, matchedVia: "registration" });
    } catch { /* best-effort */ }

    // LOG THEM IN — set the buyer session cookie so the quiz start is authenticated.
    const token = await signBuyerToken({ buyer_id: buyer.id, phone: buyer.phone, name: buyer.name || name, sv: buyer.session_version ?? 0 });
    const res = NextResponse.json({
      ok: true,
      loginCode: buyer.login_code,
      phone,
      name: buyer.name || name,
      isNew: !existing,
    });
    res.cookies.set(BUYER_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
