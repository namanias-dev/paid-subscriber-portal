/**
 * Durable receipt-email delivery from payment_finalize_ledger.
 *
 * Atomic claim via claim_receipt_email_jobs() (SKIP LOCKED + lease token).
 * Ack requires matching claim token. Disabled email stays pending without
 * consuming attempts. Retries never call finalize / never mutate money.
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
  claim_token: string;
  provider_key: string | null;
};

export type ReceiptEmailSender = (args: {
  to: string;
  name: string;
  receiptNo: string;
  courseTitle: string;
  paymentLabel: string;
  amount: string;
  paidToDate: string;
  remaining: string;
  installmentsSummary: string;
  status: string;
  idempotencyKey?: string;
}) => Promise<{ sent: boolean }>;

function emailDisabled(): boolean {
  if (process.env.PAYMENT_RECEIPT_EMAIL_DISABLED === "1") return true;
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "test") return true;
  return false;
}

export async function claimPendingReceiptEmails(
  limit = 10,
  leaseSeconds = 120,
): Promise<ReceiptEmailJob[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data, error } = await db.rpc("claim_receipt_email_jobs", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    tgLog("receipt_email_claim_failed", { error: error.message }, "warn");
    return [];
  }
  return ((data || []) as ReceiptEmailJob[]).filter((j) => j?.claim_token);
}

async function ack(
  paymentId: string,
  claimToken: string,
  result: "sent" | "failed" | "disabled" | "skipped",
  err?: string,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const { data, error } = await db.rpc("ack_receipt_email_job", {
    p_payment_id: paymentId,
    p_claim_token: claimToken,
    p_result: result,
    p_error: err || null,
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    tgLog(
      "receipt_email_ack_failed",
      { paymentId, error: error?.message || JSON.stringify(data) },
      "warn",
    );
  }
}

export async function processPendingReceiptEmails(
  limit = 10,
  opts?: { sender?: ReceiptEmailSender; forceEnable?: boolean },
): Promise<{ claimed: number; sent: number; failed: number; skipped: number; disabled: number }> {
  const jobs = await claimPendingReceiptEmails(limit);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let disabled = 0;
  const sender: ReceiptEmailSender =
    opts?.sender ||
    (async (params) => {
      const { sendReceiptEmail } = await import("../email");
      return sendReceiptEmail(params);
    });

  for (const job of jobs) {
    const payload = job.receipt_email_payload;
    if (!payload?.to) {
      await ack(job.payment_id, job.claim_token, "skipped", "missing_to");
      skipped++;
      continue;
    }
    if (!opts?.forceEnable && emailDisabled()) {
      await ack(job.payment_id, job.claim_token, "disabled", "email_disabled");
      disabled++;
      continue;
    }
    try {
      const r = await sender({
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
        idempotencyKey: job.provider_key || undefined,
      });
      if (r.sent) {
        await ack(job.payment_id, job.claim_token, "sent");
        sent++;
      } else {
        await ack(job.payment_id, job.claim_token, "failed", "send_returned_false");
        failed++;
      }
    } catch (e) {
      await ack(job.payment_id, job.claim_token, "failed", (e as Error).message);
      failed++;
    }
  }
  return { claimed: jobs.length, sent, failed, skipped, disabled };
}
