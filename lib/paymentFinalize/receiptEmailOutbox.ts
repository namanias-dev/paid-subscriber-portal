/**
 * Durable receipt-email delivery from payment_finalize_ledger.
 *
 * Allocation is already committed before any email work. Retrying email never
 * calls finalize_course_payment and never mutates schedule/amount_paid.
 *
 * Real sends are skipped when RESEND_API_KEY is unset or
 * PAYMENT_RECEIPT_EMAIL_DISABLED=1 (tests / dry environments).
 */
import "server-only";
import { getSupabaseAdmin } from "../supabase";
import { formatINR } from "../dates";
import { tgLog } from "../telegram/log";

export type ReceiptEmailJob = {
  payment_id: string;
  receipt_no: string | null;
  receipt_email_attempts: number;
  receipt_email_payload: {
    to?: string;
    name?: string;
    receiptNo?: string;
    courseTitle?: string;
    paymentLabel?: string;
    amount?: number;
    paidToDate?: number;
    remaining?: number;
    status?: string;
  } | null;
};

function emailDisabled(): boolean {
  if (process.env.PAYMENT_RECEIPT_EMAIL_DISABLED === "1") return true;
  if (!process.env.RESEND_API_KEY) return true;
  return false;
}

/** Claim due pending jobs (skip locked). */
export async function claimPendingReceiptEmails(limit = 10): Promise<ReceiptEmailJob[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("payment_finalize_ledger")
    .select("payment_id, receipt_no, receipt_email_attempts, receipt_email_payload")
    .eq("receipt_email_status", "pending")
    .eq("status", "completed")
    .lte("receipt_email_next_attempt_at", now)
    .order("receipt_email_next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) {
    tgLog("receipt_email_claim_failed", { error: error.message }, "warn");
    return [];
  }
  return (data || []) as ReceiptEmailJob[];
}

async function markEmailResult(
  paymentId: string,
  result: "sent" | "failed" | "skipped",
  attempts: number,
  err?: string,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const nextAttempt =
    result === "failed" && attempts < 8
      ? new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempts - 1))).toISOString()
      : null;
  await db
    .from("payment_finalize_ledger")
    .update({
      receipt_email_status: result === "failed" && nextAttempt ? "pending" : result,
      receipt_email_attempts: attempts,
      receipt_email_next_attempt_at: nextAttempt,
      receipt_email_last_error: err || null,
      updated_at: new Date().toISOString(),
    })
    .eq("payment_id", paymentId)
    .eq("receipt_email_status", "pending");
}

/**
 * Process pending receipt emails. Never reallocates money.
 * Returns counts only — does not throw.
 */
export async function processPendingReceiptEmails(limit = 10): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const jobs = await claimPendingReceiptEmails(limit);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const job of jobs) {
    const attempts = (job.receipt_email_attempts || 0) + 1;
    const payload = job.receipt_email_payload;
    if (!payload?.to) {
      await markEmailResult(job.payment_id, "skipped", attempts, "missing_to");
      skipped++;
      continue;
    }
    if (emailDisabled()) {
      await markEmailResult(job.payment_id, "skipped", attempts, "email_disabled");
      skipped++;
      continue;
    }
    try {
      const { sendReceiptEmail } = await import("../email");
      const r = await sendReceiptEmail({
        to: payload.to,
        name: payload.name || "Student",
        receiptNo: payload.receiptNo || job.receipt_no || "",
        courseTitle: payload.courseTitle || "Course",
        paymentLabel: payload.paymentLabel || "Payment",
        amount: formatINR(Number(payload.amount) || 0),
        paidToDate: formatINR(Number(payload.paidToDate) || 0),
        remaining:
          Number(payload.remaining) <= 0 ? "₹0 — Fully paid" : formatINR(Number(payload.remaining) || 0),
        installmentsSummary: payload.paymentLabel || "",
        status: payload.status || "",
      });
      if (r.sent) {
        await markEmailResult(job.payment_id, "sent", attempts);
        sent++;
      } else {
        await markEmailResult(job.payment_id, "failed", attempts, "send_returned_false");
        failed++;
      }
    } catch (e) {
      await markEmailResult(job.payment_id, "failed", attempts, (e as Error).message);
      failed++;
    }
  }
  return { claimed: jobs.length, sent, failed, skipped };
}
