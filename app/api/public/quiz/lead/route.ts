import { NextResponse } from "next/server";
import { getBuyerByPhone, ensureLeadBuyer } from "@/lib/dataProvider";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * Quiz lead capture → re-loggable account. When an anonymous quiz-taker fills
 * the lead form we create-or-reuse a non-paying LEAD buyer (deduped by phone)
 * and hand back their login code so the UI can show a prominent "save this code"
 * screen. The lead can later log in (phone + code) to retake quizzes and review
 * results. This grants ZERO paid access — the central gate handles entitlements.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const n = normalizeIndianMobile(String(body.mobile || body.phone || ""));
    if (name.length < 2 || !n.ok || !n.digits10) {
      return NextResponse.json(
        { ok: false, error: "Enter your name and a valid 10-digit mobile number." },
        { status: 400 },
      );
    }
    const phone = n.digits10;

    // Returning vs first-time (for messaging only).
    const existing = await getBuyerByPhone(phone);
    const buyer = await ensureLeadBuyer(phone, name);
    if (!buyer) {
      return NextResponse.json({ ok: false, error: "Could not prepare your account. Please try again." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      loginCode: buyer.login_code,
      phone,
      isNew: !existing,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
