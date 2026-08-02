/**
 * ICICI Verify → sole writer of terminal payment states (PAID | FAILED | EXPIRED).
 */
import { getSupabaseAdmin } from "../supabase";
import {
  eazypayVerify,
  mapVerifyStatus,
  settlementForVerifyStatus,
  type EazypayVerifyResult,
  type VerifyOutcome,
} from "../eazypay";
import type { Payment } from "../types";
import { isPaidStatus, type TerminalStatus } from "./states";
import { cancelVerifyLadder } from "./qstashLadder";
import { notifyPaymentConfirmedOnce } from "./confirmOnce";
import { tgLog } from "../telegram/log";

function demoMode(): boolean {
  return !getSupabaseAdmin();
}

export interface ApplyVerifyOptions {
  /** Skip student SMS/Telegram and per-order ops payment alerts (backfill). */
  silentStudentNotify?: boolean;
  /** Skip live ICICI call — use provided result (tests). */
  precomputed?: EazypayVerifyResult | null;
  actor?: { id: string; name: string | null; role: string | null; isSuper: boolean } | null;
}

export interface ApplyVerifyResult {
  referenceNo: string;
  from: string;
  to: string;
  outcome: VerifyOutcome | "skipped_paid" | "unreachable" | "rate_limited";
  changed: boolean;
  newlyPaid: boolean;
  amount: number;
  itemType: string | null;
  paymentKind: string | null;
  rawStatus: string | null;
  retryAfterMs?: number;
}

function terminalForOutcome(outcome: VerifyOutcome): TerminalStatus | null {
  if (outcome === "paid") return "PAID";
  if (outcome === "failed") return "FAILED";
  if (outcome === "abandoned" || outcome === "expired") return "EXPIRED";
  return null;
}

