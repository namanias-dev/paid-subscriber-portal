import { NextResponse } from "next/server";
import { getPaymentByReference, ensureBuyer, finalizeCoursePaymentByReference } from "@/lib/dataProvider";
import { enrollmentFeeStateFromEnrollment } from "@/lib/enrollmentFeeState";
import { isEazypayConfigured, verifyStatusSignature, itemTypeFromReference } from "@/lib/eazypay";

export const dynamic = "force-dynamic";

const ITEM_LABEL: Record<string, string> = {
  course: "Course payment",
  plan: "Subscription",
  webinar: "Webinar payment",
  item: "Payment",
};

/** For a paid payment, ensure the buyer exists and return their login code. */
async function buyerLogin(phone?: string | null, name?: string | null): Promise<string | null> {
  if (!phone) return null;
  const b = await ensureBuyer(phone, name).catch(() => null);
  return b?.login_code ?? null;
}

/** Confirm a course EMI/seat payment (idempotent) and return success-screen extras. */
async function emiExtras(referenceNo: string) {
  const res = await finalizeCoursePaymentByReference(referenceNo).catch(() => null);
  if (!res) return {};
  const { enrollment, receipt } = res;
  const fee = enrollmentFeeStateFromEnrollment(enrollment);
  return {
    receiptNo: receipt.receipt_no,
    enrollment: {
      id: enrollment.id,
      courseTitle: enrollment.course_title,
      courseSlug: enrollment.course_slug,
      planType: enrollment.plan_type,
      totalFee: enrollment.total_fee,
      amountPaid: fee.netPaid,
      remaining: fee.outstanding,
      status: enrollment.status,
      schedule: enrollment.schedule,
    },
  };
}

export async function GET(req: Request, { params }: { params: { referenceNo: string } }) {
  try {
    const referenceNo = decodeURIComponent(params.referenceNo || "");
    if (!referenceNo) {
      return NextResponse.json({ ok: false, error: "Missing reference." }, { status: 400 });
    }

    const url = new URL(req.url);
    const demo = url.searchParams.get("demo") === "1";
    const signedStatus = url.searchParams.get("st");
    const signedAmount = url.searchParams.get("amt");
    const sig = url.searchParams.get("sig");

    // 1) Signed hint from callback redirect — ADVISORY only.
    //    Never write PAID/FAILED from this. Kick Verify and return current DB state.
    if (signedStatus && verifyStatusSignature(referenceNo, signedStatus, signedAmount ?? "0", sig)) {
      const { applyVerifyForReference } = await import("@/lib/paymentOutcome");
      void applyVerifyForReference(referenceNo).catch(() => {});

      const record = await getPaymentByReference(referenceNo).catch(() => null);
      const status = record?.status || "UNCONFIRMED";
      const paid = status === "PAID" || status === "captured";
      const loginCode = paid ? await buyerLogin(record?.phone, record?.student_name) : null;
      const extras = paid ? await emiExtras(referenceNo) : {};
      return NextResponse.json({
        ok: true,
        referenceNo,
        status,
        item: record?.item || ITEM_LABEL[itemTypeFromReference(referenceNo)],
        itemType: record?.item_type || itemTypeFromReference(referenceNo),
        itemSlug: record?.item_slug ?? null,
        amount: Number(signedAmount ?? record?.amount ?? 0),
        gatewayRef: record?.gateway_ref ?? null,
        loginCode,
        verifiedSignature: true,
        demo: false,
        awaiting: !paid,
        ...extras,
      });
    }

    // 2) Stored record (DB in live mode, or in-memory within the same instance).
    let payment = await getPaymentByReference(referenceNo);

    // 3) DEMO MODE: no AES key => no real gateway => simulate success.
    if (demo && !isEazypayConfigured()) {
      if (!payment) {
        return NextResponse.json({
          ok: true,
          referenceNo,
          status: "PAID",
          item: ITEM_LABEL[itemTypeFromReference(referenceNo)],
          itemType: itemTypeFromReference(referenceNo),
          amount: 0,
          gatewayRef: `DEMO-${referenceNo}`,
          verifiedSignature: false,
          demo: true,
        });
      }
      if (payment.status !== "PAID" && payment.status !== "captured") {
        // Demo only: simulate Verify success (no real ICICI).
        const { applyVerifyForReference } = await import("@/lib/paymentOutcome");
        await applyVerifyForReference(referenceNo, {
          precomputed: {
            reachable: true,
            outcome: "paid",
            settlement: "settled",
            rawStatus: "Success",
            gatewayRef: `DEMO-${referenceNo}`,
            amount: payment.amount,
            httpStatus: 200,
          },
        });
        payment = (await getPaymentByReference(referenceNo)) ?? payment;
      }
      return NextResponse.json({
        ok: true,
        referenceNo,
        status: payment.status,
        item: payment.item,
        itemType: payment.item_type,
        amount: payment.amount,
        gatewayRef: payment.gateway_ref ?? null,
        loginCode: await buyerLogin(payment.phone, payment.student_name),
        verifiedSignature: payment.verified_signature ?? null,
        demo: true,
        ...(await emiExtras(referenceNo)),
      });
    }

    if (payment) {
      const paid = payment.status === "PAID" || payment.status === "captured";
      const extras = paid ? await emiExtras(referenceNo) : {};
      return NextResponse.json({
        ok: true,
        referenceNo,
        status: payment.status,
        item: payment.item,
        itemType: payment.item_type,
        itemSlug: payment.item_slug ?? null,
        amount: payment.amount,
        gatewayRef: payment.gateway_ref ?? null,
        loginCode: paid ? await buyerLogin(payment.phone, payment.student_name) : null,
        verifiedSignature: payment.verified_signature ?? null,
        demo: false,
        ...extras,
      });
    }

    // 4) No record yet (e.g. user opened the status tab before paying, on a
    //    different instance). Report PENDING instead of a hard error so the
    //    page keeps polling gracefully.
    return NextResponse.json({
      ok: true,
      referenceNo,
      status: "PENDING",
      item: ITEM_LABEL[itemTypeFromReference(referenceNo)],
      itemType: itemTypeFromReference(referenceNo),
      itemSlug: null,
      amount: 0,
      gatewayRef: null,
      verifiedSignature: null,
      demo: false,
      awaiting: true,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not fetch status." }, { status: 500 });
  }
}
