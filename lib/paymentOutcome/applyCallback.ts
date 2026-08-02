/**
 * Advisory ICICI return-URL callback handler.
 * NEVER writes PAID or FAILED — only UNCONFIRMED + raw payload + enqueue Verify.
 */
import { getSupabaseAdmin } from "../supabase";
import type { Payment } from "../types";
import { isPaidStatus } from "./states";
import { enqueueVerifyLadder, enqueueVerifySoon } from "./qstashLadder";
import { tgLog } from "../telegram/log";

function demoMode(): boolean {
  return !getSupabaseAdmin();
}

export interface CallbackAdvisoryInput {
  referenceNo: string;
  fields: Record<string, string>;
  signatureValid: boolean;
  rawParams?: Record<string, string>;
}

/**
 * Persist callback as advisory evidence and move INITIATED/open → UNCONFIRMED.
 * Returns the payment row (or null). Never returns a newly-PAID row from this path.
 */
export async function applyCallbackAdvisory(input: CallbackAdvisoryInput): Promise<Payment | null> {
  const ref = (input.referenceNo || "").trim();
  if (!ref) return null;

  const payload = {
    received_at: new Date().toISOString(),
    signature_valid: input.signatureValid,
    fields: input.fields,
    raw: input.rawParams || input.fields,
  };

  const responseCode = (input.fields["Response Code"] || input.fields["Response_Code"] || "").trim();
  const gatewayRef = (input.fields["Unique Ref Number"] || input.fields["Unique_Ref_Number"] || "").trim() || null;
  const paymentMode = (input.fields["Payment Mode"] || input.fields["Payment_Mode"] || "").trim() || null;
  const transactionDate = (input.fields["Transaction Date"] || input.fields["Transaction_Date"] || "").trim() || null;
  const amountStr = input.fields["Total Amount"] || input.fields["Transaction Amount"] || "";
  const totalAmount = amountStr !== "" && !Number.isNaN(Number(amountStr)) ? Number(amountStr) : null;

  if (demoMode()) {
    const { demoPayments } = await import("../dataProvider");
    const store = demoPayments();
    const idx = store.findIndex((p) => p.reference_no === ref);
    if (idx < 0) return null;
    if (isPaidStatus(store[idx].status)) return store[idx];
    store[idx] = {
      ...store[idx],
      status: "UNCONFIRMED",
      response_code: responseCode || store[idx].response_code,
      gateway_ref: gatewayRef || store[idx].gateway_ref,
      payment_mode: paymentMode || store[idx].payment_mode,
      transaction_date: transactionDate || store[idx].transaction_date,
      verified_signature: input.signatureValid,
      total_amount: totalAmount ?? store[idx].total_amount,
      callback_payload: payload as unknown as Payment["callback_payload"],
    };
    void enqueueVerifySoon(ref).catch(() => {});
    return store[idx];
  }

  const db = getSupabaseAdmin();
  if (!db) return null;

  // Never touch PAID. Only open / non-paid rows move to UNCONFIRMED.
  const patch: Record<string, unknown> = {
    status: "UNCONFIRMED",
    callback_payload: payload,
    verified_signature: input.signatureValid,
  };
  if (responseCode) patch.response_code = responseCode;
  if (gatewayRef) patch.gateway_ref = gatewayRef;
  if (paymentMode) patch.payment_mode = paymentMode;
  if (transactionDate) patch.transaction_date = transactionDate;
  if (totalAmount != null) patch.total_amount = totalAmount;

  const { data, error } = await db
    .from("payments")
    .update(patch)
    .eq("reference_no", ref)
    .not("status", "in", "(PAID,captured)")
    .select("*")
    .maybeSingle();

  if (error) {
    tgLog("callback_advisory_update_failed", { ref, error: error.message }, "error");
    // Still try to store payload even if status race (e.g. already PAID).
    await db
      .from("payments")
      .update({ callback_payload: payload })
      .eq("reference_no", ref)
      .is("callback_payload", null);
    return null;
  }

  const row = data as Payment | null;
  if (row) {
    void enqueueVerifySoon(ref).catch(() => {});
    // Ladder may already be scheduled at create — ensure at least one soon-job.
    void enqueueVerifyLadder(ref, { dedupe: true }).catch(() => {});
  }
  return row;
}
