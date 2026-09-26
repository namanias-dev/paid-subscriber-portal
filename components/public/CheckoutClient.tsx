"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  publicPaymentIntent,
  resolveBatchId,
  timingsForMode,
  type PublicPaymentMethod,
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
  const emiAvailable = cfg.enabled && standardTotal > 1 && cfg.installmentCounts.length > 0;
  const fullAvailable = !cfg.enabled || cfg.allowFull;
  const seatConfigured = cfg.enabled && (cfg.seatAmount != null || cfg.allowCustomSeat);
  const defaultMethod: PublicPaymentMethod = emiAvailable ? "installments" : "full";

  const [method, setMethod] = useState<PublicPaymentMethod>(defaultMethod);
  const [count, setCount] = useState<number>(defaultInstallmentCount(cfg.installmentCounts));

  const seatFloor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
  const [seatInput, setSeatInput] = useState<number>(cfg.seatAmount ?? seatFloor);
  const [amountOpen, setAmountOpen] = useState(false);

  useEffect(() => {
    if (!multiBatch) return;
    setMethod(emiAvailable ? "installments" : "full");
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
  const paybarRef = useRef<HTMLDivElement>(null);
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
  const installmentIntent = publicPaymentIntent({
    method: "installments",
    seatConfigured,
    allowCustomSeat: cfg.allowCustomSeat,
    reservationAmount: seatInput,
  });
  const selectedIntent = publicPaymentIntent({
    method,
    seatConfigured,
    allowCustomSeat: cfg.allowCustomSeat,
    reservationAmount: seatInput,
  });
  const seatActive = method === "installments" && installmentIntent.bookSeat;

  const emiPreview = useMemo(() => {
    if (!emiAvailable) return null;
    return planCourseEnrollment({
      course: ec,
      plan: "emi",
      bookSeat: installmentIntent.bookSeat,
      seatAmount: installmentIntent.seatAmount ?? null,
      installmentCount: count,
      bookingISO,
      discountRupees: applied?.discount ?? 0,
    });
  }, [emiAvailable, ec, installmentIntent.bookSeat, installmentIntent.seatAmount, count, bookingISO, applied]);

  const fullPreview = useMemo(() => {
    if (!fullAvailable) return null;
    return planCourseEnrollment({
      course: ec,
      plan: "full",
      bookSeat: false,
      installmentCount: null,
      bookingISO,
      discountRupees: applied?.discount ?? 0,
    });
  }, [fullAvailable, ec, bookingISO, applied]);

  const plannedPreview = method === "installments" ? emiPreview : fullPreview;
  const schedule: InstallmentItem[] = plannedPreview?.ok ? plannedPreview.plan.schedule : [];
  const todayAmount = plannedPreview?.ok ? plannedPreview.plan.firstAmount : 0;
  const grandTotal = plannedPreview?.ok ? plannedPreview.plan.totalFee : 0;
  const remaining = Math.max(0, grandTotal - todayAmount);
  const couponDiscount = plannedPreview?.ok ? plannedPreview.plan.discountAmount : (applied?.discount ?? 0);
  const originalTotal = plannedPreview?.ok ? plannedPreview.plan.originalTotalFee : (method === "full" ? payInFull : standardTotal);

  const seatTooLow = seatActive && cfg.allowCustomSeat && seatInput < seatFloor;
  const seatCeiling = emiPreview?.ok ? emiPreview.plan.originalTotalFee : standardTotal;
  const seatTooHigh = seatActive && cfg.allowCustomSeat && seatInput >= seatCeiling;
  const seatInvalid = seatTooLow || seatTooHigh || (method === "installments" && !!emiPreview && !emiPreview.ok);

  const proposition = method === "full" && fullPreview?.ok
    ? { kind: "payFull" as const, amount: fullPreview.plan.firstAmount }
    : seatActive && emiPreview?.ok
      ? { kind: "reserve" as const, amount: seatInvalid ? (cfg.seatAmount ?? seatFloor) : emiPreview.plan.firstAmount }
      : method === "installments" && emiPreview?.ok
        ? { kind: "payToday" as const, amount: emiPreview.plan.firstAmount }
        : null;

  const selectedBatch = multiBatch ? batches.find((b) => b.id === batchId) ?? null : null;
  const selectedAxis = selectedBatch && batchModel.kind === "matrix" ? batchAxis(selectedBatch) : null;
  const visibleTimings = batchModel.kind === "matrix" && selectedAxis
    ? timingsForMode(batchModel, selectedAxis.mode)
    : [];

  const firstInstallment = schedule.find((item) => item.kind === "installment" && item.due);
  const emiPlanTotal = emiPreview?.ok ? emiPreview.plan.totalFee : standardTotal;
  const fullPlanTotal = fullPreview?.ok ? fullPreview.plan.totalFee : payInFull;
  const saveVsInstallments = Math.max(0, emiPlanTotal - fullPlanTotal);

  const payLabel = seatActive && !seatInvalid
    ? "Reserve My Seat"
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

  function chooseMethod(next: PublicPaymentMethod) {
    if (next === method) return;
    if (next === "installments" && !emiAvailable) return;
    if (next === "full" && !fullAvailable) return;
    setMethod(next);
    setScheduleOpen(false);
    setAmountOpen(false);
    trackClient(next === "installments" ? "installments_selected" : "pay_in_full_selected", {
      course_id: course.id,
      course_slug: course.slug,
    });
    if (next === "installments" && seatConfigured) {
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
        body: JSON.stringify({
          itemType: "course",
          slug: course.slug,
          code,
          plan: selectedIntent.plan,
          bookSeat: selectedIntent.bookSeat,
          seatAmount: selectedIntent.seatAmount,
          installmentCount: selectedIntent.plan === "emi" ? count : undefined,
          batchId: multiBatch ? batchId : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setApplied(null);
        setCouponError(data.error || "Invalid coupon.");
        return;
      }
      setApplied({ code: data.code, discount: data.discount });
      setCouponError(null);
      trackClient("coupon_applied", { course_id: course.id, course_slug: course.slug });
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
    const productType = seatActive ? "seat_booking" : method === "installments" ? "installment" : "full_payment";
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
          plan: selectedIntent.plan,
          bookSeat: selectedIntent.bookSeat,
          installmentCount: count,
          seatAmount: selectedIntent.seatAmount ?? seatInput,
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
  const laterSchedule = schedule.filter((item) => item.kind === "installment");
  const emiToday = emiPreview?.ok ? emiPreview.plan.firstAmount : (cfg.seatAmount ?? seatFloor);
  const fullToday = fullPreview?.ok ? fullPreview.plan.firstAmount : payInFull;
  const totalLabel = method === "full" ? "Pay-in-full price" : "Installment plan total";

  useLayoutEffect(() => {
    const el = paybarRef.current;
    if (!el) return;
    const apply = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--checkout-paybar-height", `${height}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--checkout-paybar-height");
    };
  }, [todayAmount, payLabel, error]);

  return (
    <div className="bg-[var(--ca-slate-50)] pb-[calc(var(--checkout-paybar-height,5.5rem)+1.25rem)] lg:pb-16">
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
            proposition={proposition}
            meta={ec.batch_timings?.length && !multiBatch ? ec.batch_timings.join(" · ") : null}
          />

          {multiBatch && (
            <section className="border-t border-[var(--ca-slate-200)] px-4 py-4 sm:px-5">
              <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">Choose your batch</h2>
              {batchModel.kind === "matrix" && selectedAxis ? (
                <div className="mt-3 space-y-3">
                  <SegmentedRadio label="How do you want to study?" options={batchModel.modes} value={selectedAxis.mode} onChange={chooseMode} />
                  <SegmentedRadio label="Choose your timing" options={visibleTimings} value={selectedAxis.timing} onChange={chooseTiming} />
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
              {selectedBatch && <SelectedBatchSummary batch={selectedBatch} />}
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
                Need help choosing a batch? Chat with us on WhatsApp
              </a>
            </div>
          )}

          {(emiAvailable || fullAvailable) && (
            <section className="border-t border-[var(--ca-slate-200)] px-4 py-4 sm:px-5">
              <h2 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">How would you like to pay?</h2>
              <div role="radiogroup" aria-label="How would you like to pay?" className="mt-3 space-y-2">
                {emiAvailable && (
                  <ChoiceCard
                    selected={method === "installments"}
                    title="Installments"
                    badge="Popular"
                    amount={`${formatINR(emiToday)} today`}
                    onSelect={() => chooseMethod("installments")}
                  >
                    <span className="block font-medium text-[var(--ca-navy-900)]">
                      {installmentIntent.bookSeat ? `Then ${cadence}` : `${cadence.charAt(0).toUpperCase()}${cadence.slice(1)}`}
                    </span>
                    <span className="mt-0.5 block">
                      {installmentIntent.bookSeat
                        ? "Reserve your seat today and pay the remaining amount over time."
                        : "Pay the first installment today. The rest follows the schedule."}
                    </span>
                  </ChoiceCard>
                )}
                {fullAvailable && (
                  <ChoiceCard
                    selected={method === "full"}
                    title="Pay in Full"
                    amount={`${formatINR(fullToday)} today`}
                    onSelect={() => chooseMethod("full")}
                  >
                    {saveVsInstallments > 0 && (
                      <span className="block font-semibold text-[#16a34a]">Save {formatINR(saveVsInstallments)} vs installments</span>
                    )}
                    <span className="mt-0.5 block">Pay the complete discounted fee now.</span>
                  </ChoiceCard>
                )}
              </div>

              <div className="mt-4 space-y-1.5 border-t border-[var(--ca-slate-200)] pt-3" aria-live="polite">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Your payment</p>
                <MoneyRow label="Pay today" value={formatINR(todayAmount)} strong />
                <MoneyRow label={totalLabel} value={formatINR(grandTotal)} />
                <MoneyRow label="Remaining balance" value={formatINR(remaining)} />
                {method === "full" && saveVsInstallments > 0 && (
                  <MoneyRow label="You save" value={`${formatINR(saveVsInstallments)} vs installments`} save />
                )}
                {applied && couponDiscount > 0 && (
                  <MoneyRow label={`Coupon ${applied.code}`} value={`− ${formatINR(couponDiscount)}`} save />
                )}
                {applied && (
                  <p className="text-xs text-[var(--ca-slate-700)]">{totalLabel} before coupon {formatINR(originalTotal)}.</p>
                )}
                {method === "installments" && (
                  <p className="text-sm text-[var(--ca-navy-900)]">
                    {cadence.charAt(0).toUpperCase()}{cadence.slice(1)}
                    {firstInstallment?.due ? ` · First due ${formatISTDate(firstInstallment.due)}` : ""}
                  </p>
                )}
                {seatActive && (
                  <p className="text-sm text-[var(--ca-slate-700)]">
                    Today&apos;s {formatINR(todayAmount)} is part of the {formatINR(grandTotal)} installment plan, not a separate fee.
                  </p>
                )}
              </div>

              {method === "installments" && emiAvailable && cfg.installmentCounts.length > 1 && (
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

              {method === "installments" && laterSchedule.length > 0 && (
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
                  schedule={laterSchedule}
                  bookingISO={bookingISO}
                />
              )}

              {method === "installments" && seatActive && cfg.allowCustomSeat && (
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
                        Pay today
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-heading text-lg font-bold text-[var(--ca-navy-900)]" aria-hidden="true">₹</span>
                        <input
                          id="booking-amount"
                          type="number"
                          inputMode="numeric"
                          aria-invalid={seatInvalid}
                          aria-describedby="booking-amount-help"
                          className="w-40 rounded-xl border border-[var(--ca-slate-300)] px-3 py-2.5 text-base font-semibold focus:border-[var(--ca-gold)] focus:outline-none"
                          value={seatInput}
                          min={seatFloor}
                          max={Math.max(seatFloor, seatCeiling - 1)}
                          onChange={(e) => {
                            const next = Math.round(Number(e.target.value) || 0);
                            setSeatInput(next);
                          }}
                          onBlur={() => {
                            setSeatInput((v) => {
                              const clamped = Math.min(Math.max(seatFloor, seatCeiling - 1), Math.max(seatFloor, v));
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
                      <p id="booking-amount-help" className={`mt-1 text-sm ${seatInvalid ? "text-red-600" : "text-[var(--ca-slate-700)]"}`} role={seatInvalid ? "alert" : undefined}>
                        {seatTooHigh ? "Amount must stay below the installment plan total." : `Minimum ${formatINR(seatFloor)}.`}
                      </p>
                    </div>
                  )}
                </div>
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
              <MoneyRow label="Plan" value={method === "installments" ? "Installments" : "Pay in Full"} />
              <MoneyRow label={totalLabel} value={formatINR(grandTotal)} />
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
        ref={paybarRef}
        className="fixed inset-x-0 bottom-0 z-[70] border-t border-[var(--ca-slate-200)] bg-white lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 shrink-0" aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-slate-700)]">Today</p>
            <p className="font-heading text-lg font-extrabold leading-tight text-[var(--ca-navy-900)]">{formatINR(todayAmount)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <PayButton label={payLabel} loading={loading} disabled={seatInvalid} onClick={() => void proceed()} />
          </div>
        </div>
        {error && <p role="alert" className="px-4 pb-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
