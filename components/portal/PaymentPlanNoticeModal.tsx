"use client";

import { useState } from "react";
import { Sparkles, CalendarClock, Wallet, ArrowRight, X } from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";

export interface PlanChangeNotice {
  enrollmentId: string;
  courseTitle: string;
  plan: string | null;
  previousPlan: string | null;
  paid: number;
  outstanding: number;
  nextAmount: number | null;
  nextDue: string | null;
}

/**
 * One-time premium full-page notice shown to the affected student after an admin
 * changes their payment plan. Acknowledging (either button) marks it seen so it
 * never repeats — until the plan changes again.
 */
export default function PaymentPlanNoticeModal({ notice }: { notice: PlanChangeNotice }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const isCustom = notice.plan === "CUSTOM_INSTALLMENTS";
  const fromFull = notice.previousPlan === "FULL";
  const body = isCustom
    ? `Your payment plan for ${notice.courseTitle} has been updated with a custom installment schedule by the Naman IAS Academy team.`
    : fromFull
      ? `Your payment plan for ${notice.courseTitle} has been changed from Full Payment to EMI by the Naman IAS Academy team. You can now view your installment schedule and pay the upcoming installments from your portal.`
      : `Your payment plan for ${notice.courseTitle} has been updated by the Naman IAS Academy team. You can view your installment schedule and pay upcoming installments from your portal.`;

  async function ack(): Promise<void> {
    setBusy(true);
    try {
      await fetch("/api/v1/enroll/ack-plan-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId: notice.enrollmentId }),
      });
    } catch { /* best-effort */ }
  }

  async function go(href: string) {
    await ack();
    window.location.href = href;
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0a1a3f]/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* gradient header */}
        <div className="relative bg-gradient-to-br from-[#0a1a3f] via-[#15326b] to-[#1e44a0] px-6 pb-8 pt-7 text-center">
          <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#f4c84a] to-[#e0a91f] shadow-lg">
            <Sparkles size={26} className="text-[#0a1a3f]" />
          </div>
          <h2 className="mt-4 font-heading text-xl font-extrabold text-white">Your payment plan has been updated</h2>
          <p className="mt-1 text-sm text-white/75">{notice.courseTitle}</p>
        </div>

        <div className="space-y-4 px-6 py-6">
          <p className="text-sm leading-relaxed text-[#27324a]">{body}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#f4f7fc] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7a99]">Paid so far</p>
              <p className="mt-0.5 font-heading text-lg font-extrabold text-[#0a1a3f]">{formatINR(notice.paid)}</p>
            </div>
            <div className="rounded-xl bg-[#fff7e6] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a7b1f]">Outstanding</p>
              <p className="mt-0.5 font-heading text-lg font-extrabold text-[#9a7b1f]">{formatINR(notice.outstanding)}</p>
            </div>
          </div>

          {notice.nextAmount != null && (
            <div className="flex items-center gap-2 rounded-xl border border-[#e4e9f2] px-3 py-2.5 text-sm text-[#27324a]">
              <CalendarClock size={16} className="text-[#1e44a0]" />
              <span>Next installment <b>{formatINR(notice.nextAmount)}</b>{notice.nextDue ? ` · due ${formatISTDate(notice.nextDue)}` : ""}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <button
              disabled={busy}
              onClick={() => go(`/portal/course/${encodeURIComponent(notice.enrollmentId)}`)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0a1a3f] to-[#1e44a0] px-4 py-3 text-sm font-bold text-white shadow-md transition hover:opacity-95 disabled:opacity-60"
            >
              <Wallet size={16} /> View installments <ArrowRight size={15} />
            </button>
            <button
              disabled={busy}
              onClick={() => go("/portal")}
              className="inline-flex w-full items-center justify-center rounded-xl border border-[#d8deea] bg-white px-4 py-2.5 text-sm font-semibold text-[#27324a] transition hover:bg-[#f4f7fc] disabled:opacity-60"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
