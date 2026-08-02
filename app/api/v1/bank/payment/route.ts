import { NextResponse } from "next/server";
import { verifyResponseSignature, signStatusParams, type EazypayResponseFields } from "@/lib/eazypay";
import { applyCallbackAdvisory } from "@/lib/paymentOutcome";

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
  const url = new URL(req.url);
  url.searchParams.forEach((v, k) => map.set(k, v));
  if (req.method === "POST") {
    try {
      const form = await req.formData();
      form.forEach((v, k) => map.set(k, String(v)));
    } catch {
      /* may be GET-style */
    }
  }
  return map;
}

function statusBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}/payment/status`;
}

/**
 * ICICI return URL — ADVISORY ONLY.
 * Never writes PAID or FAILED. Stores callback payload, moves row to UNCONFIRMED,
 * and enqueues Verify (sole authority for terminals).
 */
async function handle(req: Request) {
  const params = await readParams(req);
  const referenceNo = get(params, "ReferenceNo");
  const responseCode = get(params, "Response Code");
  const rs = get(params, "RS");

  const redirectTo = (ref: string, uiHint?: string, amount?: string) => {
    const qs = new URLSearchParams({ ref });
    // UI hint only — status page must not treat this as authoritative terminal.
    if (uiHint) {
      qs.set("hint", uiHint);
      qs.set("amt", amount ?? "0");
      qs.set("sig", signStatusParams(ref, uiHint, amount ?? "0"));
    }
    return NextResponse.redirect(`${statusBaseUrl(req)}?${qs.toString()}`, { status: 302 });
  };

  if (!referenceNo) {
    return redirectTo("");
  }

  const fields: Partial<EazypayResponseFields> = {};
  for (const k of FIELD_KEYS) fields[k] = get(params, k);

  const signatureValid = verifyResponseSignature(fields, rs);
  // Advisory classification for UI hint only — NEVER persisted as terminal status.
  const looksSuccess = responseCode.toUpperCase() === "E000" && signatureValid;
  const uiHint = looksSuccess ? "UNCONFIRMED" : "UNCONFIRMED";

  const raw: Record<string, string> = {};
  params.forEach((v, k) => {
    raw[k] = v;
  });
  const fieldRecord: Record<string, string> = {};
  for (const k of FIELD_KEYS) fieldRecord[k] = fields[k] ?? "";

  await applyCallbackAdvisory({
    referenceNo,
    fields: fieldRecord,
    signatureValid,
    rawParams: raw,
  });

  const amountStr = get(params, "Total Amount") || get(params, "Transaction Amount") || "0";
  console.info(
    `[eazypay] callback_advisory ref=${referenceNo} code=${responseCode} signature=${signatureValid} (terminal deferred to Verify)`,
  );

  return redirectTo(referenceNo, uiHint, amountStr);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
