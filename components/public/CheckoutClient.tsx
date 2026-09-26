"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { trackClient } from "@/lib/analytics/client";
import { ga4Event, readGaClientId } from "@/lib/analytics/ga4";
import { useGa4FormTracking } from "@/lib/analytics/ga4Form";
import { toPublicImageSrc } from "@/lib/publicMediaUrl";
import { formatINR, formatISTDate } from "@/lib/dates";
import {
  resolveEmiConfig,
  planCourseEnrollment,
  payInFullTotal,
  effectiveCourseForBatch,
} from "@/lib/installments";
import {
  analyzeBatches,
  batchAxis,
  buildEnrollmentPaymentBody,
  defaultInstallmentCount,
  resolveBatchId,
  timingsForMode,
} from "@/lib/enrollmentCheckout";
import type { Course, CourseBatch, InstallmentItem } from "@/lib/types";
import {
  BatchList,
  ChoiceCard,
  CouponAccordion,
  CourseEnrollmentSummary,
  InstallmentScheduleAccordion,
  MoneyRow,
  PayButton,
  SegmentedRadio,
  SelectedBatchSummary,
  StudentDetailsForm,
  TrustLine,
} from "@/components/public/enrollment/parts";

type Plan = "full" | "emi";

const DETAILS_DRAFT = (slug: string) => `nsa_enroll_details:${slug}`;

