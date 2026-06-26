import { NextResponse } from "next/server";
import { reverifyPayments, getPaymentByReference } from "@/lib/dataProvider";
import { itemTypeFromReference } from "@/lib/eazypay";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Student "I have paid — Check Payment Status" — forces a live ICICI Verify-URL
 * check for a single reference and returns the resulting status. If ICICI shows
 * success the row is upgraded to PAID immediately (access granted). Safe to call
 * repeatedly; never downgrades a paid row.
 */
export async function GET(_req: Request, { params }: { params: { referenceNo: string } }) {
  const referenceNo = decodeURIComponent(params.referenceNo || "");
  if (!referenceNo) {
    return NextResponse.json({ ok: false, error: "Missing reference." }, { status: 400 });
  }
  try {
    // Run the shared verifier for just this reference (skips paid rows internally).
    await reverifyPayments({ referenceNos: [referenceNo], limit: 1 });
    const row = await getPaymentByReference(referenceNo);
    const status = row?.status ?? "PENDING";
    return NextResponse.json({
      ok: true,
      referenceNo,
      status,
      item: row?.item ?? null,
      itemType: row?.item_type ?? itemTypeFromReference(referenceNo),
      amount: row?.amount ?? 0,
    });
  } catch (e) {
    console.error("[bank/verify] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not verify payment." }, { status: 500 });
  }
}
