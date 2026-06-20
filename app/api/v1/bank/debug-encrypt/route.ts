import { NextResponse } from "next/server";
import { buildPaymentUrl, encrypt, isEazypayConfigured } from "@/lib/eazypay";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY helper to validate AES encryption against ICICI Eazypay sample
 * values. Disabled in production. Never returns or logs the AES key itself.
 *
 * Usage (dev): GET /api/v1/bank/debug-encrypt
 * Optional override: ?value=123456|11|100|Name|Email|9087654321
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not available." }, { status: 404 });
  }
  if (!isEazypayConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      note: "Set ICICI_EAZYPAY_AES_KEY in .env.local to test encryption.",
    });
  }

  const url = new URL(req.url);
  const sample = url.searchParams.get("value") || "123456|11|100|Test Name|test@example.com|9087654321";

  const sampleUrl = buildPaymentUrl({
    referenceNo: "123456",
    subMerchantId: "11",
    amount: 100,
    name: "Test Name",
    email: "test@example.com",
    mobile: "9087654321",
  });

  return NextResponse.json({
    ok: true,
    configured: true,
    sampleMandatory: sample,
    encryptedMandatory: encrypt(sample),
    samplePaymentUrl: sampleUrl,
  });
}
