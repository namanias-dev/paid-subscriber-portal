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
import {
  resolveEmiConfig,
  effectiveSeatAmount,
  buildSchedule,
  buildFullSchedule,
} from "@/lib/installments";
import { formatISTDate } from "@/lib/dates";
import type { InstallmentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

async function uniqueReference(code: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = makeReferenceNo(code);
    const existing = await getPaymentByReference(ref);
    if (!existing) return ref;
  }
  return makeReferenceNo(code);
}

function buildBatchLabel(batchStart: string | null, timings?: string[] | null): string | null {
  const parts: string[] = [];
  if (batchStart) parts.push(`Starts ${formatISTDate(batchStart)}`);
  if (timings && timings.length) parts.push(timings.join(" · "));
  return parts.length ? parts.join(" · ") : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const mobile = String(body.mobile || body.phone || "").replace(/\D/g, "");
    const slug = String(body.courseSlug || body.slug || "");
    const mode = String(body.mode || "full") as "full" | "emi";

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

    const total = Math.max(0, Math.round(course.price));
    if (total <= 0) {
      return NextResponse.json({ ok: false, error: "This course has no payable fee." }, { status: 400 });
    }

    const cfg = resolveEmiConfig(course);
    const batchLabel = buildBatchLabel(course.batch_start, course.batch_timings);

    let schedule: InstallmentItem[];
    let firstAmount: number;
    let firstKind: "seat" | "full";
    let planType: "full" | "emi";
    let installmentCount = 0;

    if (mode === "emi") {
      if (!cfg.enabled) {
        return NextResponse.json({ ok: false, error: "EMI is not available for this course." }, { status: 400 });
      }
      const count = Math.round(Number(body.installmentCount) || 0);
      if (!cfg.installmentCounts.includes(count)) {
        return NextResponse.json({ ok: false, error: "Invalid installment plan." }, { status: 400 });
      }
      const requestedSeat = body.seatAmount != null ? Math.round(Number(body.seatAmount)) : null;
      const seat = effectiveSeatAmount(cfg, total, requestedSeat);
      if (seat < 1 || seat >= total) {
        return NextResponse.json({ ok: false, error: "Invalid seat amount." }, { status: 400 });
      }
      // Enforce admin minimum when custom seat is offered.
      const floor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
      if (seat < floor) {
        return NextResponse.json({ ok: false, error: "Seat amount is below the minimum." }, { status: 400 });
      }
      schedule = buildSchedule({
        total,
        seatAmount: seat,
        count,
        bookingISO: new Date().toISOString(),
        firstIntervalDays: cfg.firstIntervalDays,
        intervalMonths: cfg.intervalMonths,
      });
      firstAmount = seat;
      firstKind = "seat";
      planType = "emi";
      installmentCount = count;
    } else {
      if (!cfg.allowFull && cfg.enabled) {
        return NextResponse.json({ ok: false, error: "Full payment is not available for this course." }, { status: 400 });
      }
      schedule = buildFullSchedule(total);
      firstAmount = total;
      firstKind = "full";
      planType = "full";
    }

    const enrollment = await addCourseEnrollment({
      phone: mobile,
      student_name: name,
      email: email || null,
      course_id: course.id,
      course_slug: course.slug,
      course_title: course.title,
      batch_label: batchLabel,
      plan_type: planType,
      total_fee: total,
      amount_paid: 0,
      installment_count: installmentCount,
      status: "pending",
      schedule,
    });

    const referenceNo = await uniqueReference("course");
    const subMerchantId = eazypaySubMerchantId("course", course.slug);

    await createPayment({
      student_name: name,
      phone: mobile,
      email: email || null,
      item: planType === "emi" ? `${course.title} — Book Your Seat` : course.title,
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
      installment_no: 0,
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
