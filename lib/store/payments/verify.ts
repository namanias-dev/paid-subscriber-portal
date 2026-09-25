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
 *  - A paid response whose amount does not match the order is NOT captured. It is
 *    alerted. An amount mismatch means either a tampered checkout or a bug, and
 *    guessing which is not something code should do.
 */
import { storeDb } from "@/lib/store/db";
import { storeOpsAlert } from "@/lib/store/alerts";
import { holdReservationsUntilShip, releaseReservations } from "@/lib/store/inventory";
import { consumeStoreOfferHold, releaseStoreOfferHold } from "@/lib/store/offers";
import { isStoreReference, STORE_REFERENCE_SQL_LIKE } from "@/lib/store/references";
import { storeEazypayVerify, paiseToGatewayAmount } from "./eazypay";
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
    .select("id,order_id,reference_no,status,amount_paise,gateway_ref,verify_attempts")
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

  // A paid answer must agree with what we asked for, to the paisa.
  if (outcome === "paid" && result.amount != null) {
    const expected = paiseToGatewayAmount(row.amount_paise);
    if (Number(result.amount) !== Number(expected)) {
      await db
        .from("store_order_payments")
        .update({
          verify_attempts: attempts,
          last_verify_at: nowIso,
          next_verify_at: null,
          raw_verify_status: result.rawStatus,
          verify_payload: { amount_mismatch: true, gateway_amount: result.amount, expected },
          updated_at: nowIso,
        })
        .eq("id", row.id)
        .in("status", STORE_OPEN_STATUSES);
      await storeOpsAlert(
        [
          "🚨 <b>Notes Store amount mismatch — NOT captured</b>",
          `reference: <code>${referenceNo}</code>`,
          `gateway said: <b>₹${result.amount}</b>`,
          `order expects: <b>₹${expected}</b>`,
          "Payment left open deliberately. Resolve by hand.",
        ].join("\n"),
      );
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
      verify_payload: { status: result.rawStatus, amount: result.amount, http: result.httpStatus },
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
    }
    if (data?.length) {
      await consumeStoreOfferHold(orderId);
      const { ensureStoreInvoice } = await import("../invoice/issue");
      void ensureStoreInvoice(orderId).catch(() => {});
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
