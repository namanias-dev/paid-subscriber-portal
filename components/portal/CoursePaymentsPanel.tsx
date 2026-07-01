"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  GraduationCap,
  Wallet,
  CreditCard,
} from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";
import { deriveEnrollment, installmentStatus } from "@/lib/installments";
import type { CourseEnrollment, PaymentReceipt } from "@/lib/types";
import PaymentCautionModal from "@/components/public/PaymentCautionModal";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  seat_booked: "Seat Booked",
  partially_paid: "Partially Paid",
  fully_paid: "Fully Paid",
  cancelled: "Cancelled",
};

export default function CoursePaymentsPanel({
  enrollment,
  receipts,
  classHubHref,
}: {
  enrollment: CourseEnrollment;
  receipts: PaymentReceipt[];
  classHubHref: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pre-redirect caution: an intent captured on button click, confirmed in a modal
  // before we hand the student off to the ICICI gateway.
  const [caution, setCaution] = useState<
    { action: "installment" | "full"; installmentNo?: number; key: string; label: string; amount: number } | null
  >(null);

  const d = deriveEnrollment(enrollment);
  const receiptByRef = new Map(receipts.map((r) => [r.reference_no, r]));

  function askPay(action: "installment" | "full", amount: number, label: string, installmentNo?: number, key?: string) {
    setError(null);
    setCaution({ action, installmentNo, key: key || action, label, amount });
  }

  async function pay(action: "installment" | "full", installmentNo?: number, key?: string) {
    setError(null);
    setBusy(key || action);
    setCaution(null);
    try {
      const res = await fetch("/api/v1/enroll/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId: enrollment.id, action, installmentNo }),
      });
      const json = await res.json();
      if (!json.ok || !json.paymentUrl) {
        setError(json.error || "Could not start payment.");
        setBusy(null);
        return;
      }
      window.location.href = json.paymentUrl;
    } catch {
      setError("Network error. Please try again.");
      setBusy(null);
    }
  }

  const statusTone =
    enrollment.status === "fully_paid"
      ? "bg-emerald-100 text-emerald-800"
      : d.hasOverdue
        ? "bg-red-100 text-red-700"
        : "bg-[var(--ca-gold-soft)] text-[var(--ca-navy-900)]";

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="ca-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">{enrollment.course_title}</h2>
            {enrollment.batch_label && <p className="mt-1 text-sm text-[var(--ca-slate-700)]">{enrollment.batch_label}</p>}
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>
            {STATUS_LABEL[enrollment.status] || enrollment.status}
          </span>
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-[var(--ca-navy-900)]">{formatINR(d.paid)} of {formatINR(enrollment.total_fee)} paid</span>
            <span className="text-[var(--ca-slate-700)]">{d.progressPct}%</span>
          </div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[var(--ca-slate-200)]">
            <div className="h-full rounded-full bg-gradient-to-r from-[var(--ca-gold)] to-[var(--ca-gold-bright)] transition-all" style={{ width: `${Math.min(100, d.progressPct)}%` }} />
          </div>
          {d.remaining > 0 ? (
            <p className="mt-2 text-sm text-[var(--ca-slate-700)]">Remaining balance: <b className="text-[var(--ca-navy-900)]">{formatINR(d.remaining)}</b></p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CheckCircle2 size={15} /> Course fully paid</p>
          )}
          {(enrollment.discount_amount ?? 0) > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              🎉 {formatINR(enrollment.discount_amount!)} discount applied
              {enrollment.original_total_fee ? <span className="font-normal text-[var(--ca-slate-700)]">· was {formatINR(enrollment.original_total_fee)}</span> : null}
            </p>
          )}
        </div>

        {classHubHref && (
          <Link href={classHubHref} className="ca-btn ca-btn-gold ca-focus mt-4 w-full justify-center">
            <GraduationCap size={16} /> Go to Class Hub
          </Link>
        )}
      </div>

      {/* Actions */}
      {d.remaining > 0 && (
        <div className="ca-card p-5">
          <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Make a payment</h3>
          {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {d.nextPayable && (
              <button
                onClick={() => askPay("installment", d.nextPayable!.amount, d.nextPayable!.label.replace(/ of \d+/, ""), d.nextPayable!.no, "next")}
                disabled={!!busy}
                className="ca-btn ca-btn-gold ca-focus justify-center disabled:opacity-60"
              >
                <CreditCard size={16} /> {busy === "next" ? "Starting…" : `Pay ${d.nextPayable.label.replace(/ of \d+/, "")} (${formatINR(d.nextPayable.amount)})`}
              </button>
            )}
            <button
              onClick={() => askPay("full", d.remaining, "Full remaining balance", undefined, "full")}
              disabled={!!busy}
              className="ca-btn ca-btn-outline ca-focus justify-center disabled:opacity-60"
            >
              <Wallet size={16} /> {busy === "full" ? "Starting…" : `Pay full remaining (${formatINR(d.remaining)})`}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--ca-slate-700)]">Paying the full remaining clears your balance and closes all future installments.</p>
        </div>
      )}

      {/* Schedule */}
      <div className="ca-card p-0">
        <h3 className="border-b border-[var(--ca-slate-200)] px-5 py-3.5 font-heading text-base font-bold text-[var(--ca-navy-900)]">Payment schedule</h3>
        <div className="divide-y divide-[var(--ca-slate-200)]">
          {/* Cancelled/superseded lines are hidden so an old plan's demand never lingers. */}
          {enrollment.schedule.filter((item) => item.status !== "cancelled").map((item) => {
            const st = installmentStatus(item);
            const receipt = item.reference_no ? receiptByRef.get(item.reference_no) : null;
            const waived = st === "waived";
            return (
              <div key={item.no} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon st={st} />
                    <span className="font-semibold text-[var(--ca-navy-900)]">{item.label}</span>
                  </div>
                  <p className="mt-0.5 pl-6 text-xs text-[var(--ca-slate-700)]">
                    {item.paid
                      ? `Paid${item.paid_at ? ` · ${formatISTDate(item.paid_at)}` : ""}`
                      : waived
                        ? "Waived by the academy"
                        : item.due
                          ? `Due ${formatISTDate(item.due)}`
                          : "Due now"}
                    {st === "overdue" && <span className="ml-1 font-bold text-red-600">· OVERDUE</span>}
                    {st === "due-soon" && !item.paid && <span className="ml-1 font-semibold text-amber-600">· Due soon</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`font-heading font-bold ${item.paid || waived ? "text-[var(--ca-slate-400)] line-through" : "text-[var(--ca-navy-900)]"}`}>{formatINR(item.amount)}</span>
                  {item.paid && receipt ? (
                    <Link href={`/portal/receipt/${encodeURIComponent(receipt.receipt_no)}`} className="ca-focus inline-flex items-center gap-1 rounded-lg border border-[var(--ca-slate-300)] px-2 py-1 text-xs font-semibold text-[var(--ca-navy-600)] hover:bg-[var(--ca-slate-50)]">
                      <Download size={13} /> Receipt
                    </Link>
                  ) : !item.paid && !waived && item.kind === "installment" && d.nextPayable?.no !== item.no ? (
                    <button
                      onClick={() => askPay("installment", item.amount, item.label, item.no, `i${item.no}`)}
                      disabled={!!busy}
                      className="ca-focus rounded-lg border border-[var(--ca-slate-300)] px-2.5 py-1 text-xs font-semibold text-[var(--ca-navy-600)] hover:bg-[var(--ca-slate-50)] disabled:opacity-60"
                    >
                      {busy === `i${item.no}` ? "…" : "Pay now"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment history / receipts */}
      {receipts.length > 0 && (
        <div className="ca-card p-0">
          <h3 className="border-b border-[var(--ca-slate-200)] px-5 py-3.5 font-heading text-base font-bold text-[var(--ca-navy-900)]">Payment history & receipts</h3>
          <div className="divide-y divide-[var(--ca-slate-200)]">
            {receipts.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--ca-navy-900)]">{r.payment_label}</p>
                  <p className="text-xs text-[var(--ca-slate-700)]">{formatISTDate(r.issued_at)} · <span className="font-mono">{r.receipt_no}</span></p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-heading font-bold text-[var(--ca-navy-900)]">{formatINR(r.amount)}</span>
                  <Link href={`/portal/receipt/${encodeURIComponent(r.receipt_no)}`} className="ca-focus inline-flex items-center gap-1 rounded-lg border border-[var(--ca-slate-300)] px-2 py-1 text-xs font-semibold text-[var(--ca-navy-600)] hover:bg-[var(--ca-slate-50)]">
                    <Download size={13} /> Receipt
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pre-redirect caution modal (shared with the webinar + plan flows). */}
      <PaymentCautionModal
        open={!!caution}
        amount={caution?.amount ?? 0}
        itemLabel={caution?.label ?? ""}
        busy={!!busy}
        onConfirm={() => caution && pay(caution.action, caution.installmentNo, caution.key)}
        onCancel={() => setCaution(null)}
        confirmClassName="ca-btn ca-btn-gold ca-focus flex-1 justify-center disabled:opacity-60"
        cancelClassName="ca-btn ca-btn-outline ca-focus flex-1 justify-center"
      />
    </div>
  );
}

function StatusIcon({ st }: { st: string }) {
  if (st === "paid" || st === "waived") return <CheckCircle2 size={16} className={st === "waived" ? "text-[var(--ca-slate-400)]" : "text-emerald-600"} />;
  if (st === "overdue") return <AlertTriangle size={16} className="text-red-600" />;
  return <Clock size={16} className="text-[var(--ca-slate-400)]" />;
}
