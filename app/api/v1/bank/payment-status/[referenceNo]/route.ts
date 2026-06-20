import { NextResponse } from "next/server";
import { getPaymentByReference, updatePaymentByReference } from "@/lib/dataProvider";
import { isEazypayConfigured } from "@/lib/eazypay";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { referenceNo: string } }) {
  try {
    const referenceNo = decodeURIComponent(params.referenceNo || "");
    if (!referenceNo) {
      return NextResponse.json({ ok: false, error: "Missing reference." }, { status: 400 });
    }

    let payment = await getPaymentByReference(referenceNo);
    if (!payment) {
      return NextResponse.json({ ok: false, error: "Payment not found." }, { status: 404 });
    }

    // DEMO MODE: with no AES key configured there is no real gateway callback,
    // so simulate a successful payment when the demo flag is set.
    const url = new URL(req.url);
    const demo = url.searchParams.get("demo") === "1";
    if (demo && !isEazypayConfigured() && payment.status === "PENDING") {
      payment = (await updatePaymentByReference(referenceNo, {
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
      verifiedSignature: payment.verified_signature ?? null,
      demo: demo && !isEazypayConfigured(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not fetch status." }, { status: 500 });
  }
}
