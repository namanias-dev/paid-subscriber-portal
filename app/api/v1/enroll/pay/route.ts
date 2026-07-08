import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBuyerSession } from "@/lib/session";
import {
  getCourseEnrollmentById,
  createPayment,
  getPaymentByReference,
  findRecentOpenInstallmentPayment,
} from "@/lib/dataProvider";
import { ATTR_COOKIE, parseAttrCookie, flattenForStamp } from "@/lib/attribution";
import { stampBuyerAttribution } from "@/lib/analytics/server";
import {
  isEazypayConfigured,
  buildPaymentUrl,
  makeReferenceNo,
  eazypaySubMerchantId,
  PAYMENT_GATEWAY,
} from "@/lib/eazypay";
import { deriveEnrollment } from "@/lib/installments";

export const dynamic = "force-dynamic";

async function uniqueReference(code: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = makeReferenceNo(code);
    if (!(await getPaymentByReference(ref))) return ref;
  }
  return makeReferenceNo(code);
}

export async function POST(req: Request) {
  try {
    const session = await getBuyerSession();
    if (!session) return NextResponse.json({ ok: false, error: "Please sign in to continue." }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const enrollmentId = String(body.enrollmentId || "");
    const action = String(body.action || "installment") as "installment" | "full";
    const installmentNo = body.installmentNo != null ? Math.round(Number(body.installmentNo)) : null;

    const enrollment = await getCourseEnrollmentById(enrollmentId);
    if (!enrollment) return NextResponse.json({ ok: false, error: "Enrollment not found." }, { status: 404 });
    if (enrollment.phone.trim() !== session.phone.trim()) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    if (enrollment.amount_paid <= 0) {
      return NextResponse.json({ ok: false, error: "Complete your seat booking first." }, { status: 400 });
    }

    const derived = deriveEnrollment(enrollment);
    if (derived.remaining <= 0) {
      return NextResponse.json({ ok: false, error: "This course is already fully paid." }, { status: 400 });
    }

    let amount: number;
    let kind: "installment" | "full";
    let payInstallmentNo = 0;
    let label: string;

    if (action === "full") {
      amount = derived.remaining;
      kind = "full";
      payInstallmentNo = derived.nextPayable?.no ?? 0;
      label = `${enrollment.course_title} — Full Remaining`;
    } else {
      const target = (enrollment.schedule || []).find(
        (s) => s.kind === "installment" && !s.paid && (installmentNo == null || s.no === installmentNo)
      );
      if (!target) return NextResponse.json({ ok: false, error: "No payable installment found." }, { status: 400 });
      amount = target.amount;
      kind = "installment";
      payInstallmentNo = target.no;
      label = `${enrollment.course_title} — ${target.label}`;
    }

    if (amount <= 0) return NextResponse.json({ ok: false, error: "Nothing to pay." }, { status: 400 });

    const subMerchantId = eazypaySubMerchantId("course", enrollment.course_slug);

    // Idempotency dedupe: a double-click on the same installment within 2 min
    // re-uses the existing open attempt instead of creating a second PENDING row
    // (which could otherwise over-apply to the next installment on finalize).
    const recentOpen = await findRecentOpenInstallmentPayment(enrollment.id, payInstallmentNo, 120000);
    if (recentOpen && recentOpen.reference_no && Math.round(recentOpen.amount) === Math.round(amount)) {
      if (isEazypayConfigured()) {
        const url = buildPaymentUrl({ referenceNo: recentOpen.reference_no, subMerchantId, amount, name: enrollment.student_name, email: enrollment.email || `${enrollment.phone}@guest.namanias.com`, mobile: enrollment.phone });
        if (url) return NextResponse.json({ ok: true, referenceNo: recentOpen.reference_no, paymentUrl: url, reused: true });
      } else {
        return NextResponse.json({ ok: true, demo: true, referenceNo: recentOpen.reference_no, paymentUrl: `/payment/status?ref=${encodeURIComponent(recentOpen.reference_no)}&demo=1`, reused: true });
      }
    }

    const referenceNo = await uniqueReference("course");

    // Attribution snapshot from the first-party cookie (best-effort; never blocks)
    // so installment/full-pay checkouts also carry source + campaign (any-touch),
    // matching the new-checkout path in create-payment.
    const attr = parseAttrCookie(cookies().get(ATTR_COOKIE)?.value);
    const attrFlat = flattenForStamp(attr);

    await createPayment({
      student_name: enrollment.student_name,
      phone: enrollment.phone,
      email: enrollment.email,
      item: label,
      item_type: "course",
      item_slug: enrollment.course_slug,
      amount,
      // Checkout opened — a click, not money in flight (see create-payment).
      status: "INITIATED",
      gateway: PAYMENT_GATEWAY,
      reference_no: referenceNo,
      sub_merchant_id: subMerchantId,
      transaction_amount: amount,
      razorpay_payment_id: null,
      mode: null,
      enrollment_id: enrollment.id,
      payment_kind: kind,
      installment_no: payInstallmentNo,
      attribution_source: attrFlat.source,
      attribution_campaign: attrFlat.campaign,
    });
    void stampBuyerAttribution(enrollment.phone, attr).catch(() => {});

    const gatewayEmail = enrollment.email || `${enrollment.phone}@guest.namanias.com`;
    if (isEazypayConfigured()) {
      const paymentUrl = buildPaymentUrl({
        referenceNo,
        subMerchantId,
        amount,
        name: enrollment.student_name,
        email: gatewayEmail,
        mobile: enrollment.phone,
      });
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
    return NextResponse.json({ ok: false, error: "Could not start payment." }, { status: 500 });
  }
}
