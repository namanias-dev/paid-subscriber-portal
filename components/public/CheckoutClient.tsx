"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { trackClient } from "@/lib/analytics/client";
import { ga4Event } from "@/lib/analytics/ga4";
import {
  ArrowLeft,
  ShieldCheck,
  CalendarClock,
  Wallet,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Lock,
  Tag,
  Users,
} from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";
import {
  resolveEmiConfig,
  effectiveSeatAmount,
  buildSchedule,
  buildFullSchedule,
  buildFullWithSeatSchedule,
  buildInstallmentOnlySchedule,
  payInFullTotal,
  effectiveCourseForBatch,
  batchModeLabel,
  batchTimingLabel,
} from "@/lib/installments";
import type { Course, CourseBatch, InstallmentItem } from "@/lib/types";

type Plan = "full" | "emi";

export default function CheckoutClient({ course }: { course: Course }) {
  // --- Batches (Phase 3): only a course with 2+ batches shows a selector. With
  // 0/1 batch we use the course-level fields verbatim, so single-batch/default
  // courses behave byte-for-byte exactly as before. ---
  const batches = useMemo<CourseBatch[]>(() => course.batches || [], [course.batches]);
  const multiBatch = batches.length >= 2;
  const initialBatchId = multiBatch
    ? (course.default_batch_id && batches.some((b) => b.id === course.default_batch_id) ? course.default_batch_id : batches[0].id)
    : null;
  const [batchId, setBatchId] = useState<string | null>(initialBatchId);

  // Effective course = course-level fields overridden by the chosen batch. For
  // single-batch courses (multiBatch=false) this is exactly `course`.
  const ec = useMemo(
    () => (multiBatch ? effectiveCourseForBatch(course, batchId) : course),
    [course, batchId, multiBatch]
  );

  useEffect(() => {
    trackClient("course_view", { course_id: course.id, course_slug: course.slug, course_title: course.title, price: course.price });
    // GA4 (independent, consent-gated, no PII) fires alongside the in-house tracker.
    ga4Event("course_view", { course_id: course.id, course_slug: course.slug, value: course.price, currency: "INR" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cfg = useMemo(() => resolveEmiConfig(ec), [ec]);
  const standardTotal = Math.max(0, Math.round(ec.price));
  const payInFull = useMemo(() => payInFullTotal(ec), [ec]);
  const fullSavings = Math.max(0, standardTotal - payInFull);

  const emiAvailable = cfg.enabled && standardTotal > 1 && cfg.installmentCounts.length > 0;
  const fullAvailable = !cfg.enabled || cfg.allowFull;
  const seatConfigured = cfg.enabled && (cfg.seatAmount != null || cfg.allowCustomSeat);

  const [plan, setPlan] = useState<Plan>(fullAvailable ? "full" : "emi");
  const [bookSeat, setBookSeat] = useState(false);
  const [count, setCount] = useState<number>(
    cfg.installmentCounts[Math.min(1, cfg.installmentCounts.length - 1)] || cfg.installmentCounts[0] || 6
  );

  const base = plan === "full" ? payInFull : standardTotal;
  const seatFloor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
  const [seatInput, setSeatInput] = useState<number>(cfg.seatAmount ?? seatFloor);

  // When the chosen batch changes, reset the plan/seat/installment selections to
  // that batch's defaults (its EMI config may differ). No-op for single-batch.
  useEffect(() => {
    if (!multiBatch) return;
    setPlan(fullAvailable ? "full" : "emi");
    setBookSeat(false);
    setCount(cfg.installmentCounts[Math.min(1, cfg.installmentCounts.length - 1)] || cfg.installmentCounts[0] || 6);
    setSeatInput(cfg.seatAmount ?? seatFloor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const seat = useMemo(
    () => effectiveSeatAmount(cfg, base, cfg.allowCustomSeat ? seatInput : null),
    [cfg, base, seatInput]
  );

  const bookingISO = useMemo(() => new Date().toISOString(), []);
  const seatActive = bookSeat && seatConfigured;

  const schedule: InstallmentItem[] = useMemo(() => {
    if (plan === "full") {
      return seatActive
        ? buildFullWithSeatSchedule({ payInFull, seatAmount: seat, bookingISO, firstIntervalDays: cfg.firstIntervalDays })
        : buildFullSchedule(payInFull);
    }
    return seatActive
      ? buildSchedule({ total: standardTotal, seatAmount: seat, count, bookingISO, firstIntervalDays: cfg.firstIntervalDays, intervalMonths: cfg.intervalMonths })
      : buildInstallmentOnlySchedule({ total: standardTotal, count, bookingISO, intervalMonths: cfg.intervalMonths });
  }, [plan, seatActive, payInFull, standardTotal, seat, count, cfg, bookingISO]);

  const todayItem = schedule[0];
  const laterItems = schedule.slice(1);
  const todayAmount = todayItem?.amount ?? 0;
  const grandTotal = schedule.reduce((a, s) => a + s.amount, 0);
  const remaining = grandTotal - todayAmount;

  const seatTooLow = cfg.allowCustomSeat && seatInput < seatFloor;
  const seatTooHigh = seatInput >= base;
  const seatInvalid = seatActive && (seatTooLow || seatTooHigh);

  async function proceed() {
    if (loading) return; // re-entry guard: a submit is already in flight
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
    if (seatInvalid) {
      setError("Please choose a valid seat-booking amount.");
      return;
    }
    setLoading(true);
    trackClient("click_enroll", { course_id: course.id, course_slug: course.slug, item_type: "course", price: ec.price });
    // GA4 enroll/buy click + payment_start — numeric value + currency only, no PII.
    ga4Event("course_enroll_click", { course_id: course.id, course_slug: course.slug, value: ec.price, currency: "INR" });
    ga4Event("payment_start", { item_type: "course", course_slug: course.slug, value: todayAmount, currency: "INR" });
    try {
      const res = await fetch("/api/v1/enroll/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseSlug: course.slug,
          name: name.trim(),
          email: email.trim(),
          mobile: phone,
          plan,
          bookSeat: seatActive,
          installmentCount: plan === "emi" ? count : undefined,
          seatAmount: seatActive && cfg.allowCustomSeat ? seatInput : undefined,
          // Phase 3: only sent for multi-batch courses. Server validates it belongs
          // to the course and recomputes price server-side (client price ignored).
          batchId: multiBatch ? batchId : undefined,
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
        {/* ---------------- LEFT ---------------- */}
        <div className="space-y-6">
          {/* Course header */}
          <div className="ca-card overflow-hidden p-0">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="relative h-24 w-full shrink-0 overflow-hidden rounded-xl sm:h-20 sm:w-32">
                {(course.cover_image_url || course.image) ? (
                  <Image src={(course.cover_image_url || course.image)!} alt={course.title} fill sizes="160px" className="object-cover" />
                ) : (
                  <div className="ca-dark h-full w-full" />
                )}
              </div>
              <div className="min-w-0">
                <p className="ca-eyebrow">Secure enrollment</p>
                <h1 className="mt-1 font-heading text-lg font-bold leading-snug text-[var(--ca-navy-900)] sm:text-xl">{course.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ca-slate-700)]">
                  {ec.batch_start && (
                    <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> Starts {formatISTDate(ec.batch_start)}</span>
                  )}
                  {ec.batch_timings?.length ? <span>{ec.batch_timings.join(" · ")}</span> : null}
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">GST included</span>
                </div>
              </div>
            </div>
          </div>

          {/* Batch selector — only when the course offers multiple batches */}
          {multiBatch && (
            <BatchSelector batches={batches} selectedId={batchId} onSelect={setBatchId} />
          )}

          {/* STEP A — Book your seat (modifier, works with both plans) */}
          {seatConfigured && (
            <div>
              <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]"><span className="text-[var(--ca-gold)]">Step 1.</span> Book your seat (optional)</h2>
              <button
                type="button"
                onClick={() => setBookSeat((v) => !v)}
                aria-pressed={bookSeat}
                className={`ca-focus mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-4 text-left transition ${bookSeat ? "border-[var(--ca-gold)] bg-white shadow-soft-lg" : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-slate-300)]"}`}
              >
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 font-bold text-[var(--ca-navy-900)]"><Tag size={17} /> Book your seat now</p>
                  <p className="mt-1 text-xs text-[var(--ca-slate-700)]">Pay {formatINR(cfg.seatAmount ?? seatFloor)} today to lock your spot — deducted from your total, pay the rest later.</p>
                </div>
                <span className={`grid h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition ${bookSeat ? "bg-[var(--ca-gold)]" : "bg-[var(--ca-slate-300)]"}`}>
                  <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${bookSeat ? "translate-x-5" : "translate-x-0"}`} />
                </span>
              </button>

              {/* Custom seat amount */}
              {bookSeat && cfg.allowCustomSeat && (
                <div className="mt-3 rounded-xl border border-[var(--ca-slate-200)] bg-white p-4">
                  <label className="text-sm font-semibold text-[var(--ca-navy-900)]">Seat amount</label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">₹</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="w-40 rounded-xl border border-[var(--ca-slate-300)] px-3 py-2 font-semibold focus:border-[var(--ca-gold)] focus:outline-none"
                      value={seatInput}
                      min={seatFloor}
                      max={base - 1}
                      onChange={(e) => setSeatInput(Math.round(Number(e.target.value) || 0))}
                      onBlur={() => setSeatInput((v) => Math.min(base - 1, Math.max(seatFloor, v)))}
                    />
                  </div>
                  <p className={`mt-1 text-xs ${seatTooLow || seatTooHigh ? "text-red-600" : "text-[var(--ca-slate-700)]"}`}>
                    {seatTooHigh ? "Seat amount must be less than the total." : `Pay any amount from ${formatINR(seatFloor)}.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP B — payment plan */}
          <div>
            <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">
              {seatConfigured ? <span className="text-[var(--ca-gold)]">Step 2. </span> : null}Choose your payment plan
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {fullAvailable && (
                <button
                  type="button"
                  onClick={() => setPlan("full")}
                  className={`ca-focus relative rounded-2xl border-2 p-4 text-left transition ${plan === "full" ? "border-[var(--ca-gold)] bg-white shadow-soft-lg" : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-slate-300)]"}`}
                >
                  {fullSavings > 0 && (
                    <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-[#16a34a] px-2 py-0.5 text-[10px] font-bold text-white"><Sparkles size={11} /> Save {formatINR(fullSavings)}</span>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 font-bold text-[var(--ca-navy-900)]"><Wallet size={18} /> Pay in Full</span>
                    {plan === "full" && <CheckCircle2 size={18} className="text-[var(--ca-gold)]" />}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(payInFull)}</span>
                    {fullSavings > 0 && <span className="text-sm text-[var(--ca-slate-400)] line-through">{formatINR(standardTotal)}</span>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--ca-slate-700)]">Best price · full access · GST included</p>
                </button>
              )}

              {emiAvailable && (
                <button
                  type="button"
                  onClick={() => setPlan("emi")}
                  className={`ca-focus relative rounded-2xl border-2 p-4 text-left transition ${plan === "emi" ? "border-[var(--ca-gold)] bg-white shadow-soft-lg" : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-slate-300)]"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 font-bold text-[var(--ca-navy-900)]"><CalendarClock size={18} /> EMI / Installments</span>
                    {plan === "emi" && <CheckCircle2 size={18} className="text-[var(--ca-gold)]" />}
                  </div>
                  <p className="mt-2 font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(standardTotal)}</p>
                  <p className="mt-1 text-xs text-[var(--ca-slate-700)]">Spread the standard fee over easy monthly payments</p>
                </button>
              )}
            </div>

            {/* Transparent comparison */}
            {fullAvailable && emiAvailable && fullSavings > 0 && (
              <p className="mt-3 rounded-xl bg-[rgba(212,175,55,0.10)] px-4 py-2.5 text-sm text-[#8a6d12]">
                <b>Pay in full and save {formatINR(fullSavings)}</b> ({formatINR(payInFull)}) vs <b>pay over time</b> ({formatINR(standardTotal)} via EMI). All prices GST-inclusive.
              </p>
            )}
          </div>

          {/* EMI installment count */}
          {plan === "emi" && emiAvailable && (
            <div className="ca-card space-y-3 p-5">
              <label className="text-sm font-semibold text-[var(--ca-navy-900)]">Number of installments</label>
              <div className="flex flex-wrap gap-2">
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
          )}

          {/* Schedule preview */}
          <div className="ca-card p-5">
            <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Payment schedule</h3>
            <div className="mt-3 overflow-hidden rounded-xl border border-[var(--ca-slate-200)]">
              <div className="flex items-center justify-between bg-[var(--ca-slate-50)] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--ca-slate-700)]">
                <span>{formatISTDate(bookingISO)} onward</span><span>IST</span>
              </div>
              <div className="divide-y divide-[var(--ca-slate-200)]">
                <ScheduleRow label={todayItem?.label || "Payment"} amount={todayAmount} due="Pay now" highlight />
                {laterItems.map((it) => (
                  <ScheduleRow key={it.no} label={it.label} amount={it.amount} due={it.due ? `Due ${formatISTDate(it.due)}` : "Later"} />
                ))}
              </div>
            </div>
            {plan === "emi" && (
              <p className="mt-2 text-xs text-[var(--ca-slate-700)]">
                {seatActive
                  ? `First installment ~${cfg.firstIntervalDays} days after booking, then every ${cfg.intervalMonths === 1 ? "month" : `${cfg.intervalMonths} months`}.`
                  : `First installment today, then every ${cfg.intervalMonths === 1 ? "month" : `${cfg.intervalMonths} months`}.`}
              </p>
            )}
          </div>

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
              plan={plan}
              seatActive={seatActive}
              base={base}
              todayAmount={todayAmount}
              remaining={remaining}
              laterCount={laterItems.length}
              grandTotal={grandTotal}
              fullSavings={fullSavings}
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
            <SummaryRows plan={plan} seatActive={seatActive} base={base} todayAmount={todayAmount} remaining={remaining} laterCount={laterItems.length} grandTotal={grandTotal} fullSavings={fullSavings} />
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

/** Multi-batch picker. Choosing a batch updates price/start/seats via the parent's effective course. */
function BatchSelector({ batches, selectedId, onSelect }: { batches: CourseBatch[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div>
      <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Choose your batch</h2>
      <p className="mt-1 text-xs text-[var(--ca-slate-700)]">Pick a batch — the price, start date and seats update to match your choice.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {batches.map((b) => {
          const selected = b.id === selectedId;
          const std = Math.max(0, Math.round(b.price || 0));
          const pif = payInFullTotal({ price: b.price, pay_in_full_price: b.pay_in_full_price });
          const anchor = b.original_price && b.original_price > std ? Math.round(b.original_price) : null;
          const modeTiming = [batchModeLabel(b), batchTimingLabel(b)].filter(Boolean).join(" · ");
          const title = b.label || modeTiming || "Batch";
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b.id)}
              aria-pressed={selected}
              className={`ca-focus relative rounded-2xl border-2 p-4 text-left transition ${selected ? "border-[var(--ca-gold)] bg-white shadow-soft-lg" : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-slate-300)]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[var(--ca-navy-900)]">{title}</span>
                {selected && <CheckCircle2 size={18} className="text-[var(--ca-gold)]" />}
              </div>
              {b.label && modeTiming && <p className="mt-0.5 text-xs text-[var(--ca-slate-700)]">{modeTiming}</p>}
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-heading text-xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(pif)}</span>
                {anchor && <span className="text-sm text-[var(--ca-slate-400)] line-through">{formatINR(anchor)}</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ca-slate-700)]">
                {b.start_date && <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> Starts {formatISTDate(b.start_date)}</span>}
                {b.seats_left != null && <span className="inline-flex items-center gap-1"><Users size={12} /> {b.seats_left} seats left</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleRow({ label, amount, due, highlight }: { label: string; amount: number; due: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 text-sm ${highlight ? "bg-[rgba(212,175,55,0.12)]" : ""}`}>
      <div>
        <p className="font-semibold text-[var(--ca-navy-900)]">{label}</p>
        <p className="text-xs text-[var(--ca-slate-700)]">{due}</p>
      </div>
      <span className="font-heading font-bold text-[var(--ca-navy-900)]">{formatINR(amount)}</span>
    </div>
  );
}

interface SummaryProps {
  plan: Plan;
  seatActive: boolean;
  base: number;
  todayAmount: number;
  remaining: number;
  laterCount: number;
  grandTotal: number;
  fullSavings: number;
}

function SummaryRows(p: SummaryProps) {
  const baseLabel = p.plan === "full" ? "Pay-in-full price" : "Course fee";
  return (
    <div className="space-y-2.5 text-sm">
      <Row label={baseLabel} value={formatINR(p.base)} />
      {p.plan === "full" && p.fullSavings > 0 && <Row label="You save" value={`− ${formatINR(p.fullSavings)}`} success />}
      {p.seatActive && (
        <>
          <Row label="Seat today" value={formatINR(p.todayAmount)} strong />
          <Row label={p.laterCount > 1 ? `Remaining over ${p.laterCount} installments` : "Remaining balance"} value={formatINR(p.remaining)} />
        </>
      )}
      {!p.seatActive && p.plan === "emi" && (
        <>
          <Row label="Installment today" value={formatINR(p.todayAmount)} strong />
          <Row label={`Remaining over ${p.laterCount} installments`} value={formatINR(p.remaining)} />
        </>
      )}
      <div className="my-2 border-t border-dashed border-[var(--ca-slate-300)]" />
      <Row label="Total today" value={formatINR(p.todayAmount)} big />
      <div className="flex items-center justify-between rounded-lg bg-[var(--ca-slate-50)] px-3 py-2 text-xs">
        <span className="text-[var(--ca-slate-700)]">Grand total (GST incl.)</span>
        <span className="font-bold text-[var(--ca-navy-900)]">{formatINR(p.grandTotal)}</span>
      </div>
    </div>
  );
}

function OrderSummary(props: SummaryProps & { error: string | null; loading: boolean; payLabel: string; onPay: () => void }) {
  return (
    <div className="ca-card p-5">
      <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Order summary</h3>
      <div className="mt-4">
        <SummaryRows {...props} />
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

function Row({ label, value, strong, big, success }: { label: string; value: string; strong?: boolean; big?: boolean; success?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${big ? "font-semibold text-[var(--ca-navy-900)]" : "text-[var(--ca-slate-700)]"}`}>{label}</span>
      <span className={`${big ? "font-heading text-xl font-extrabold text-[var(--ca-navy-900)]" : success ? "font-bold text-[#16a34a]" : strong ? "font-bold text-[var(--ca-navy-900)]" : "font-semibold text-[var(--ca-navy-900)]"}`}>{value}</span>
    </div>
  );
}
