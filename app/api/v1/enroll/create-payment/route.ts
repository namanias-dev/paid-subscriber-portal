import { NextResponse } from "next/server";
import {
  getCourseBySlug,
  createPayment,
  getPaymentByReference,
  addCourseEnrollment,
  updateCourseEnrollment,
  cancelStalePendingPayments,
  findResumableCourseEnrollment,
  isCourseFullyPaidForPhone,
  findRecentOpenCoursePayment,
  getCourseEnrollmentsByPhone,
  incrementCouponUsage,
} from "@/lib/dataProvider";
import {
  isEazypayConfigured,
  buildPaymentUrl,
  makeReferenceNo,
  eazypaySubMerchantId,
  PAYMENT_GATEWAY,
} from "@/lib/eazypay";
import { planCourseEnrollment, deriveEnrollment } from "@/lib/installments";
import { scheduleAsCheckoutIntent } from "@/lib/enrollmentScope";
import { validateCoupon, couponDiscountReason, parseCouponCodeFromReason } from "@/lib/coupons";
import type { CourseEnrollment } from "@/lib/types";

export const dynamic = "force-dynamic";

async function uniqueReference(code: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = makeReferenceNo(code);
    const existing = await getPaymentByReference(ref);
    if (!existing) return ref;
  }
  return makeReferenceNo(code);
}

