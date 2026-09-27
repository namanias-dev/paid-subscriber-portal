/**
 * EazyPGVerify — the store's SOLE terminal authority.
 *
 * Nothing else in the store may write CAPTURED, FAILED or EXPIRED. Not the
 * callback, not the frontend, not an admin button, not a timer. The rules this
 * enforces, learned on the course path and re-implemented rather than shared:
 *
 *  - An unreachable or ambiguous gateway writes NOTHING. A genuinely-paid
 *    customer must never be failed by a timeout.
 *  - A timer never produces FAILED. Only ICICI's own answer does.
 *  - Every terminal write is conditional on the row still being open, so a
 *    duplicate callback, a retried cron and a customer refreshing the order page
 *    at the same moment produce exactly one capture between them.
 *  - A paid response whose MERCHANT amount does not exactly equal the order
 *    total, in integer paise, is NOT captured. The cardholder total may be
 *    higher when ICICI adds a processing fee. That fee is recorded and is not
 *    the order amount. A missing merchant amount fails closed.
 */
import { storeDb } from "@/lib/store/db";
import { formatPaise } from "@/lib/store/money";
import { storeOpsAlert } from "@/lib/store/alerts";
import { holdReservationsUntilShip, releaseReservations } from "@/lib/store/inventory";
import { consumeStoreOfferHold, releaseStoreOfferHold } from "@/lib/store/offers";
import { isStoreReference, STORE_REFERENCE_SQL_LIKE } from "@/lib/store/references";
import { storeEazypayVerify } from "./eazypay";
import {
  formatReconciledPaymentAlert,
  merchantAmountDecision,
  normalizeEazypayVerifyAmounts,
  verifyAmountPayload,
  type EazypayNormalizedAmounts,
  type SignedCallbackAmounts,
} from "./eazypayAmounts";
import {
  mapStoreVerifyStatus,
  nextVerifyDelayMs,
  storeSettlementFor,
  storeStatusForOutcome,
  STORE_OPEN_STATUSES,
  type StoreVerifyOutcome,
} from "./status";

export interface ApplyStoreVerifyResult {
  outcome: StoreVerifyOutcome | "not_found" | "already_terminal" | "unreachable" | "amount_mismatch";
  status: string | null;
  changed: boolean;
  rawStatus?: string | null;
  orderNo?: string | null;
}

/**
 * Verify one store payment and, if ICICI is definite, write the terminal.
 * Safe to call concurrently and repeatedly: at most one capture results.
 */
