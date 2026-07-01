"use client";

import { AlertTriangle, CheckCircle2, CreditCard } from "lucide-react";
import { formatINR } from "@/lib/dates";

/**
 * Shared pre-redirect caution modal for EVERY gateway hand-off (course + webinar
 * + plan). Sets expectations before we send the student to ICICI Eazypay so an
 * abandoned attempt is understood to be harmless. We cannot technically block the
 * browser Back button or actions on the gateway's own page — the callback-driven
 * payment state (INITIATED → PAID/FAILED, else ABANDONED) is what actually makes
 * an unfinished attempt safe; this modal is the human-facing reassurance.
 *
 * Button styling is caller-provided so each surface keeps its own theme (portal
 * `ca-btn` vs public `btn`) while the messaging + structure stay single-sourced.
 */
export default function PaymentCautionModal({
  open,
  amount,
  itemLabel,
  confirmLabel = "Continue to payment",
  busy = false,
  onConfirm,
  onCancel,
  confirmClassName = "btn btn-primary flex-1",
  cancelClassName = "btn btn-secondary flex-1",
}: {
  open: boolean;
  amount: number;
  itemLabel: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmClassName?: string;
  cancelClassName?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <CreditCard size={18} />
          </span>
          <div>
            <h4 className="font-heading text-base font-bold text-ink">Before you pay {formatINR(amount)}</h4>
            <p className="mt-1 text-sm text-ink2">{itemLabel}</p>
          </div>
        </div>
        <ul className="mt-4 space-y-2 rounded-xl bg-surface p-3 text-sm text-ink2">
          <li className="flex gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            Please <b>don&apos;t press Back, refresh, or close</b> this page while payment is in progress.
          </li>
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            If money is deducted, wait for confirmation — or upload proof from your portal. An unfinished attempt is <b>never</b> charged.
          </li>
        </ul>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className={cancelClassName}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={confirmClassName}>
            {busy ? "Starting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