/** Soft one-use: reject if this phone already paid on this course with the same coupon. */
async function phoneAlreadyUsedCoupon(phone: string, courseId: string, code: string): Promise<boolean> {
  const list = await getCourseEnrollmentsByPhone(phone);
  const want = code.trim().toLowerCase();
  return list.some((e) => {
    if (e.course_id !== courseId || e.status === "cancelled") return false;
    if ((e.amount_paid || 0) <= 0) return false;
    const applied = parseCouponCodeFromReason(e.discount_reason);
    return !!applied && applied.toLowerCase() === want;
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const mobile = String(body.mobile || body.phone || "").replace(/\D/g, "");
    const slug = String(body.courseSlug || body.slug || "");
    const plan = String(body.plan || body.mode || "full") as "full" | "emi";
    const bookSeat = body.bookSeat === true || body.bookSeat === "true";
    const couponCode = String(body.couponCode || body.coupon || "").trim();
    // Phase 3: optional chosen batch. Pricing is recomputed server-side from the
    // batch (planCourseEnrollment) — a client price is never accepted. An unknown
    // id falls back to the course-level default inside planCourseEnrollment.
    const batchId = body.batchId != null && String(body.batchId).trim() !== "" ? String(body.batchId) : null;

    if (!name) return NextResponse.json({ ok: false, error: "Please enter your full name." }, { status: 400 });
    if (mobile.length !== 10) return NextResponse.json({ ok: false, error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address, or leave it blank." }, { status: 400 });
    }
    const gatewayEmail = email || `${mobile}@guest.namanias.com`;

    const course = await getCourseBySlug(slug);
    if (!course) return NextResponse.json({ ok: false, error: "Course not found." }, { status: 404 });
    if (course.status !== "published" || course.active === false) {
      return NextResponse.json({ ok: false, error: "This course is not open for enrollment." }, { status: 400 });
    }

    const planInput = {
      course,
      plan,
      bookSeat,
      seatAmount: body.seatAmount != null ? Number(body.seatAmount) : null,
      installmentCount: body.installmentCount != null ? Number(body.installmentCount) : null,
      batchId,
    };

    // Plan once without discount to get the authoritative base total, then
    // re-validate the coupon against that total (never trust client discount).
    const basePlanned = planCourseEnrollment(planInput);
    if (!basePlanned.ok) return NextResponse.json({ ok: false, error: basePlanned.error }, { status: 400 });

    let discountRupees = 0;
    let appliedCouponCode: string | null = null;
    if (couponCode) {
      const couponResult = validateCoupon(course.coupons, couponCode, basePlanned.plan.totalFee);
      if (!couponResult.ok) {
        return NextResponse.json({ ok: false, error: couponResult.error }, { status: 400 });
      }
      if (await phoneAlreadyUsedCoupon(mobile, course.id, couponResult.coupon.code)) {
        return NextResponse.json({ ok: false, error: "This coupon has already been used." }, { status: 400 });
      }
      discountRupees = couponResult.discount;
      appliedCouponCode = couponResult.coupon.code;
    }

    const planned =
      discountRupees > 0
        ? planCourseEnrollment({ ...planInput, discountRupees })
        : basePlanned;
    if (!planned.ok) return NextResponse.json({ ok: false, error: planned.error }, { status: 400 });

    const {
      schedule,
      totalFee,
      planType,
      installmentCount,
      batchLabel,
      originalTotalFee,
      discountAmount,
    } = planned.plan;
    let { firstAmount, firstKind, firstInstallmentNo } = planned.plan;

    const discountPatch: Partial<CourseEnrollment> =
      discountAmount > 0 && appliedCouponCode
        ? {
            discount_amount: discountAmount,
            original_total_fee: originalTotalFee,
            discount_reason: couponDiscountReason(appliedCouponCode),
            discount_applied_by: "coupon",
            discount_applied_at: new Date().toISOString(),
          }
        : {
            discount_amount: 0,
            original_total_fee: null,
            discount_reason: null,
            discount_applied_by: null,
            discount_applied_at: null,
          };

    // Batch-aware dedup key. Only multi-batch courses scope the dedup by batch, so
    // every single-batch course keeps the exact pre-batch dedup behaviour (null key).
    const multiBatch = (course.batches || []).length >= 2;
    const dedupBatchId = multiBatch ? batchId : null;

    const subMerchantId = eazypaySubMerchantId("course", course.slug);

    // ---- GUARD 1: overpayment / already fully paid ----
    if (await isCourseFullyPaidForPhone(mobile, course.id)) {
      return NextResponse.json(
        { ok: false, alreadyPaid: true, error: "You're already fully enrolled in this course. Log in to your portal to access it." },
        { status: 409 },
      );
    }

    // ---- GUARD 2: idempotency dedupe (double-click / refresh / back-button) ----
    // Only reuse when the open attempt's amount matches this initiation (coupon
    // must not re-apply or hand back a mismatched gateway charge).
    const recent = await findRecentOpenCoursePayment(mobile, course.slug, 120000, dedupBatchId);
    if (recent && recent.reference_no && Math.round(recent.amount) === Math.round(firstAmount)) {
      if (isEazypayConfigured()) {
        const url = buildPaymentUrl({ referenceNo: recent.reference_no, subMerchantId, amount: recent.amount, name, email: gatewayEmail, mobile });
        if (url) return NextResponse.json({ ok: true, referenceNo: recent.reference_no, paymentUrl: url, reused: true });
      } else {
        return NextResponse.json({ ok: true, demo: true, referenceNo: recent.reference_no, paymentUrl: `/payment/status?ref=${encodeURIComponent(recent.reference_no)}&demo=1`, reused: true });
      }
    }

    // ---- GUARD 3: reuse an in-progress enrollment instead of creating a 2nd ----
    const existing = await findResumableCourseEnrollment(mobile, course.id);
    let enrollment: CourseEnrollment;
    let shouldIncrementCoupon = false;
    if (existing && (existing.amount_paid || 0) > 0) {
      // Has real money — RESUME: pay the next outstanding line of the existing plan
      // (never re-plan or re-apply a coupon; discount already baked into total/schedule).
      const next = deriveEnrollment(existing).nextPayable;
      if (!next) {
        return NextResponse.json(
          { ok: false, alreadyPaid: true, error: "This course is already fully paid. Log in to your portal to access it." },
          { status: 409 },
        );
      }
      enrollment = existing;
      firstAmount = next.amount;
      firstKind = next.kind;
      firstInstallmentNo = next.no;
    } else if (existing) {
      await cancelStalePendingPayments(existing.id).catch(() => null);
      const prevCode = parseCouponCodeFromReason(existing.discount_reason);
      shouldIncrementCoupon = !!appliedCouponCode && prevCode?.toLowerCase() !== appliedCouponCode.toLowerCase();
      const intentSchedule = scheduleAsCheckoutIntent(schedule);
      enrollment =
        (await updateCourseEnrollment(existing.id, {
          student_name: name,
          email: email || null,
          batch_label: batchLabel,
          plan_type: planType,
          total_fee: totalFee,
          amount_paid: 0,
          installment_count: installmentCount,
          status: "checkout_intent",
          schedule: intentSchedule,
          ...discountPatch,
        })) || existing;
    } else {
      shouldIncrementCoupon = !!appliedCouponCode;
      enrollment = await addCourseEnrollment({
        phone: mobile,
        student_name: name,
        email: email || null,
        course_id: course.id,
        course_slug: course.slug,
        course_title: course.title,
        batch_label: batchLabel,
        plan_type: planType,
        total_fee: totalFee,
        amount_paid: 0,
        installment_count: installmentCount,
        status: "checkout_intent",
        schedule: scheduleAsCheckoutIntent(schedule),
        ...discountPatch,
      });
    }

    const referenceNo = await uniqueReference("course");

    const itemLabel =
      firstKind === "seat"
        ? `${course.title} — Book Your Seat`
        : firstKind === "installment"
          ? `${course.title} — Installment ${(firstInstallmentNo ?? 1)} of ${installmentCount}`
          : course.title;

    await createPayment({
      student_name: name,
      phone: mobile,
      email: email || null,
      item: itemLabel,
      item_type: "course",
      item_slug: course.slug,
      amount: firstAmount,
      // Checkout opened — a click, not money in flight. The gateway callback
      // promotes this to PAID/FAILED; an abandoned click expires to ABANDONED.
      status: "INITIATED",
      gateway: PAYMENT_GATEWAY,
      reference_no: referenceNo,
      sub_merchant_id: subMerchantId,
      transaction_amount: firstAmount,
      razorpay_payment_id: null,
      mode: null,
      enrollment_id: enrollment.id,
      payment_kind: firstKind,
      installment_no: firstInstallmentNo,
      batch_id: dedupBatchId,
    });

    // Consume usage once per new coupon application (not on resume / amount-matched reuse).
    if (shouldIncrementCoupon && appliedCouponCode) {
      await incrementCouponUsage("course", course.id, appliedCouponCode);
    }

    // Best-effort lead capture (don't block checkout on failure). Forward the
    // visitor's cookies so /api/public/lead can read the nsa_attr attribution
    // cookie (utm/gclid) — this server-to-server call otherwise carries none.
    fetch(new URL("/api/public/lead", req.url).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") || "" },
      body: JSON.stringify({ name, phone: mobile, email, source: "Website", campaign: "Enroll", course_interest: course.title, source_form: "enroll_intent" }),
    }).catch(() => {});

    if (isEazypayConfigured()) {
      const paymentUrl = buildPaymentUrl({ referenceNo, subMerchantId, amount: firstAmount, name, email: gatewayEmail, mobile });
      if (!paymentUrl) return NextResponse.json({ ok: false, error: "Payment gateway unavailable." }, { status: 502 });
      return NextResponse.json({ ok: true, referenceNo, paymentUrl });
    }

    return NextResponse.json({
      ok: true,
      demo: true,
      referenceNo,
      paymentUrl: `/payment/status?ref=${encodeURIComponent(referenceNo)}&demo=1`,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not start enrollment." }, { status: 500 });
  }
}