export default function CheckoutClient({ course, waLink = null }: { course: Course; waLink?: string | null }) {
  const batches = useMemo<CourseBatch[]>(() => course.batches || [], [course.batches]);
  const multiBatch = batches.length >= 2;
  const batchModel = useMemo(() => analyzeBatches(batches), [batches]);
  const initialBatchId = multiBatch
    ? (course.default_batch_id && batches.some((b) => b.id === course.default_batch_id) ? course.default_batch_id : batches[0].id)
    : null;
  const [batchId, setBatchId] = useState<string | null>(initialBatchId);

  const ec = useMemo(
    () => (multiBatch ? effectiveCourseForBatch(course, batchId) : course),
    [course, batchId, multiBatch],
  );

  useEffect(() => {
    trackClient("course_view", { course_id: course.id, course_slug: course.slug, course_title: course.title, price: course.price });
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

  const [plan, setPlan] = useState<Plan>(emiAvailable ? "emi" : fullAvailable ? "full" : "emi");
  const [bookSeat, setBookSeat] = useState(true);
  const [count, setCount] = useState<number>(defaultInstallmentCount(cfg.installmentCounts));

  const base = plan === "full" ? payInFull : standardTotal;
  const seatFloor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
  const [seatInput, setSeatInput] = useState<number>(cfg.seatAmount ?? seatFloor);
  const [amountOpen, setAmountOpen] = useState(false);

  useEffect(() => {
    if (!multiBatch) return;
    setPlan(emiAvailable ? "emi" : fullAvailable ? "full" : "emi");
    setBookSeat(true);
    setCount(defaultInstallmentCount(cfg.installmentCounts));
    setSeatInput(cfg.seatAmount ?? seatFloor);
    setAmountOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const formId = `course_checkout:${course.slug}`;
  const { onFocusCapture, trackSubmit } = useGa4FormTracking(formId, "Course checkout");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DETAILS_DRAFT(course.slug));
      if (!raw) return;
      sessionStorage.removeItem(DETAILS_DRAFT(course.slug));
      const draft = JSON.parse(raw) as { name?: unknown; phone?: unknown; email?: unknown };
      if (typeof draft.name === "string") setName(draft.name);
      if (typeof draft.phone === "string") setPhone(draft.phone.replace(/\D/g, "").slice(0, 10));
      if (typeof draft.email === "string") setEmail(draft.email);
    } catch { /* ignore */ }
  }, [course.slug]);

  const bookingISO = useMemo(() => new Date().toISOString(), []);
  const seatActive = bookSeat && seatConfigured;

  const planInput = useMemo(() => ({
    course: ec,
    bookSeat: seatActive,
    seatAmount: seatActive && cfg.allowCustomSeat ? seatInput : null,
    bookingISO,
    discountRupees: applied?.discount ?? 0,
  }), [ec, seatActive, cfg.allowCustomSeat, seatInput, bookingISO, applied]);

  const emiPreview = useMemo(() => {
    if (!emiAvailable) return null;
    return planCourseEnrollment({ ...planInput, plan: "emi", installmentCount: count });
  }, [emiAvailable, planInput, count]);

  const fullPreview = useMemo(() => {
    if (!fullAvailable) return null;
    return planCourseEnrollment({ ...planInput, plan: "full", installmentCount: null });
  }, [fullAvailable, planInput]);

  const plannedPreview = plan === "emi" ? emiPreview : fullPreview;
  const schedule: InstallmentItem[] = plannedPreview?.ok ? plannedPreview.plan.schedule : [];
  const todayItem = schedule[0];
  const todayAmount = todayItem?.amount ?? 0;
  const grandTotal = plannedPreview?.ok ? plannedPreview.plan.totalFee : schedule.reduce((a, s) => a + s.amount, 0);
  const remaining = Math.max(0, grandTotal - todayAmount);
  const couponDiscount = plannedPreview?.ok ? plannedPreview.plan.discountAmount : (applied?.discount ?? 0);
  const originalTotal = plannedPreview?.ok ? plannedPreview.plan.originalTotalFee : base;

  const seatTooLow = cfg.allowCustomSeat && seatInput < seatFloor;
  const seatTooHigh = seatInput >= base;
  const seatInvalid = seatActive && (seatTooLow || seatTooHigh);

  const offerAmount = seatActive && !seatInvalid ? todayAmount : null;

  const selectedBatch = multiBatch ? batches.find((b) => b.id === batchId) ?? null : null;
  const selectedAxis = selectedBatch && batchModel.kind === "matrix" ? batchAxis(selectedBatch) : null;
  const visibleTimings = batchModel.kind === "matrix" && selectedAxis
    ? timingsForMode(batchModel, selectedAxis.mode)
    : [];

  const firstInstallment = schedule.find((item) => item.kind === "installment" && item.due);
  const installmentLines = schedule.filter((item) => item.kind === "installment").length;
  const emiPlanTotal = emiPreview?.ok ? emiPreview.plan.totalFee : standardTotal;
  const fullPlanTotal = fullPreview?.ok ? fullPreview.plan.totalFee : payInFull;
  const saveVsInstallments = Math.max(0, emiPlanTotal - fullPlanTotal);

  const payLabel = seatActive
    ? `Reserve My Seat for ${formatINR(todayAmount)}`
    : `Pay ${formatINR(todayAmount)} Securely`;

  function chooseBatch(id: string) {
    if (!id || id === batchId) return;
    setBatchId(id);
    trackClient("batch_selected", { course_id: course.id, course_slug: course.slug, batch_id: id });
  }

  function chooseMode(mode: string) {
    if (batchModel.kind !== "matrix" || !selectedAxis) return;
    const id = resolveBatchId(batchModel, mode, selectedAxis.timing);
    if (id) chooseBatch(id);
  }

  function chooseTiming(timing: string) {
    if (batchModel.kind !== "matrix" || !selectedAxis) return;
    const id = resolveBatchId(batchModel, selectedAxis.mode, timing);
    if (id) chooseBatch(id);
  }

  function choosePlan(next: Plan) {
    if (next === plan) return;
    setPlan(next);
    setScheduleOpen(false);
    trackClient(next === "emi" ? "installments_selected" : "pay_in_full_selected", {
      course_id: course.id,
      course_slug: course.slug,
    });
  }

  function chooseSeat(on: boolean) {
    if (on === bookSeat) return;
    setBookSeat(on);
    if (on) {
      trackClient("seat_booking_selected", { course_id: course.id, course_slug: course.slug });
    }
  }

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) {
      setCouponError("Enter a coupon code.");
      return;
    }
    setCouponLoading(true);
    setCouponError(null);
    try {
      const res = await fetch("/api/v1/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: "course", slug: course.slug, code }),
      });
      const data = await res.json();
      if (!data.ok) {
        setApplied(null);
        setCouponError(data.error || "Invalid coupon.");
        return;
      }
      setApplied({ code: data.code, discount: data.discount });
      setCouponError(null);
    } catch {
      setApplied(null);
      setCouponError("Could not validate coupon. Try again.");
    } finally {
      setCouponLoading(false);
    }
  }

  function removeCoupon() {
    setApplied(null);
    setCouponInput("");
    setCouponError(null);
  }

  async function proceed() {
    if (loading || submitting.current) return;
    setError(null);
    if (!name.trim() || !/^\d{10}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile number.");
      document.getElementById("enrollment-details")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (!plannedPreview?.ok) {
      setError(plannedPreview?.error || "This payment plan is not available.");
      return;
    }
    submitting.current = true;
    setLoading(true);
    trackClient("click_enroll", { course_id: course.id, course_slug: course.slug, item_type: "course", price: ec.price });
    const productType = seatActive ? "seat_booking" : plan === "emi" ? "installment" : "full_payment";
    let isRetry = false;
    try {
      const key = `ga4_pay_start:course:${course.slug}:${productType}`;
      isRetry = sessionStorage.getItem(key) === "1";
      sessionStorage.setItem(key, "1");
    } catch { /* ignore */ }
    trackSubmit({ product_type: productType, value: todayAmount, currency: "INR" });
    ga4Event("course_enroll_click", { course_id: course.id, course_slug: course.slug, value: ec.price, currency: "INR" });
    ga4Event(
      "payment_start",
      {
        item_type: "course",
        product_type: productType,
        course_slug: course.slug,
        value: todayAmount,
        currency: "INR",
        is_retry: isRetry,
      },
      { beacon: true },
    );
    try {
      let gaClientId: string | null = null;
      try {
        gaClientId = readGaClientId();
      } catch {
        gaClientId = null;
      }
      const res = await fetch("/api/v1/enroll/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEnrollmentPaymentBody({
          courseSlug: course.slug,
          name,
          email,
          mobile: phone,
          plan,
          bookSeat: seatActive,
          installmentCount: count,
          seatAmount: seatInput,
          allowCustomSeat: cfg.allowCustomSeat,
          multiBatch,
          batchId,
          couponCode: applied?.code,
          gaClientId,
          expectedAmount: todayAmount,
        })),
      });
      const json = await res.json();
      if (json.priceChanged) {
        try {
          sessionStorage.setItem(DETAILS_DRAFT(course.slug), JSON.stringify({ name, phone, email }));
        } catch { /* ignore */ }
        setError(json.error || "Course pricing has been updated. We've refreshed your enrollment total.");
        window.location.reload();
        return;
      }
      if (!json.ok || !json.paymentUrl) {
        setError(json.error || "Could not start payment.");
        submitting.current = false;
        setLoading(false);
        return;
      }
      window.location.href = json.paymentUrl;
    } catch {
      setError("Network error. Please try again.");
      submitting.current = false;
      setLoading(false);
    }
  }

  const image = toPublicImageSrc(course.cover_image_url || course.image);
  const cadence = cfg.intervalMonths === 1
    ? `${count} monthly payments`
    : `${count} payments, every ${cfg.intervalMonths} months`;
  const planNoun = plan === "full" ? "Pay in Full" : `${installmentLines || count} installments`;

  return (
    <div className="bg-[var(--ca-slate-50)] pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-16">
      <div className="container-wide pt-3">
        <Link href={`/courses/${course.slug}`} className="ca-focus inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ca-navy-600)]">
          Back to course
        </Link>
      </div>

      <div className="container-wide mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        <div className="overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white">
          <CourseEnrollmentSummary
            title={course.title}
            image={image}
            eyebrow={course.badge_label || course.category || null}
            startISO={ec.batch_start}
            gstIncluded={!!course.gst}
            bookingAmount={offerAmount}
            meta={ec.batch_timings?.length && !multiBatch ? ec.batch_timings.join(" · ") : null}
            showBatchHint={multiBatch}
          />

          {multiBatch && (
            <section className="border-t border-[var(--ca-slate-200)] px-4 py-4 sm:px-5">
              <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Choose your batch</h2>
              {batchModel.kind === "matrix" && selectedAxis ? (
                <div className="mt-3 space-y-3">
                  <SegmentedRadio label="How would you like to study?" options={batchModel.modes} value={selectedAxis.mode} onChange={chooseMode} />
                  <SegmentedRadio label="Choose your batch timing" options={visibleTimings} value={selectedAxis.timing} onChange={chooseTiming} />
                </div>
              ) : (
                <BatchList
                  batches={batches}
                  selectedId={batchId}
                  onSelect={chooseBatch}
                  feeOf={(batch) => ({
                    courseFee: Math.max(0, Math.round(batch.price || 0)),
                    original: batch.original_price && batch.original_price > (batch.price || 0) ? Math.round(batch.original_price) : null,
                  })}
                />
              )}
              {selectedBatch && (
                <SelectedBatchSummary
                  batch={selectedBatch}
                  courseFee={standardTotal}
                  originalPrice={ec.original_price && ec.original_price > standardTotal ? Math.round(ec.original_price) : null}
                  gstIncluded={!!course.gst}
                />
              )}
            </section>
          )}

          {waLink && (
            <div className="border-t border-[var(--ca-slate-200)] px-4 py-2 sm:px-5">
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => ga4Event("whatsapp_click", { source: "enrollment_help", page_path: `/courses/${course.slug}/enroll` })}
                className="ca-focus inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ca-navy-600)]"
              >
                Need help choosing a batch? WhatsApp us
              </a>
            </div>
          )}

          {seatConfigured && (
            <section className="border-t border-[var(--ca-slate-200)] px-4 py-4 sm:px-5">
              <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Reserve your seat</h2>
              <div role="radiogroup" aria-label="Reserve your seat" className="mt-3 space-y-2">
                <ChoiceCard
                  selected={bookSeat}
                  title={`Pay ${formatINR(seatActive && !seatInvalid ? todayAmount : (cfg.seatAmount ?? seatFloor))} today`}
                  badge="Popular"
                  onSelect={() => chooseSeat(true)}
                >
                  Adjusted against your course fee. The rest follows the payment plan you choose.
                </ChoiceCard>
                <ChoiceCard
                  selected={!bookSeat}
                  title="Start the payment plan today"
                  onSelect={() => chooseSeat(false)}
                >
                  Skip the reservation amount. Your first payment is whatever the selected plan charges today.
                </ChoiceCard>
              </div>

              {bookSeat && cfg.allowCustomSeat && (
                <div className="mt-3">
                  <button
                    type="button"
                    className="ca-focus min-h-11 text-sm font-semibold text-[var(--ca-navy-600)]"
                    aria-expanded={amountOpen}
                    aria-controls="booking-amount-editor"
                    onClick={() => setAmountOpen((v) => !v)}
                  >
                    {amountOpen ? "Hide amount" : "Want to pay more today?"}
                  </button>
                  {amountOpen && (
                    <div id="booking-amount-editor" className="mt-2">
                      <label htmlFor="booking-amount" className="text-sm font-semibold text-[var(--ca-navy-900)]">
                        Today&apos;s amount
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-heading text-lg font-bold text-[var(--ca-navy-900)]" aria-hidden="true">₹</span>
                        <input
                          id="booking-amount"
                          type="number"
                          inputMode="numeric"
                          aria-invalid={seatInvalid}
                          className="w-40 rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 text-base font-semibold focus:border-[var(--ca-gold)] focus:outline-none"
                          value={seatInput}
                          min={seatFloor}
                          max={Math.max(seatFloor, base - 1)}
                          onChange={(e) => {
                            const next = Math.round(Number(e.target.value) || 0);
                            setSeatInput(next);
                          }}
                          onBlur={() => {
                            setSeatInput((v) => {
                              const clamped = Math.min(base - 1, Math.max(seatFloor, v));
                              if (clamped !== (cfg.seatAmount ?? seatFloor)) {
                                trackClient("booking_amount_changed", {
                                  course_id: course.id,
                                  course_slug: course.slug,
                                  amount: clamped,
                                });
                              }
                              return clamped;
                            });
                          }}
                        />
                      </div>
                      <p className={`mt-1 text-xs ${seatInvalid ? "text-red-600" : "text-[var(--ca-slate-700)]"}`} role={seatInvalid ? "alert" : undefined}>
                        {seatTooHigh ? "Amount must stay below the selected plan total." : `Minimum ${formatINR(seatFloor)}. This replaces the reservation amount due today.`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {(emiAvailable || fullAvailable) && (
            <section className="border-t border-[var(--ca-slate-200)] px-4 py-4 sm:px-5">
              <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">
                {seatActive ? "How would you like to pay the balance?" : "How would you like to pay?"}
              </h2>
              <div role="radiogroup" aria-label="Payment plan" className="mt-3 space-y-2">
                {emiAvailable && (
                  <ChoiceCard
                    selected={plan === "emi"}
                    title="Installments"
                    badge="Popular"
                    onSelect={() => choosePlan("emi")}
                  >
                    <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Plan total</span>
                    <span className="font-heading text-xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(emiPlanTotal)}</span>
                    <span className="mt-0.5 block">
                      {seatActive
                        ? `After today's reservation, the balance of this plan is split into ${cadence}.`
                        : `This plan total is split into ${cadence}.`}
                    </span>
                  </ChoiceCard>
                )}
                {fullAvailable && (
                  <ChoiceCard
                    selected={plan === "full"}
                    title="Pay in Full"
                    onSelect={() => choosePlan("full")}
                  >
                    <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Plan total</span>
                    <span className="font-heading text-xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(fullPlanTotal)}</span>
                    {saveVsInstallments > 0 && (
                      <span className="mt-0.5 block font-semibold text-[#16a34a]">
                        You save {formatINR(saveVsInstallments)} versus the installment plan total
                      </span>
                    )}
                    {saveVsInstallments <= 0 && <span className="mt-0.5 block">Pay the applicable full-payment amount.</span>}
                  </ChoiceCard>
                )}
              </div>

              {plan === "emi" && emiAvailable && cfg.installmentCounts.length > 1 && (
                <div className="mt-3">
                  <p className="text-sm font-semibold text-[var(--ca-navy-900)]">Number of installments</p>
                  <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Number of installments">
                    {cfg.installmentCounts.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={count === n}
                        onClick={() => setCount(n)}
                        className={`ca-focus min-h-11 rounded-full border px-4 text-sm font-semibold ${
                          count === n
                            ? "border-[var(--ca-gold)] bg-[var(--ca-navy-900)] text-[var(--ca-gold-bright)]"
                            : "border-[var(--ca-slate-300)] bg-white text-[var(--ca-slate-700)]"
                        }`}
                      >
                        {n} payments
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-1.5 rounded-xl bg-[var(--ca-slate-50)] px-3 py-3" aria-live="polite">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Selected</p>
                <p className="font-semibold text-[var(--ca-navy-900)]">{planNoun}</p>
                <MoneyRow label="Pay today" value={formatINR(todayAmount)} strong />
                <MoneyRow label="Plan total" value={formatINR(grandTotal)} />
                <MoneyRow label="Remaining balance" value={formatINR(remaining)} />
                {plan === "full" && fullSavings > 0 && !applied && (
                  <MoneyRow label="You save versus installments" value={formatINR(fullSavings)} save />
                )}
                {applied && couponDiscount > 0 && (
                  <MoneyRow label={`Coupon ${applied.code}`} value={`− ${formatINR(couponDiscount)}`} save />
                )}
                {applied && (
                  <p className="text-xs text-[var(--ca-slate-700)]">Plan total before coupon {formatINR(originalTotal)}.</p>
                )}
                {firstInstallment?.due && (
                  <p className="text-xs text-[var(--ca-slate-700)]">
                    First installment {formatINR(firstInstallment.amount)} due {formatISTDate(firstInstallment.due)}.
                  </p>
                )}
                {seatActive && (
                  <p className="text-xs text-[var(--ca-slate-700)]">
                    Today&apos;s {formatINR(todayAmount)} is part of the {formatINR(grandTotal)} plan total, not a separate fee.
                  </p>
                )}
              </div>

              {schedule.length > 0 && (
                <InstallmentScheduleAccordion
                  open={scheduleOpen}
                  onToggle={() => {
                    setScheduleOpen((open) => {
                      if (!open) {
                        trackClient("installment_schedule_expanded", { course_id: course.id, course_slug: course.slug });
                      }
                      return !open;
                    });
                  }}
                  schedule={schedule}
                  bookingISO={bookingISO}
                />
              )}

              {plan === "full" && seatActive && fullPreview?.ok && (
                <button
                  type="button"
                  className="ca-focus mt-3 min-h-11 text-left text-sm font-semibold text-[var(--ca-navy-600)]"
                  onClick={() => chooseSeat(false)}
                >
                  Pay the full {formatINR(fullPlanTotal)} today instead
                </button>
              )}
            </section>
          )}

          <div className="border-t border-[var(--ca-slate-200)]">
            <StudentDetailsForm
              name={name}
              phone={phone}
              email={email}
              onName={setName}
              onPhone={setPhone}
              onEmail={setEmail}
              onFocusCapture={onFocusCapture}
              error={error}
            />
          </div>

          <div className="border-t border-[var(--ca-slate-200)]">
            <CouponAccordion
              open={couponOpen}
              onToggle={() => {
                setCouponOpen((open) => {
                  if (!open) trackClient("coupon_opened", { course_id: course.id, course_slug: course.slug });
                  return !open;
                });
              }}
              applied={applied}
              discountLabel={couponDiscount > 0 ? `− ${formatINR(couponDiscount)} off the plan total` : null}
              input={couponInput}
              onInput={setCouponInput}
              onApply={() => void applyCoupon()}
              onRemove={removeCoupon}
              loading={couponLoading}
              error={couponError}
            />
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-2xl border border-[var(--ca-slate-200)] bg-white p-5">
            <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Enrollment summary</h2>
            <div className="mt-3 space-y-2">
              {selectedBatch && <MoneyRow label="Batch" value={[selectedAxis?.mode, selectedAxis?.timing].filter(Boolean).join(" · ") || selectedBatch.label || "Selected"} />}
              <MoneyRow label="Plan" value={plan === "emi" ? "Installments" : "Pay in Full"} />
              <MoneyRow label="Plan total" value={formatINR(grandTotal)} />
              <MoneyRow label="Pay today" value={formatINR(todayAmount)} strong />
              <MoneyRow label="Remaining balance" value={formatINR(remaining)} />
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-4">
              <PayButton label={payLabel} loading={loading} disabled={seatInvalid} onClick={() => void proceed()} />
            </div>
            <TrustLine />
            {course.gst && <p className="mt-1 text-center text-[11px] text-[var(--ca-slate-700)]">GST included</p>}
          </div>
        </aside>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ca-slate-200)] bg-white lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 shrink-0" aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Today</p>
            <p className="font-heading text-lg font-extrabold leading-tight text-[var(--ca-navy-900)]">{formatINR(todayAmount)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <PayButton label={seatActive ? "Reserve My Seat" : `Pay ${formatINR(todayAmount)} Securely`} loading={loading} disabled={seatInvalid} onClick={() => void proceed()} />
          </div>
        </div>
        {error && <p role="alert" className="px-4 pb-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