async function loadByRef(ref: string): Promise<Payment | null> {
  if (demoMode()) {
    const { demoPayments } = await import("../dataProvider");
    return demoPayments().find((p) => p.reference_no === ref) ?? null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("payments").select("*").eq("reference_no", ref).maybeSingle();
  return (data as Payment) ?? null;
}

/**
 * Run Verify for one order and apply the sole allowed terminal transition.
 * Idempotent. Never downgrades PAID. Concurrent callers: only one PAID write wins.
 */
export async function applyVerifyForReference(
  referenceNo: string,
  opts: ApplyVerifyOptions = {},
): Promise<ApplyVerifyResult> {
  const ref = (referenceNo || "").trim();
  const empty: ApplyVerifyResult = {
    referenceNo: ref,
    from: "",
    to: "",
    outcome: "unreachable",
    changed: false,
    newlyPaid: false,
    amount: 0,
    itemType: null,
    paymentKind: null,
    rawStatus: null,
  };
  if (!ref) return empty;

  const row = await loadByRef(ref);
  if (!row) return empty;
  if (isPaidStatus(row.status)) {
    await cancelVerifyLadder(row).catch(() => {});
    return {
      ...empty,
      from: row.status,
      to: row.status,
      outcome: "skipped_paid",
      amount: row.amount,
      itemType: row.item_type,
      paymentKind: row.payment_kind ?? null,
    };
  }

  let live: EazypayVerifyResult;
  if (opts.precomputed) {
    live = opts.precomputed;
  } else {
    live = await eazypayVerify(ref, {
      ezpaytranid: row.gateway_ref,
      amount: row.amount,
      paymentmode: row.payment_mode,
      trandate: row.transaction_date,
    });
  }

  // Rate limit / 5xx — do not mark failed; caller reschedules.
  if (!live.reachable && (live.httpStatus === 429 || (live.httpStatus != null && live.httpStatus >= 500))) {
    return {
      ...empty,
      from: row.status,
      to: row.status,
      outcome: "rate_limited",
      amount: row.amount,
      itemType: row.item_type,
      paymentKind: row.payment_kind ?? null,
      rawStatus: live.rawStatus,
      retryAfterMs: live.httpStatus === 429 ? 120_000 : 300_000,
    };
  }

  const verifyPayload = {
    received_at: new Date().toISOString(),
    reachable: live.reachable,
    outcome: live.outcome,
    rawStatus: live.rawStatus,
    gatewayRef: live.gatewayRef,
    amount: live.amount,
    httpStatus: live.httpStatus ?? null,
    settlement: live.settlement,
    error: live.error ?? null,
  };

  if (!live.reachable || live.outcome === "unknown") {
    // Persist verify evidence only — no terminal write.
    await persistVerifyMeta(row, verifyPayload, live, null);
    return {
      ...empty,
      from: row.status,
      to: row.status,
      outcome: "unreachable",
      amount: row.amount,
      itemType: row.item_type,
      paymentKind: row.payment_kind ?? null,
      rawStatus: live.rawStatus,
    };
  }

  const target = terminalForOutcome(live.outcome);
  if (!target) {
    await persistVerifyMeta(row, verifyPayload, live, null);
    return {
      ...empty,
      from: row.status,
      to: row.status,
      outcome: live.outcome,
      amount: row.amount,
      itemType: row.item_type,
      paymentKind: row.payment_kind ?? null,
      rawStatus: live.rawStatus,
    };
  }

  const settlement = live.settlement ?? settlementForVerifyStatus(live.rawStatus);
  const patch: Record<string, unknown> = {
    status: target,
    verify_payload: verifyPayload,
    verify_attempts: (row.verify_attempts ?? 0) + 1,
    last_verify_at: new Date().toISOString(),
    verify_status: live.rawStatus,
  };
  if (live.gatewayRef) patch.gateway_ref = live.gatewayRef;
  if (target === "PAID" && settlement) patch.settlement_status = settlement;
  // Clear schedule ids on terminal (cancel happens after).
  if (target === "PAID" || target === "FAILED" || target === "EXPIRED") {
    patch.verify_schedule_ids = [];
  }

  const newlyPaid = await guardedTerminalWrite(row, patch, target);

  if (newlyPaid && target === "PAID") {
    const { ensureBuyer, finalizeCoursePaymentByReference, getPaymentByReference } = await import(
      "../dataProvider"
    );
    const fresh = (await getPaymentByReference(ref)) || row;
    await ensureBuyer(fresh.phone, fresh.student_name).catch(() => null);
    if (fresh.item_type === "course") {
      await finalizeCoursePaymentByReference(ref).catch(() => null);
    }
    if (!opts.silentStudentNotify) {
      const { recordPaymentPaid } = await import("../analytics/server");
      await recordPaymentPaid(fresh, "verify").catch(() => {});
      await notifyPaymentConfirmedOnce(fresh).catch((e) =>
        tgLog("payment_confirm_failed", { ref, error: (e as Error).message }, "warn"),
      );
    } else {
      // Backfill: supersede siblings + status analytics; no student SMS/TG alerts.
      const { supersedeUnpaidSiblings } = await import("../paymentSupersede");
      const { recordPaymentStatusChanged } = await import("../analytics/server");
      await recordPaymentStatusChanged(fresh, "PAID", "verify_backfill").catch(() => {});
      void supersedeUnpaidSiblings(fresh).catch(() => {});
    }
    await cancelVerifyLadder(fresh).catch(() => {});
  } else if (newlyPaid && (target === "FAILED" || target === "EXPIRED")) {
    const { getPaymentByReference } = await import("../dataProvider");
    const fresh = (await getPaymentByReference(ref)) || row;
    if (!opts.silentStudentNotify && target === "FAILED") {
      const { recordPaymentStatusChanged } = await import("../analytics/server");
      await recordPaymentStatusChanged(fresh, "FAILED", "verify").catch(() => {});
    }
    await cancelVerifyLadder(fresh).catch(() => {});
  }

  return {
    referenceNo: ref,
    from: row.status,
    to: newlyPaid ? target : row.status,
    outcome: live.outcome,
    changed: newlyPaid,
    newlyPaid: newlyPaid && target === "PAID",
    amount: row.amount,
    itemType: row.item_type,
    paymentKind: row.payment_kind ?? null,
    rawStatus: live.rawStatus,
  };
}

/** Map raw ICICI status through eazypay helper (re-export for tests). */
export function outcomeFromRaw(raw: string | null | undefined): VerifyOutcome {
  return mapVerifyStatus(raw);
}

async function persistVerifyMeta(
  row: Payment,
  verifyPayload: Record<string, unknown>,
  live: EazypayVerifyResult,
  status: TerminalStatus | null,
): Promise<void> {
  if (demoMode()) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  const patch: Record<string, unknown> = {
    verify_payload: verifyPayload,
    verify_attempts: (row.verify_attempts ?? 0) + 1,
    last_verify_at: new Date().toISOString(),
  };
  if (live.rawStatus) patch.verify_status = live.rawStatus;
  if (live.gatewayRef && !row.gateway_ref) patch.gateway_ref = live.gatewayRef;
  if (status) patch.status = status;
  await db
    .from("payments")
    .update(patch)
    .eq("id", row.id)
    .not("status", "in", "(PAID,captured)");
}

/**
 * Single guarded write into a terminal status. Returns true if this caller won the write.
 */
async function guardedTerminalWrite(
  row: Payment,
  patch: Record<string, unknown>,
  target: TerminalStatus,
): Promise<boolean> {
  if (demoMode()) {
    const { demoPayments } = await import("../dataProvider");
    const store = demoPayments();
    const idx = store.findIndex((p) => p.id === row.id);
    if (idx < 0 || isPaidStatus(store[idx].status)) return false;
    store[idx] = { ...store[idx], ...(patch as Partial<Payment>), status: target };
    return true;
  }
  const db = getSupabaseAdmin();
  if (!db) return false;

  // Conditional update: must still be non-PAID. For PAID target, any non-PAID may upgrade
  // (including FAILED→PAID when Verify says RIP). For FAILED/EXPIRED, do not overwrite PAID.
  let q = db
    .from("payments")
    .update(patch)
    .eq("id", row.id)
    .not("status", "in", "(PAID,captured)");

  // Idempotent: if already at same terminal, count as not newly changed.
  const { data, error } = await q.select("id,status").maybeSingle();
  if (error) {
    // Unique gateway_ref conflict — another row holds this txn; treat as no-op.
    if (/duplicate|unique/i.test(error.message)) {
      tgLog("verify_gateway_ref_conflict", { id: row.id, ref: row.reference_no, error: error.message }, "warn");
      return false;
    }
    tgLog("verify_terminal_write_failed", { id: row.id, error: error.message }, "error");
    return false;
  }
  if (!data) return false;
  return (data as { status: string }).status === target;
}
