"use client";

import type { KeyboardEvent, ReactNode } from "react";
import Image from "next/image";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";
import type { CourseBatch, InstallmentItem } from "@/lib/types";
import { batchModeLabel, batchTimingLabel } from "@/lib/installments";
import { batchChoiceLabel, batchLabelAddsDetail } from "@/lib/enrollmentCheckout";

export function SegmentedRadio({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const groupId = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  function onKeyDown(e: KeyboardEvent) {
    const i = Math.max(0, options.indexOf(value));
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(options[(i + 1) % options.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(options[(i - 1 + options.length) % options.length]);
    }
  }
  return (
    <div>
      <p id={`${groupId}-label`} className="text-sm font-semibold text-[var(--ca-navy-900)]">{label}</p>
      <div
        role="radiogroup"
        aria-labelledby={`${groupId}-label`}
        className="mt-2 flex flex-wrap gap-2"
        onKeyDown={onKeyDown}
      >
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt)}
              className={`ca-focus inline-flex min-h-12 min-w-[46%] flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none ${
                selected
                  ? "border-[var(--ca-gold)] bg-[rgba(212,175,55,0.14)] text-[var(--ca-navy-900)]"
                  : "border-[var(--ca-slate-200)] bg-white text-[var(--ca-slate-700)]"
              }`}
            >
              {selected && <Check size={16} aria-hidden="true" className="text-[var(--ca-gold-dark)]" />}
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CourseEnrollmentSummary({
  title,
  image,
  eyebrow,
  startISO,
  gstIncluded,
  proposition,
  meta,
}: {
  title: string;
  image?: string | null;
  eyebrow: string | null;
  startISO: string | null;
  gstIncluded: boolean;
  proposition: { kind: "reserve" | "payFull" | "payToday"; amount: number } | null;
  meta: string | null;
}) {
  return (
    <section className="bg-white px-4 py-4 sm:px-5">
      <div className="flex gap-3">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--ca-navy-900)]">
          {image ? (
            <Image src={image} alt="" fill sizes="96px" className="object-cover" priority />
          ) : null}
        </div>
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-gold-dark)]">{eyebrow}</p>}
          <h1 className="font-heading text-lg font-bold leading-snug text-[var(--ca-navy-900)]">{title}</h1>
          <p className="mt-1 text-xs text-[var(--ca-slate-700)]">
            {[startISO ? `Starts ${formatISTDate(startISO)}` : null, gstIncluded ? "GST included" : null, meta].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {proposition && proposition.amount > 0 && (
        <div className="mt-4">
          <p className="font-heading text-xl font-extrabold leading-tight text-[var(--ca-navy-900)]">
            {proposition.kind === "reserve"
              ? `Reserve your seat today for ${formatINR(proposition.amount)}`
              : `Pay ${formatINR(proposition.amount)} today`}
          </p>
          <p className="mt-1.5 text-sm leading-snug text-[var(--ca-slate-700)]">
            {proposition.kind === "reserve" && (
              <>{formatINR(proposition.amount)} is adjusted against your installment plan. Pay the remaining balance according to your payment schedule.</>
            )}
            {proposition.kind === "payFull" && "This is the complete pay-in-full price. Nothing remains after this payment."}
            {proposition.kind === "payToday" && "This is the first installment. The rest follows the payment schedule."}
          </p>
        </div>
      )}
    </section>
  );
}

export function SelectedBatchSummary({ batch }: { batch: CourseBatch }) {
  const pair = [batchModeLabel(batch), batchTimingLabel(batch)].filter(Boolean).join(" · ");
  const title = pair || batchChoiceLabel(batch);
  const startLabel = batch.start_date ? `Starts ${formatISTDate(batch.start_date)}` : null;
  return (
    <div className="mt-3 border-t border-[var(--ca-slate-200)] pt-3" aria-live="polite">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-gold-dark)]">Selected</p>
      <p className="mt-0.5 font-semibold text-[var(--ca-navy-900)]">{title}</p>
      {batchLabelAddsDetail(batch.label, title, startLabel) && <p className="text-xs text-[var(--ca-slate-700)]">{batch.label}</p>}
      {startLabel && <p className="text-sm text-[var(--ca-slate-700)]">{startLabel}</p>}
    </div>
  );
}

