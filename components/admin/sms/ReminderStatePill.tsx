"use client";

import { formatINR, formatISTDateTime } from "@/lib/dates";
import type { InstallmentReminderState } from "@/lib/sms/installmentAttribution";

/**
 * Reminder → payment state for ONE installment.
 *
 * WORDING IS DELIBERATE. "Paid 4d after reminder" states TIMING and nothing
 * more. It is not a claim that the reminder caused the payment, so it must never
 * be relabelled "converted", "recovered" or "reminder worked", and no revenue
 * may be attributed to a reminder here. A student who was reminded and then paid
 * may well have paid anyway.
 */
export default function ReminderStatePill({ state }: { state: InstallmentReminderState | null }) {
  if (!state) return <span className="text-xs text-muted">—</span>;

  const hover = buildHover(state);

  switch (state.kind) {
    case "paid_after_reminder":
      return (
        <span className="pill pill-green whitespace-nowrap text-[11px]" title={hover}>
          {state.daysToPayment === 0 ? "Paid same day" : `Paid ${state.daysToPayment}d after reminder`}
        </span>
      );

    case "paid_no_reminder":
      return (
        <span className="pill whitespace-nowrap text-[11px] text-ink2" title={hover}>
          Paid (no reminder sent)
        </span>
      );

    case "reminded":
      return (
        <span className="pill pill-amber whitespace-nowrap text-[11px]" title={hover}>
          {state.reminderCount > 1
            ? `Reminded ${state.reminderCount}× · last ${state.daysSinceLastReminder}d ago`
            : `Reminded ${state.daysSinceFirstReminder}d ago`}
        </span>
      );

    case "reminded_unattributable":
      return (
        <span className="pill pill-amber whitespace-nowrap text-[11px]" title={hover}>
          {state.unattributableReason === "plan_changed"
            ? "Reminded — predates a plan change"
            : "Reminded — installment not recorded"}
        </span>
      );

    case "not_reminded":
    default:
      return <span className="pill whitespace-nowrap text-[11px] text-muted" title={hover}>Not reminded</span>;
  }
}

/** Exact timestamps, actor and remaining balance — detail without clutter. */
function buildHover(s: InstallmentReminderState): string {
  const parts: string[] = [`Installment no. ${s.installmentNo} · ${formatINR(s.amount)}`];

  if (s.firstReminderAt) {
    parts.push(`First reminder: ${formatISTDateTime(s.firstReminderAt)}`);
    if (s.lastReminderAt && s.lastReminderAt !== s.firstReminderAt) {
      parts.push(`Last reminder: ${formatISTDateTime(s.lastReminderAt)} (${s.daysSinceLastReminder}d ago)`);
    }
    if (s.lastReminderBy) parts.push(`Sent by: ${s.lastReminderBy}`);
  }

  if (s.kind === "reminded_unattributable") {
    parts.push(
      s.unattributableReason === "plan_changed"
        ? "The payment plan was restructured after this reminder went out, so it cannot be tied to a current installment without risking the wrong one."
        : "This reminder predates installment-level logging, so which installment it referred to was never recorded.",
    );
  }

  if (s.paidAt) parts.push(`Paid: ${formatISTDateTime(s.paidAt)}`);
  if (s.outstanding > 0) parts.push(`Still outstanding: ${formatINR(s.outstanding)}`);
  if (s.outstanding > 0 && s.amount > s.outstanding) {
    parts.push("Part-paid — not counted as paid until the balance reaches zero.");
  }

  return parts.join("\n");
}
