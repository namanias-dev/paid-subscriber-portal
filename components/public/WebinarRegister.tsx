"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { startPayment } from "@/lib/startPayment";
import { formatINR } from "@/lib/dates";
import { trackClient } from "@/lib/analytics/client";
import { metaPixelLead } from "@/lib/analytics/metaPixel";
import { ga4Event } from "@/lib/analytics/ga4";
import PaymentCautionModal from "@/components/public/PaymentCautionModal";

export default function WebinarRegister({
  webinarId,
  webinarSlug,
  price = 0,
}: {
  webinarId: string;
  webinarSlug?: string;
  price?: number;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<{ code: string; finalAmount: number; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  // Pre-redirect caution gate for PAID webinars (free registrations skip it).
  const [caution, setCaution] = useState(false);

  const isPaid = price > 0;
  const payable = applied ? applied.finalAmount : price;

  useEffect(() => {
    trackClient("webinar_view", { webinar_id: webinarId, webinar_slug: webinarSlug ?? null, is_paid: isPaid, price });
    // GA4 (independent, consent-gated, no PII) fires alongside the in-house tracker.
    ga4Event("webinar_view", { webinar_id: webinarId, webinar_slug: webinarSlug ?? null, is_paid: isPaid, value: price, currency: "INR" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyCoupon() {
    if (!coupon.trim() || !webinarSlug) return;
    setCouponMsg(null);
    const res = await fetch("/api/v1/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: "webinar", slug: webinarSlug, code: coupon.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setApplied({ code: data.code, finalAmount: data.finalAmount, discount: data.discount });
      setCouponMsg(`Coupon applied — you save ${formatINR(data.discount)}.`);
    } else {
      setApplied(null);
      setCouponMsg(data.error || "Invalid coupon.");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !/^\d{10}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile.");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }
    // Funnel signal: the user actually TRIED to register (valid form submitted),
    // fired before the network call / gateway hand-off so we can distinguish
    // viewed → tried → registered. Attribution (incl. campaign) rides via the
    // /api/track cookie server-side. Best-effort, never blocks.
    trackClient("registration_attempt", {
      webinar_id: webinarId,
      webinar_slug: webinarSlug ?? null,
      is_paid: isPaid,
      price: payable,
    });
    // GA4 register-button click (valid form submitted). No PII (ids/slug only).
    ga4Event("webinar_register_click", {
      webinar_id: webinarId,
      webinar_slug: webinarSlug ?? null,
      is_paid: isPaid,
      value: payable,
      currency: "INR",
    });
    // PAID webinars redirect to the gateway — surface the caution first. Free
    // registrations have no hand-off, so proceed straight away.
    if (isPaid) {
      setCaution(true);
      return;
    }
    void proceed();
  }

  async function proceed() {
    setCaution(false);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/webinar-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webinar_id: webinarId, name: name.trim(), phone }),
      });
      const data = await res.json();
      if (!data.ok) {
        // Registration closed/ended (server is source of truth) — guide the user forward.
        if (data.closed) {
          if (data.nextWebinarUrl) {
            window.location.href = data.nextWebinarUrl;
            return;
          }
          setError(data.error || "Registration for this webinar has closed.");
          setLoading(false);
          return;
        }
        setError(data.error || "Could not register.");
        setLoading(false);
        return;
      }

      if (isPaid && webinarSlug) {
        trackClient("click_register_pay", { webinar_id: webinarId, webinar_slug: webinarSlug, item_type: "webinar", price: payable, source_section: "webinar_register" });
        // GA4 payment_start — numeric value + currency only, no PII.
        ga4Event("payment_start", { item_type: "webinar", webinar_slug: webinarSlug, value: payable, currency: "INR" });
        const result = await startPayment({
          itemType: "webinar",
          webinarSlug,
          name: name.trim(),
          email: email.trim(),
          mobile: phone,
          couponCode: applied?.code,
        });
        if (!result.ok) {
          setError(result.error || "Could not start payment.");
          setLoading(false);
        }
        // On success the helper navigates to the payment flow.
        return;
      }

      setDone(true);
      // Meta Lead (browser) for the FREE registration — same deterministic
      // event_id (lead_<webinarId:phone>) the server CAPI uses, so Meta dedupes.
      // Consent-gated + inert without a pixel id.
      metaPixelLead(`${webinarId}:${phone}`, { value: 0, contentName: webinarSlug ?? webinarId });
      toast("Registered! See you there. 🎯", "success");
    } catch {
      setError("Something went wrong.");
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-surface2 p-6 text-center">
        <div className="mb-2 text-3xl">✅</div>
        <p className="font-heading text-lg">You&apos;re registered!</p>
        <p className="mt-1 text-sm text-ink2">We&apos;ll send the joining link on WhatsApp.</p>
      </div>
    );
  }

  return (
    <>
    <PaymentCautionModal
      open={caution}
      amount={payable}
      itemLabel="You'll be redirected to ICICI Eazypay to complete your webinar registration."
      confirmLabel={`Continue to pay ${formatINR(payable)}`}
      busy={loading}
      onConfirm={proceed}
      onCancel={() => setCaution(false)}
    />
    <form onSubmit={submit} className="space-y-3">
      <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="input"
        placeholder="10-digit mobile *"
        inputMode="numeric"
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
      />
      {isPaid && (
        <input className="input" type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      )}
      {isPaid && (
        <div>
          <div className="flex gap-2">
            <input
              className="input uppercase"
              placeholder="Coupon code"
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            />
            <button type="button" onClick={applyCoupon} className="btn btn-secondary whitespace-nowrap text-sm">Apply</button>
          </div>
          {couponMsg && <p className={`mt-1 text-xs ${applied ? "text-success" : "text-danger"}`}>{couponMsg}</p>}
          {applied && (
            <p className="mt-1 text-xs text-ink2">New total: <b className="text-ink">{formatINR(payable)}</b></p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={loading} className="btn btn-primary w-full">
        {loading ? "Processing..." : isPaid ? `Register & Pay ${formatINR(payable)} →` : "Register Now"}
      </button>
    </form>
    </>
  );
}
