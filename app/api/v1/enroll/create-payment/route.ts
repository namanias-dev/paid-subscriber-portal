import { NextResponse } from "next/server";
import {
  getCourseBySlug,
  createPayment,
  getPaymentByReference,
  addCourseEnrollment,
} from "@/lib/dataProvider";
import {
  isEazypayConfigured,
  buildPaymentUrl,
  makeReferenceNo,
  eazypaySubMerchantId,
  PAYMENT_GATEWAY,
} from "@/lib/eazypay";
import { planCourseEnrollment } from "@/lib/installments";

export const dynamic = "force-dynamic";

async function uniqueReference(code: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = makeReferenceNo(code);
    const existing = await getPaymentByReference(ref);
    if (!existing) return ref;
  }
  return makeReferenceNo(code);
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

    const planned = planCourseEnrollment({
      course,
      plan,
      bookSeat,
      seatAmount: body.seatAmount != null ? Number(body.seatAmount) : null,
      installmentCount: body.installmentCount != null ? Number(body.installmentCount) : null,
    });
    if (!planned.ok) return NextResponse.json({ ok: false, error: planned.error }, { status: 400 });
    const { schedule, totalFee, planType, installmentCount, batchLabel, firstAmount, firstKind, firstInstallmentNo } = planned.plan;

    const enrollment = await addCourseEnrollment({
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
      status: "pending",
      schedule,
    });

    const referenceNo = await uniqueReference("course");
    const subMerchantId = eazypaySubMerchantId("course", course.slug);

    const itemLabel =
      firstKind === "seat"
        ? `${course.title} — Book Your Seat`
        : firstKind === "installment"
          ? `${course.title} — Installment 1 of ${installmentCount}`
          : course.title;

    await createPayment({
      student_name: name,
      phone: mobile,
      email: email || null,
      item: itemLabel,
      item_type: "course",
      item_slug: course.slug,
      amount: firstAmount,
      status: "PENDING",
      gateway: PAYMENT_GATEWAY,
      reference_no: referenceNo,
      sub_merchant_id: subMerchantId,
      transaction_amount: firstAmount,
      razorpay_payment_id: null,
      mode: null,
      enrollment_id: enrollment.id,
      payment_kind: firstKind,
      installment_no: firstInstallmentNo,
    });

    // Best-effort lead capture (don't block checkout on failure).
    fetch(new URL("/api/public/lead", req.url).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: mobile, email, source: "Website", campaign: "Enroll", course_interest: course.title }),
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