export async function applyStoreVerify(
  referenceNo: string,
  opts?: { source?: string },
): Promise<ApplyStoreVerifyResult> {
  if (!isStoreReference(referenceNo)) {
    return { outcome: "not_found", status: null, changed: false };
  }
  const db = storeDb();
  if (!db) return { outcome: "unreachable", status: null, changed: false };

  const { data: row } = await db
    .from("store_order_payments")
    .select("id,order_id,reference_no,status,amount_paise,gateway_ref,verify_attempts,verify_payload,callback_payload,verified_signature")
    .eq("reference_no", referenceNo)
    .maybeSingle();

  if (!row) return { outcome: "not_found", status: null, changed: false };
  if (!STORE_OPEN_STATUSES.includes(row.status)) {
    if (row.status === "CAPTURED") await holdReservationsUntilShip(row.order_id);
    return { outcome: "already_terminal", status: row.status, changed: false };
  }

  const result = await storeEazypayVerify(referenceNo, {
    gatewayRef: row.gateway_ref,
    amountPaise: row.amount_paise,
  });

  const nowIso = new Date().toISOString();
  const attempts = (row.verify_attempts || 0) + 1;

  // Unreachable or not-an-answer: record the attempt, schedule the next one,
  // change nothing else.
  const outcome = result.reachable ? mapStoreVerifyStatus(result.rawStatus) : "unknown";
  if (outcome === "unknown") {
    const delay = nextVerifyDelayMs(attempts);
    await db
      .from("store_order_payments")
      .update({
        status: row.status === "INITIATED" ? "VERIFYING" : row.status,
        verify_attempts: attempts,
        last_verify_at: nowIso,
        next_verify_at: delay ? new Date(Date.now() + delay).toISOString() : null,
        raw_verify_status: result.rawStatus,
        verify_payload: { reachable: result.reachable, status: result.rawStatus, http: result.httpStatus, error: result.error },
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .in("status", STORE_OPEN_STATUSES);
    return {
      outcome: result.reachable ? "unknown" : "unreachable",
      status: row.status,
      changed: false,
      rawStatus: result.rawStatus,
    };
  }

  // A paid answer must agree with the merchant amount, in integer paise.
  // `amount` on the verify packet is the cardholder total and is not compared.
  const normalized = normalizeEazypayVerifyAmounts({
    packet: result.packet,
    expectedReference: referenceNo,
    signedCallback: signedCallbackAmounts(row),
  });
  if (outcome === "paid") {
    const decision = merchantAmountDecision(normalized, row.amount_paise);
    if (decision !== "accept") {
      await db
        .from("store_order_payments")
        .update({
          verify_attempts: attempts,
          last_verify_at: nowIso,
          next_verify_at: null,
          raw_verify_status: result.rawStatus,
          verify_payload: verifyAmountPayload({
            normalized,
            rawStatus: result.rawStatus,
            httpStatus: result.httpStatus,
            amountMismatch: true,
            expectedPaise: row.amount_paise,
          }),
          updated_at: nowIso,
        })
        .eq("id", row.id)
        .in("status", STORE_OPEN_STATUSES);
      await storeOpsAlert(amountGuardAlert(referenceNo, row.amount_paise, normalized, decision));
      return { outcome: "amount_mismatch", status: row.status, changed: false, rawStatus: result.rawStatus };
    }
  }

  const nextStatus = storeStatusForOutcome(outcome);
  if (!nextStatus) return { outcome, status: row.status, changed: false, rawStatus: result.rawStatus };

  // Conditional terminal write. If a concurrent caller got there first, this
  // updates zero rows and we report no change — the idempotency guarantee.
  const { data: updated } = await db
    .from("store_order_payments")
    .update({
      status: nextStatus,
      settlement: outcome === "paid" ? storeSettlementFor(result.rawStatus) : null,
      gateway_ref: result.gatewayRef || row.gateway_ref,
      raw_verify_status: result.rawStatus,
      verify_payload: verifyAmountPayload({
        normalized,
        rawStatus: result.rawStatus,
        httpStatus: result.httpStatus,
      }),
      verify_attempts: attempts,
      last_verify_at: nowIso,
      next_verify_at: null,
      captured_at: outcome === "paid" ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .in("status", STORE_OPEN_STATUSES)
    .select("id");

  const changed = (updated || []).length === 1;
  if (!changed) {
    return { outcome: "already_terminal", status: nextStatus, changed: false, rawStatus: result.rawStatus };
  }

  const orderNo = await applyOrderTerminal(db, row.order_id, outcome, row.amount_paise, referenceNo);
  if (outcome === "paid" && changed && priorAmountMismatch(row.verify_payload) && orderNo) {
    const fee = normalized.cardholder_total_paise != null && normalized.merchant_amount_paise != null
      ? normalized.cardholder_total_paise - normalized.merchant_amount_paise
      : null;
    void storeOpsAlert(formatReconciledPaymentAlert({
      orderNo,
      orderAmountPaise: row.amount_paise,
      gatewayFeePaise: fee,
    })).catch(() => {});
  }

  console.info(
    `[store/verify] ref=${referenceNo} raw=${result.rawStatus} -> ${nextStatus} source=${opts?.source || "unknown"}`,
  );
  return { outcome, status: nextStatus, changed: true, rawStatus: result.rawStatus, orderNo };
}

/**
 * Move the order to match the payment terminal. Conditional on the order still
 * being unpaid, so this is safe to reach twice.
 */
async function applyOrderTerminal(
  db: NonNullable<ReturnType<typeof storeDb>>,
  orderId: string,
  outcome: StoreVerifyOutcome,
  amountPaise: number,
  referenceNo: string,
): Promise<string | null> {
  const nowIso = new Date().toISOString();

  if (outcome === "paid") {
    const { data } = await db
      .from("store_orders")
      .update({
        status: "ORDER_CONFIRMED",
        paid_at: nowIso,
        amount_paid_paise: amountPaise,
        updated_at: nowIso,
      })
      .eq("id", orderId)
      .in("status", ["PAYMENT_PENDING", "PAYMENT_CONFIRMED"])
      .select("order_no");
    const orderNo = data?.[0]?.order_no ?? null;
    if (data?.length) {
      await db.from("store_order_events").insert({
        order_id: orderId,
        event: "payment_captured",
        from_status: "PAYMENT_PENDING",
        to_status: "ORDER_CONFIRMED",
        actor_type: "gateway",
        payload_json: { reference_no: referenceNo, amount_paise: amountPaise },
      });
      // Fire-and-forget order-confirmed notification (no-op until DLT approved +
      // flag on). Must never affect the capture result.
      const { notifyOrderConfirmed } = await import("../notifications");
      void notifyOrderConfirmed({ orderId, orderNo }).catch(() => {});
      // Post-commit only. Import is awaited so the send can be handed to
      // waitUntil before this request ends. The send itself is not awaited.
      // A Telegram failure must not change the paid order.
      try {
        const alerts = await import("@/lib/telegram/notesOrderAlert");
        if (alerts.shouldFireNotesPaidAlert({ outcome: "paid", transitioned: true })) {
          alerts.fireNotesOrderPaidAlert({ orderId, orderNo, amountPaise, paidAt: nowIso });
        }
      } catch (error) {
        console.error(`[store/verify] notes_alert_schedule_failed order=${orderId} ${(error as Error).message}`);
      }
    }
    if (data?.length) {
      await consumeStoreOfferHold(orderId);
      const { scheduleStoreInvoice } = await import("../invoice/issue");
      scheduleStoreInvoice(orderId);
      void import("@/lib/analytics/notesPurchase")
        .then((m) => m.recordNotesPurchase(orderId))
        .catch(() => {});
      void import("@/lib/store/checkoutLeads")
        .then((m) => m.markLeadConverted(orderId, amountPaise))
        .catch(() => {});
    }
    await holdReservationsUntilShip(orderId);
    return orderNo;
  }

  const failedStatus = outcome === "expired" ? "PAYMENT_EXPIRED" : "PAYMENT_FAILED";
  const { data } = await db
    .from("store_orders")
    .update({ status: failedStatus, updated_at: nowIso })
    .eq("id", orderId)
    .eq("status", "PAYMENT_PENDING")
    .select("order_no");
  if (data?.length) {
    await db.from("store_order_events").insert({
      order_id: orderId,
      event: "payment_not_completed",
      from_status: "PAYMENT_PENDING",
      to_status: failedStatus,
      actor_type: "gateway",
      payload_json: { reference_no: referenceNo, outcome },
    });
  }
  if (data?.length) {
    await releaseStoreOfferHold(orderId);
    void import("@/lib/analytics/notesPurchase")
      .then((m) => m.recordNotesPaymentFailed(orderId, outcome))
      .catch(() => {});
  }
  await releaseReservations({ orderId });
  return data?.[0]?.order_no ?? null;
}

export interface StoreVerifySweepResult {
  scanned: number;
  captured: number;
  failed: number;
  expired: number;
  unresolved: number;
  /** Every reference the sweep looked at, to prove the prefix filter holds. */
  references: string[];
}

/**
 * The store's own Verify sweep. Selects ONLY store references, from the store's
 * own table. The course cron cannot see these rows (different table, and an
 * item_type the payments check constraint forbids), and this cannot see course
 * rows for the same two reasons plus the prefix filter below.
 */
export async function sweepStoreVerify(opts?: { limit?: number }): Promise<StoreVerifySweepResult> {
  const out: StoreVerifySweepResult = { scanned: 0, captured: 0, failed: 0, expired: 0, unresolved: 0, references: [] };
  const db = storeDb();
  if (!db) return out;

  const { data } = await db
    .from("store_order_payments")
    .select("reference_no")
    .in("status", STORE_OPEN_STATUSES)
    .like("reference_no", STORE_REFERENCE_SQL_LIKE)
    .lte("next_verify_at", new Date().toISOString())
    .order("next_verify_at", { ascending: true })
    .limit(opts?.limit ?? 200);

  for (const row of data || []) {
    const ref = String(row.reference_no);
    // Belt and braces: never call Verify for anything outside our namespace.
    if (!isStoreReference(ref)) continue;
    out.scanned += 1;
    out.references.push(ref);
    const res = await applyStoreVerify(ref, { source: "cron" });
    if (res.outcome === "paid" && res.changed) out.captured += 1;
    else if (res.outcome === "failed" && res.changed) out.failed += 1;
    else if (res.outcome === "expired" && res.changed) out.expired += 1;
    else out.unresolved += 1;
    // ICICI's Verify endpoint is rate limited; the course path learned to space
    // calls out rather than discover the limit during a sale.
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

function signedCallbackAmounts(row: {
  verified_signature?: boolean | null;
  callback_payload?: unknown;
}): SignedCallbackAmounts | null {
  if (row.verified_signature !== true || !row.callback_payload || typeof row.callback_payload !== "object") return null;
  const fields = row.callback_payload as Record<string, unknown>;
  const text = (key: string) => (typeof fields[key] === "string" ? fields[key] : null);
  return {
    transactionAmount: text("Transaction Amount"),
    serviceTaxAmount: text("Service Tax Amount"),
  };
}

function priorAmountMismatch(payload: unknown): boolean {
  return !!payload && typeof payload === "object" && (payload as { amount_mismatch?: unknown }).amount_mismatch === true;
}

function amountGuardAlert(
  referenceNo: string,
  expectedPaise: number,
  normalized: EazypayNormalizedAmounts,
  decision: "mismatch" | "untrusted",
): string {
  const reference = referenceNo.replace(/[<>&]/g, "");
  if (decision === "mismatch" && normalized.merchant_amount_paise != null) {
    const lines = [
      "🚨 <b>Notes Store amount mismatch — NOT captured</b>",
      `reference: <code>${reference}</code>`,
      `merchant amount: <b>${formatPaise(normalized.merchant_amount_paise)}</b>`,
      `order expects: <b>${formatPaise(expectedPaise)}</b>`,
    ];
    if (
      normalized.cardholder_total_paise != null &&
      normalized.cardholder_total_paise !== normalized.merchant_amount_paise
    ) {
      lines.push(`cardholder total: ${formatPaise(normalized.cardholder_total_paise)} (gateway fee, not the order)`);
    }
    lines.push("Payment left open deliberately. Resolve by hand.");
    return lines.join("\n");
  }
  return [
    "🚨 <b>Notes Store amount unverified — NOT captured</b>",
    `reference: <code>${reference}</code>`,
    "ICICI did not return a trustworthy merchant amount.",
    "Payment left open deliberately. Resolve by hand.",
  ].join("\n");
}