export function BatchList({
  batches,
  selectedId,
  onSelect,
  feeOf,
}: {
  batches: CourseBatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  feeOf: (batch: CourseBatch) => { courseFee: number; original: number | null };
}) {
  return (
    <div role="radiogroup" aria-label="Choose your batch" className="mt-2 space-y-2">
      {batches.map((batch) => {
        const selected = batch.id === selectedId;
        const fee = feeOf(batch);
        return (
          <button
            key={batch.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(batch.id)}
            className={`ca-focus flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-200 motion-reduce:transition-none ${
              selected ? "border-[var(--ca-gold)] bg-[rgba(212,175,55,0.12)]" : "border-[var(--ca-slate-200)] bg-white"
            }`}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-semibold text-[var(--ca-navy-900)]">
                {selected && <Check size={16} aria-hidden="true" className="shrink-0 text-[var(--ca-gold-dark)]" />}
                {batchChoiceLabel(batch)}
              </span>
              {batch.start_date && <span className="mt-0.5 block text-xs text-[var(--ca-slate-700)]">Starts {formatISTDate(batch.start_date)}</span>}
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Installment plan</span>
              <span className="font-heading font-bold text-[var(--ca-navy-900)]">{formatINR(fee.courseFee)}</span>
              {fee.original != null && fee.original > fee.courseFee && (
                <span className="block text-xs text-[var(--ca-slate-400)]">
                  <span className="sr-only">Original price </span>
                  <span className="line-through">{formatINR(fee.original)}</span>
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChoiceCard({
  selected,
  title,
  badge,
  amount,
  onSelect,
  children,
}: {
  selected: boolean;
  title: string;
  badge?: string | null;
  amount: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`ca-focus w-full rounded-xl border px-3 py-3 text-left transition-colors duration-200 motion-reduce:transition-none ${
        selected ? "border-[var(--ca-gold)] bg-[rgba(212,175,55,0.1)]" : "border-[var(--ca-slate-200)] bg-white"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ca-navy-900)]">
          {selected && <Check size={16} aria-hidden="true" className="text-[var(--ca-gold-dark)]" />}
          {title}
        </span>
        {badge && (
          <span className="rounded-full bg-[var(--ca-navy-900)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ca-gold-bright)]">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-1 block font-heading text-lg font-extrabold leading-tight text-[var(--ca-navy-900)]">{amount}</span>
      <span className="mt-1 block text-sm leading-snug text-[var(--ca-slate-700)]">{children}</span>
    </button>
  );
}

export function InstallmentScheduleAccordion({
  open,
  onToggle,
  schedule,
  bookingISO,
}: {
  open: boolean;
  onToggle: () => void;
  schedule: InstallmentItem[];
  bookingISO: string;
}) {
  const panelId = "installment-schedule-panel";
  return (
    <div className="mt-3">
      <button
        type="button"
        className="ca-focus inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--ca-navy-600)]"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {open ? "Hide payment schedule" : "View full payment schedule"}
        <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={panelId}
        role="region"
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <ul className="mt-2 divide-y divide-[var(--ca-slate-200)] rounded-xl border border-[var(--ca-slate-200)]">
            {schedule.map((item) => (
              <li key={`${item.kind}-${item.no}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span>
                  <span className="block font-semibold text-[var(--ca-navy-900)]">{item.label}</span>
                  <span className="text-xs text-[var(--ca-slate-700)]">
                    {item.due ? `Due ${formatISTDate(item.due)}` : `Pay now · ${formatISTDate(bookingISO)}`}
                  </span>
                </span>
                <span className="font-heading font-bold text-[var(--ca-navy-900)]">{formatINR(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function StudentDetailsForm({
  name,
  phone,
  email,
  onName,
  onPhone,
  onEmail,
  onFocusCapture,
  error,
}: {
  name: string;
  phone: string;
  email: string;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onEmail: (v: string) => void;
  onFocusCapture: () => void;
  error: string | null;
}) {
  const phoneInvalid = !!error && /mobile|name/i.test(error);
  const emailInvalid = !!error && /email/i.test(error);
  return (
    <section className="bg-white px-4 py-4 sm:px-5" onFocusCapture={onFocusCapture} id="enrollment-details">
      <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Your details</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-sm font-semibold text-[var(--ca-navy-900)]" htmlFor="enroll-name">
          Full name
          <input
            id="enroll-name"
            name="name"
            autoComplete="name"
            className="mt-1 w-full scroll-mb-[calc(var(--checkout-paybar-height,5.5rem)+1rem)] rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 text-base font-medium focus:border-[var(--ca-gold)] focus:outline-none"
            value={name}
            onChange={(e) => onName(e.target.value)}
            onFocus={onFocusCapture}
          />
        </label>
        <label className="block text-sm font-semibold text-[var(--ca-navy-900)]" htmlFor="enroll-phone">
          Mobile number
          <input
            id="enroll-phone"
            name="tel"
            autoComplete="tel-national"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-invalid={phoneInvalid}
            aria-describedby={phoneInvalid ? "enroll-form-error" : undefined}
            className="mt-1 w-full scroll-mb-[calc(var(--checkout-paybar-height,5.5rem)+1rem)] rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 text-base font-medium focus:border-[var(--ca-gold)] focus:outline-none"
            value={phone}
            onChange={(e) => onPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          />
        </label>
        <label className="block text-sm font-semibold text-[var(--ca-navy-900)]" htmlFor="enroll-email">
          Email <span className="font-medium text-[var(--ca-slate-700)]">(optional)</span>
          <input
            id="enroll-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            aria-invalid={emailInvalid}
            className="mt-1 w-full scroll-mb-[calc(var(--checkout-paybar-height,5.5rem)+1rem)] rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 text-base font-medium focus:border-[var(--ca-gold)] focus:outline-none"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-[var(--ca-slate-700)]">You&apos;ll receive a login code after payment to access your Class Hub and payment history.</p>
      {error && (
        <p id="enroll-form-error" role="alert" className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </section>
  );
}

export function CouponAccordion({
  open,
  onToggle,
  applied,
  discountLabel,
  input,
  onInput,
  onApply,
  onRemove,
  loading,
  error,
}: {
  open: boolean;
  onToggle: () => void;
  applied: { code: string } | null;
  discountLabel: string | null;
  input: string;
  onInput: (v: string) => void;
  onApply: () => void;
  onRemove: () => void;
  loading: boolean;
  error: string | null;
}) {
  const panelId = "coupon-panel";
  return (
    <section className="bg-white px-4 py-3 sm:px-5">
      <h2 className="sr-only">Coupon</h2>
      {applied ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold text-emerald-800">{applied.code}</span>
            {discountLabel && <span className="mt-0.5 block text-xs text-emerald-700">{discountLabel}</span>}
          </p>
          <button type="button" onClick={onRemove} className="ca-focus text-xs font-semibold text-[var(--ca-navy-700)] underline-offset-2 hover:underline">
            Remove
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="ca-focus flex min-h-11 w-full items-center justify-between text-left text-sm font-semibold text-[var(--ca-navy-900)]"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
          >
            Have a coupon code?
            <ChevronDown size={16} aria-hidden="true" className={`text-[var(--ca-slate-400)] transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </button>
          <div id={panelId} aria-hidden={!open} className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <div className="flex gap-2 pt-2">
                <label className="sr-only" htmlFor="enroll-coupon">Coupon code</label>
                <input
                  id="enroll-coupon"
                  className="w-full scroll-mb-[calc(var(--checkout-paybar-height,5.5rem)+1rem)] rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 text-base uppercase focus:border-[var(--ca-gold)] focus:outline-none"
                  placeholder="Enter code"
                  value={input}
                  onChange={(e) => onInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onApply();
                    }
                  }}
                />
                <button type="button" onClick={onApply} disabled={loading} className="ca-btn ca-btn-outline ca-focus shrink-0 disabled:opacity-60">
                  {loading ? "…" : "Apply"}
                </button>
              </div>
              {error && <p role="alert" className="mt-1.5 text-xs text-red-600">{error}</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function MoneyRow({ label, value, strong, save }: { label: string; value: string; strong?: boolean; save?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[var(--ca-slate-700)]">{label}</span>
      <span className={save ? "font-bold text-[#16a34a]" : strong ? "font-heading text-lg font-extrabold text-[var(--ca-navy-900)]" : "font-semibold text-[var(--ca-navy-900)]"}>{value}</span>
    </div>
  );
}

export function PayButton({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      aria-busy={loading}
      className="ca-btn ca-btn-gold ca-focus min-h-[52px] w-full justify-center text-base disabled:opacity-60"
    >
      {loading ? "Starting…" : label}
    </button>
  );
}

export function TrustLine() {
  return (
    <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-[var(--ca-slate-700)]">
      <ShieldCheck size={14} className="text-emerald-600" aria-hidden="true" />
      Secure payment · verified before you are charged
    </p>
  );
}
