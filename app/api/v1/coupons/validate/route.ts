import { NextResponse } from "next/server";
import { getCourseBySlug, getWebinarBySlug } from "@/lib/dataProvider";
import { validateCoupon } from "@/lib/coupons";

export const dynamic = "force-dynamic";

/**
 * Validate a coupon for a given course/webinar and return the discounted amount.
 * Read-only — does not consume the coupon (that happens at payment initiation).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const itemType = String(body.itemType || "");
    const slug = String(body.slug || body.courseSlug || body.webinarSlug || "");
    const code = String(body.code || "");

    if (itemType !== "course" && itemType !== "webinar") {
      return NextResponse.json({ ok: false, error: "Coupons apply to courses or webinars only." }, { status: 400 });
    }

    const item = itemType === "course" ? await getCourseBySlug(slug) : await getWebinarBySlug(slug);
    if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });

    const base = Number(item.price) || 0;
    if (base <= 0) return NextResponse.json({ ok: false, error: "This item is free — no coupon needed." }, { status: 400 });

    const result = validateCoupon(item.coupons, code, base);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 200 });

    return NextResponse.json({
      ok: true,
      code: result.coupon.code,
      discount: result.discount,
      baseAmount: base,
      finalAmount: result.finalAmount,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not validate coupon." }, { status: 500 });
  }
}
