/**
 * Single terminal-PAID side-effect runner shared by Verify, reverify, and
 * proof/manual accept. Keep paths identical: buyer → course finalize →
 * session bump → analytics/notify (optional).
 */
import type { Payment } from "../types";
import { tgLog } from "../telegram/log";

export type PaidSideEffectSource = "verify" | "reverify" | "staff" | "offline" | "verify_backfill";

export interface RunPaidSideEffectsOpts {
  source: PaidSideEffectSource;
  /** Skip student SMS/Telegram (bulk backfill). Course finalize still runs. */
  silentStudentNotify?: boolean;
  /** Bump portal session so Class Hub refreshes on all devices. */
  bumpSession?: boolean;
}

/**
 * After a payment row is PAID, grant downstream access + notify.
 * Idempotent: finalize short-circuits on existing receipt; notify claims once.
 */
export async function runPaidTerminalSideEffects(
  payment: Payment,
  opts: RunPaidSideEffectsOpts,
): Promise<{ finalized: boolean; notified: boolean }> {
  const ref = payment.reference_no || payment.id;
  let finalized = false;
  let notified = false;

  const { ensureBuyer, finalizeCoursePaymentByReference, bumpBuyerSessionVersion } = await import(
    "../dataProvider"
  );

  await ensureBuyer(payment.phone, payment.student_name).catch((e: Error) =>
    tgLog("paid_side_effects_buyer_failed", { ref, error: e.message }, "warn"),
  );

  if (payment.item_type === "course" && payment.reference_no) {
    try {
      const r = await finalizeCoursePaymentByReference(payment.reference_no);
      finalized = !!r;
      if (!r) {
        tgLog(
          "paid_side_effects_finalize_noop",
          {
            ref,
            enrollment_id: payment.enrollment_id ?? null,
            payment_kind: payment.payment_kind ?? null,
          },
          "warn",
        );
      }
    } catch (e) {
      tgLog("paid_side_effects_finalize_failed", { ref, error: (e as Error).message }, "error");
    }
  } else {
    finalized = payment.item_type !== "course";
  }

  if (opts.bumpSession !== false) {
    await bumpBuyerSessionVersion(payment.phone).catch(() => null);
  }

  // Stop access/installment reminder automation the moment money clears.
  try {
    const { stopRemindersOnPaid } = await import("../accessActions");
    await stopRemindersOnPaid({
      phone: payment.phone,
      enrollmentId: payment.enrollment_id ?? null,
      courseId: null,
    });
  } catch (e) {
    tgLog("paid_side_effects_stop_reminders_failed", { ref, error: (e as Error).message }, "warn");
  }

  if (opts.silentStudentNotify) {
    const { supersedeUnpaidSiblings } = await import("../paymentSupersede");
    const { recordPaymentStatusChanged } = await import("../analytics/server");
    await recordPaymentStatusChanged(payment, "PAID", opts.source).catch(() => {});
    void supersedeUnpaidSiblings(payment).catch(() => {});
    return { finalized, notified: false };
  }

  try {
    const { recordPaymentPaid } = await import("../analytics/server");
    await recordPaymentPaid(payment, opts.source);
  } catch (e) {
    tgLog("paid_side_effects_analytics_failed", { ref, error: (e as Error).message }, "warn");
  }

  try {
    const { notifyPaymentConfirmedOnce } = await import("./confirmOnce");
    notified = await notifyPaymentConfirmedOnce(payment);
  } catch (e) {
    tgLog("paid_side_effects_notify_failed", { ref, error: (e as Error).message }, "warn");
  }

  return { finalized, notified };
}
