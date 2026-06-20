import { NextResponse } from "next/server";
import { getPaymentByReference, updatePaymentByReference } from "@/lib/dataProvider";
import { verifyResponseSignature, type EazypayResponseFields } from "@/lib/eazypay";
import type { Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

const FIELD_KEYS: (keyof EazypayResponseFields)[] = [
  "ID",
  "Response Code",
  "Unique Ref Number",
  "Service Tax Amount",
  "Processing Fee Amount",
  "Total Amount",
  "Transaction Amount",
  "Transaction Date",
  "Interchange Value",
  "TDR",
  "Payment Mode",
  "SubMerchantId",
  "ReferenceNo",
  "TPS",
];

function get(params: Map<string, string>, key: string): string {
  return params.get(key) ?? "";
}

async function readParams(req: Request): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Query string (GET or appended params)
  const url = new URL(req.url);
  url.searchParams.forEach((v, k) => map.set(k, v));
  // Form-encoded body (ICICI POSTs to the return URL)
  if (req.method === "POST") {
    try {
      const form = await req.formData();
      form.forEach((v, k) => map.set(k, String(v)));
    } catch {
      // ignore — may be a GET-style redirect with no body
    }
  }
  return map;
}

function statusBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}/payment/status`;
}

async function handle(req: Request) {
  const params = await readParams(req);

  const referenceNo = get(params, "ReferenceNo");
  const responseCode = get(params, "Response Code");
  const rs = get(params, "RS");

  // Always redirect the user to the status page (it shows the final state).
  const redirectTo = (ref: string) =>
    NextResponse.redirect(`${statusBaseUrl(req)}?ref=${encodeURIComponent(ref)}`, { status: 302 });

  if (!referenceNo) {
    return redirectTo("");
  }

  const existing = await getPaymentByReference(referenceNo);
  if (!existing) {
    // Unknown reference — log only the reference, never the payload/key.
    console.warn(`[eazypay] callback for unknown reference ${referenceNo}`);
    return redirectTo(referenceNo);
  }

  const fields: Partial<EazypayResponseFields> = {};
  for (const k of FIELD_KEYS) fields[k] = get(params, k);

  const signatureValid = verifyResponseSignature(fields, rs);
  const isSuccess = responseCode.toUpperCase() === "E000" && signatureValid;

  const patch: Partial<Payment> = {
    status: isSuccess ? "PAID" : "FAILED",
    response_code: responseCode || null,
    gateway_ref: get(params, "Unique Ref Number") || null,
    payment_mode: get(params, "Payment Mode") || null,
    transaction_date: get(params, "Transaction Date") || null,
    verified_signature: signatureValid,
  };
  const totalAmount = Number(get(params, "Total Amount"));
  if (!Number.isNaN(totalAmount) && get(params, "Total Amount") !== "") {
    patch.total_amount = totalAmount;
  }

  await updatePaymentByReference(referenceNo, patch);
  console.info(`[eazypay] callback ref=${referenceNo} status=${patch.status} signature=${signatureValid}`);

  return redirectTo(referenceNo);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
