import { NextResponse } from "next/server";
import { updatePaymentByReference } from "@/lib/dataProvider";
import { verifyResponseSignature, signStatusParams, type EazypayResponseFields } from "@/lib/eazypay";
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

  /**
   * Redirect the user to the status page. We pass a server-SIGNED result so the
   * status page can show the authoritative outcome even when there is no shared
   * datastore (serverless instances don't share memory). The HMAC is keyed by
   * the backend AES key, so the params can't be spoofed.
   */
  const redirectTo = (ref: string, status?: string, amount?: string) => {
    const qs = new URLSearchParams({ ref });
    if (status) {
      qs.set("st", status);
      qs.set("amt", amount ?? "0");
      qs.set("sig", signStatusParams(ref, status, amount ?? "0"));
    }
    return NextResponse.redirect(`${statusBaseUrl(req)}?${qs.toString()}`, { status: 302 });
  };

  if (!referenceNo) {
    return redirectTo("");
  }

  const fields: Partial<EazypayResponseFields> = {};
  for (const k of FIELD_KEYS) fields[k] = get(params, k);

  // Signature verification is fully self-contained (response fields + AES key),
  // so it works without any stored record — this is the source of truth.
  const signatureValid = verifyResponseSignature(fields, rs);
  const isSuccess = responseCode.toUpperCase() === "E000" && signatureValid;
  const status = isSuccess ? "PAID" : "FAILED";

  const amountStr = get(params, "Total Amount") || get(params, "Transaction Amount") || "0";

  const patch: Partial<Payment> = {
    status,
    response_code: responseCode || null,
    gateway_ref: get(params, "Unique Ref Number") || null,
    payment_mode: get(params, "Payment Mode") || null,
    transaction_date: get(params, "Transaction Date") || null,
    verified_signature: signatureValid,
  };
  const totalAmount = Number(amountStr);
  if (!Number.isNaN(totalAmount) && amountStr !== "") {
    patch.total_amount = totalAmount;
  }

  // Persist when a record/DB exists (best-effort; null result is fine).
  await updatePaymentByReference(referenceNo, patch);
  console.info(`[eazypay] callback ref=${referenceNo} status=${status} signature=${signatureValid}`);

  return redirectTo(referenceNo, status, amountStr);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
