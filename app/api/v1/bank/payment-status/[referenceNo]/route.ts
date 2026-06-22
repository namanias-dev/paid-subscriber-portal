import { NextResponse } from "next/server";
import { getPaymentByReference, updatePaymentByReference, ensureBuyer } from "@/lib/dataProvider";
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

    // 1) Authoritative, stateless result handed over by the verified callback.
    //    The HMAC proves the callback (which checked ICICI's signature) produced
    //    it, so it's trustworthy even with no database.
    if (signedStatus && verifyStatusSignature(referenceNo, signedStatus, signedAmount ?? "0", sig)) {
      // Best-effort: also reflect it into any stored record.
      await updatePaymentByReference(referenceNo, {
        status: signedStatus as "PAID" | "FAILED",
      }).catch(() => null);

      const record = await getPaymentByReference(referenceNo).catch(() => null);
      const loginCode = signedStatus === "PAID" ? await buyerLogin(record?.phone, record?.student_name) : null;
      return NextResponse.json({
        ok: true,
        referenceNo,
        status: signedStatus,
        item: record?.item || ITEM_LABEL[itemTypeFromReference(referenceNo)],
        itemType: record?.item_type || itemTypeFromReference(referenceNo),
        amount: Number(signedAmount ?? record?.amount ?? 0),
        gatewayRef: record?.gateway_ref ?? null,
        loginCode,
        verifiedSignature: true,
        demo: false,
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
      if (payment.status === "PENDING") {
        payment =
          (await updatePaymentByReference(referenceNo, {
            status: "PAID",
            verified_signature: false,
            gateway_ref: `DEMO-${referenceNo}`,
          })) ?? payment;
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
      });
    }

    if (payment) {
      const paid = payment.status === "PAID" || payment.status === "captured";
      return NextResponse.json({
        ok: true,
        referenceNo,
        status: payment.status,
        item: payment.item,
        itemType: payment.item_type,
        amount: payment.amount,
        gatewayRef: payment.gateway_ref ?? null,
        loginCode: paid ? await buyerLogin(payment.phone, payment.student_name) : null,
        verifiedSignature: payment.verified_signature ?? null,
        demo: false,
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
