import { NextResponse } from "next/server";
import { getCourseBySlug, getWebinarBySlugLive } from "@/lib/dataProvider";
import { validateCoupon } from "@/lib/coupons";
import { planCourseEnrollment } from "@/lib/installments";
import type { Course } from "@/lib/types";

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

    const item = itemType === "course" ? await getCourseBySlug(slug) : await getWebinarBySlugLive(slug);
    if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });

    // Course checkout can name the selected plan. The discount is then computed
    // against that plan total — the same base payment creation uses — and the
    // response includes the amount due today. Callers that omit `plan` keep the
    // previous list-price preview.
    const plan: "emi" | "full" | null = body.plan === "emi" || body.plan === "full" ? body.plan : null;
    if (itemType === "course" && plan) {
      const course = item as Course;
      const planInput = {
        course,
        plan,
        bookSeat: body.bookSeat === true || body.bookSeat === "true",
        seatAmount: body.seatAmount != null && body.seatAmount !== "" ? Number(body.seatAmount) : null,
        installmentCount: body.installmentCount != null && body.installmentCount !== "" ? Number(body.installmentCount) : null,
        batchId: body.batchId != null && String(body.batchId).trim() !== "" ? String(body.batchId) : null,
      };
      const basePlanned = planCourseEnrollment(planInput);
      if (!basePlanned.ok) return NextResponse.json({ ok: false, error: basePlanned.error }, { status: 400 });
      const plannedCoupon = validateCoupon(course.coupons, code, basePlanned.plan.totalFee);
      if (!plannedCoupon.ok) return NextResponse.json({ ok: false, error: plannedCoupon.error }, { status: 200 });
      const planned = planCourseEnrollment({ ...planInput, discountRupees: plannedCoupon.discount });
      if (!planned.ok) return NextResponse.json({ ok: false, error: planned.error }, { status: 400 });
      const payableToday = planned.plan.firstAmount;
      return NextResponse.json({
        ok: true,
        code: plannedCoupon.coupon.code,
        discount: planned.plan.discountAmount,
        baseAmount: planned.plan.originalTotalFee,
        finalAmount: planned.plan.totalFee,
        payableToday,
        remaining: Math.max(0, planned.plan.totalFee - payableToday),
      });
    }

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
