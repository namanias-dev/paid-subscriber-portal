"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  CalendarClock,
  Wallet,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Lock,
} from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";
import {
  resolveEmiConfig,
  effectiveSeatAmount,
  buildSchedule,
  buildFullSchedule,
} from "@/lib/installments";
import type { Course, InstallmentItem } from "@/lib/types";

export default function CheckoutClient({ course }: { course: Course }) {
  const cfg = useMemo(() => resolveEmiConfig(course), [course]);
  const total = Math.max(0, Math.round(course.price));

  const emiAvailable = cfg.enabled && total > 1 && cfg.installmentCounts.length > 0;
  const fullAvailable = !cfg.enabled || cfg.allowFull;

  const [mode, setMode] = useState<"full" | "emi">(fullAvailable ? "full" : "emi");
  const [count, setCount] = useState<number>(cfg.installmentCounts[Math.min(1, cfg.installmentCounts.length - 1)] || cfg.installmentCounts[0] || 6);

  const seatFloor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
  const [seatInput, setSeatInput] = useState<number>(cfg.seatAmount ?? seatFloor);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const seat = useMemo(
    () => effectiveSeatAmount(cfg, total, cfg.allowCustomSeat ? seatInput : null),
    [cfg, total, seatInput]
  );

  const schedule: InstallmentItem[] = useMemo(() => {
    if (mode === "full") return buildFullSchedule(total);
    return buildSchedule({
      total,
      seatAmount: seat,
      count,
      bookingISO: new Date().toISOString(),
      firstIntervalDays: cfg.firstIntervalDays,
      intervalMonths: cfg.intervalMonths,
    });
  }, [mode, total, seat, count, cfg]);

  const todayAmount = mode === "full" ? total : seat;
  const remaining = total - todayAmount;
  const installmentLines = schedule.filter((s) => s.kind === "installment");
  const grandTotal = schedule.reduce((a, s) => a + s.amount, 0);

  const seatTooLow = cfg.allowCustomSeat && seatInput < seatFloor;
  const seatTooHigh = seatInput >= total;

  async function proceed() {
    setError(null);
    if (!name.trim() || !/^\d{10}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile number.");
      setDetailsOpen(true);
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }
    if (mode === "emi" && (seatTooLow || seatTooHigh)) {
      setError("Please choose a valid seat-booking amount.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/enroll/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseSlug: course.slug,
          name: name.trim(),
          email: email.trim(),
          mobile: phone,
          mode,
          installmentCount: mode === "emi" ? count : undefined,
          seatAmount: mode === "emi" && cfg.allowCustomSeat ? seatInput : undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok || !json.paymentUrl) {
        setError(json.error || "Could not start payment.");
        setLoading(false);
        return;
      }
      window.location.href = json.paymentUrl;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const payLabel = `Pay ${formatINR(todayAmount)} now`;

  return (
    <div className="bg-[var(--ca-slate-50)] pb-28 lg:pb-16">
      <div className="container-wide pt-6">
        <Link href={`/courses/${course.slug}`} className="ca-focus inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ca-navy-600)] hover:text-[var(--ca-navy-900)]">
          <ArrowLeft size={16} /> Back to course
        </Link>
      </div>

      <div className="container-wide mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ---------------- LEFT: plan selector ---------------- */}
        <div className="space-y-6">
          {/* Course header */}
          <div className="ca-card overflow-hidden p-0">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="relative h-24 w-full shrink-0 overflow-hidden rounded-xl sm:h-20 sm:w-32">
                {course.image ? (
                  <Image src={course.image} alt={course.title} fill sizes="160px" className="object-cover" />
                ) : (
                  <div className="ca-dark h-full w-full" />
                )}
              </div>
              <div className="min-w-0">
                <p className="ca-eyebrow">Secure enrollment</p>
                <h1 className="mt-1 font-heading text-lg font-bold leading-snug text-[var(--ca-navy-900)] sm:text-xl">{course.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ca-slate-700)]">
                  {course.batch_start && (
                    <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> Starts {formatISTDate(course.batch_start)}</span>
                  )}
                  {course.batch_timings?.length ? <span>{course.batch_timings.join(" · ")}</span> : null}
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">GST included</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment mode selector */}
          <div>
            <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Choose how you&apos;d like to pay</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {fullAvailable && (
                <button
                  type="button"
                  onClick={() => setMode("full")}
                  className={`ca-focus relative rounded-2xl border-2 p-4 text-left transition ${mode === "full" ? "border-[var(--ca-gold)] bg-white shadow-soft-lg" : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-slate-300)]"}`}
                >
                  {cfg.bestValueNote && (
                    <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-[var(--ca-navy-900)] px-2 py-0.5 text-[10px] font-bold text-[var(--ca-gold-bright)]"><Sparkles size={11} /> {cfg.bestValueNote}</span>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 font-bold text-[var(--ca-navy-900)]"><Wallet size={18} /> Pay Full Today</span>
                    {mode === "full" && <CheckCircle2 size={18} className="text-[var(--ca-gold)]" />}
                  </div>
                  <p className="mt-2 font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(total)}</p>
                  <p className="mt-1 text-xs text-[var(--ca-slate-700)]">One payment · full access · GST included</p>
                </button>
              )}

              {emiAvailable && (
                <button
                  type="button"
                  onClick={() => setMode("emi")}
                  className={`ca-focus relative rounded-2xl border-2 p-4 text-left transition ${mode === "emi" ? "border-[var(--ca-gold)] bg-white shadow-soft-lg" : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-slate-300)]"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 font-bold text-[var(--ca-navy-900)]"><CalendarClock size={18} /> Book Your Seat + EMI</span>
                    {mode === "emi" && <CheckCircle2 size={18} className="text-[var(--ca-gold)]" />}
                  </div>
                  <p className="mt-2 font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(cfg.seatAmount ?? seatFloor)}<span className="text-sm font-semibold text-[var(--ca-slate-700)]"> to start</span></p>
                  <p className="mt-1 text-xs text-[var(--ca-slate-700)]">Secure your seat now · pay the rest in installments</p>
                </button>
              )}
            </div>
          </div>

          {/* EMI plan builder */}
          {mode === "emi" && emiAvailable && (
            <div className="ca-card space-y-5 p-5">
              <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Build your plan</h3>

              {/* Seat amount */}
              <div>
                <label className="text-sm font-semibold text-[var(--ca-navy-900)]">Book-your-seat amount</label>
                {cfg.allowCustomSeat ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">₹</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        className="w-40 rounded-xl border border-[var(--ca-slate-300)] px-3 py-2 font-semibold focus:border-[var(--ca-gold)] focus:outline-none"
                        value={seatInput}
                        min={seatFloor}
                        max={total - 1}
                        onChange={(e) => setSeatInput(Math.round(Number(e.target.value) || 0))}
                        onBlur={() => setSeatInput((v) => Math.min(total - 1, Math.max(seatFloor, v)))}
                      />
                    </div>
                    <p className={`mt-1 text-xs ${seatTooLow || seatTooHigh ? "text-red-600" : "text-[var(--ca-slate-700)]"}`}>
                      {seatTooHigh ? "Seat amount must be less than the full fee." : `Pay any amount from ${formatINR(seatFloor)}. This is deducted from your total.`}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 font-heading text-lg font-bold text-[var(--ca-navy-900)]">{formatINR(seat)} <span className="text-xs font-medium text-[var(--ca-slate-700)]">(deducted from your total)</span></p>
                )}
              </div>

              {/* Installment count */}
              <div>
                <label className="text-sm font-semibold text-[var(--ca-navy-900)]">Number of installments</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {cfg.installmentCounts.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCount(n)}
                      className={`ca-focus rounded-full border px-4 py-1.5 text-sm font-semibold transition ${count === n ? "border-[var(--ca-gold)] bg-[var(--ca-navy-900)] text-[var(--ca-gold-bright)]" : "border-[var(--ca-slate-300)] bg-white text-[var(--ca-slate-700)] hover:border-[var(--ca-slate-400)]"}`}
                    >
                      {n} months
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule preview */}
              <div className="overflow-hidden rounded-xl border border-[var(--ca-slate-200)]">
                <div className="flex items-center justify-between bg-[var(--ca-slate-50)] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--ca-slate-700)]">
                  <span>Payment schedule</span><span>{formatISTDate(new Date().toISOString())} onward · IST</span>
                </div>
                <div className="divide-y divide-[var(--ca-slate-200)]">
                  <ScheduleRow label="Today — Book Your Seat" amount={seat} due="Pay now" highlight />
                  {installmentLines.map((it) => (
                    <ScheduleRow key={it.no} label={it.label} amount={it.amount} due={`Due ${formatISTDate(it.due)}`} />
                  ))}
                </div>
              </div>
              <p className="text-xs text-[var(--ca-slate-700)]">First installment ~{cfg.firstIntervalDays} days after booking, then every {cfg.intervalMonths === 1 ? "month" : `${cfg.intervalMonths} months`}.</p>
            </div>
          )}

          {/* Your details */}
          <div className="ca-card space-y-3 p-5">
            <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Your details</h3>
            <input className="w-full rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 focus:border-[var(--ca-gold)] focus:outline-none" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="w-full rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 focus:border-[var(--ca-gold)] focus:outline-none" placeholder="10-digit mobile *" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />
            <input className="w-full rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 focus:border-[var(--ca-gold)] focus:outline-none" type="email" placeholder="Email (optional — for receipts)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-xs text-[var(--ca-slate-700)]">You&apos;ll receive a login code after payment to access your Class Hub and payment history.</p>
          </div>
        </div>

        {/* ---------------- RIGHT: sticky order summary (desktop) ---------------- */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <OrderSummary
              mode={mode}
              total={total}
              todayAmount={todayAmount}
              remaining={remaining}
              count={count}
              grandTotal={grandTotal}
              error={error}
              loading={loading}
              payLabel={payLabel}
              onPay={proceed}
            />
          </div>
        </aside>
      </div>

      {/* ---------------- MOBILE sticky bottom bar ---------------- */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ca-slate-200)] bg-white/95 backdrop-blur lg:hidden">
        {detailsOpen && (
          <div className="max-h-[50vh] overflow-y-auto border-b border-[var(--ca-slate-200)] p-4">
            <SummaryRows mode={mode} total={total} todayAmount={todayAmount} remaining={remaining} count={count} grandTotal={grandTotal} />
          </div>
        )}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button onClick={() => setDetailsOpen((v) => !v)} className="ca-focus shrink-0 text-left">
            <p className="text-[11px] leading-none text-[var(--ca-slate-400)]">Total today</p>
            <p className="inline-flex items-center gap-1 font-heading text-lg font-bold leading-tight text-[var(--ca-navy-900)]">
              {formatINR(todayAmount)} <ChevronDown size={14} className={`transition ${detailsOpen ? "rotate-180" : ""}`} />
            </p>
          </button>
          <button onClick={proceed} disabled={loading} className="ca-btn ca-btn-gold ca-focus flex-1 justify-center disabled:opacity-60">
            {loading ? "Starting…" : payLabel}
          </button>
        </div>
        {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function ScheduleRow({ label, amount, due, highlight }: { label: string; amount: number; due: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 text-sm ${highlight ? "bg-[var(--ca-gold-soft)]/30" : ""}`}>
      <div>
        <p className="font-semibold text-[var(--ca-navy-900)]">{label}</p>
        <p className="text-xs text-[var(--ca-slate-700)]">{due}</p>
      </div>
      <span className="font-heading font-bold text-[var(--ca-navy-900)]">{formatINR(amount)}</span>
    </div>
  );
}

function SummaryRows({ mode, total, todayAmount, remaining, count, grandTotal }: { mode: "full" | "emi"; total: number; todayAmount: number; remaining: number; count: number; grandTotal: number }) {
  return (
    <div className="space-y-2.5 text-sm">
      <Row label="Course fee" value={formatINR(total)} />
      {mode === "emi" && (
        <>
          <Row label="Paying today (seat)" value={formatINR(todayAmount)} strong />
          <Row label={`Remaining over ${count} installments`} value={formatINR(remaining)} />
        </>
      )}
      <div className="my-2 border-t border-dashed border-[var(--ca-slate-300)]" />
      <Row label="Total today" value={formatINR(todayAmount)} big />
      <div className="flex items-center justify-between rounded-lg bg-[var(--ca-slate-50)] px-3 py-2 text-xs">
        <span className="text-[var(--ca-slate-700)]">Grand total (GST incl.)</span>
        <span className="font-bold text-[var(--ca-navy-900)]">{formatINR(grandTotal)}</span>
      </div>
    </div>
  );
}

function OrderSummary(props: {
  mode: "full" | "emi";
  total: number;
  todayAmount: number;
  remaining: number;
  count: number;
  grandTotal: number;
  error: string | null;
  loading: boolean;
  payLabel: string;
  onPay: () => void;
}) {
  return (
    <div className="ca-card p-5">
      <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Order summary</h3>
      <div className="mt-4">
        <SummaryRows mode={props.mode} total={props.total} todayAmount={props.todayAmount} remaining={props.remaining} count={props.count} grandTotal={props.grandTotal} />
      </div>
      {props.error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{props.error}</p>}
      <button onClick={props.onPay} disabled={props.loading} className="ca-btn ca-btn-gold ca-focus mt-4 w-full justify-center disabled:opacity-60">
        {props.loading ? "Starting…" : props.payLabel}
      </button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[var(--ca-slate-700)]"><ShieldCheck size={14} className="text-emerald-600" /> Secure checkout · verified server-side</p>
      <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-[var(--ca-slate-400)]"><Lock size={11} /> Your details are never shared</p>
    </div>
  );
}

function Row({ label, value, strong, big }: { label: string; value: string; strong?: boolean; big?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${big ? "font-semibold text-[var(--ca-navy-900)]" : "text-[var(--ca-slate-700)]"}`}>{label}</span>
      <span className={`${big ? "font-heading text-xl font-extrabold text-[var(--ca-navy-900)]" : strong ? "font-bold text-[var(--ca-navy-900)]" : "font-semibold text-[var(--ca-navy-900)]"}`}>{value}</span>
    </div>
  );
}
