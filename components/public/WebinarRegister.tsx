"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { startPayment } from "@/lib/startPayment";
import { formatINR } from "@/lib/dates";
import { trackClient } from "@/lib/analytics/client";
import { metaPixelLead } from "@/lib/analytics/metaPixel";
import { ga4Event } from "@/lib/analytics/ga4";
import { useGa4FormTracking } from "@/lib/analytics/ga4Form";
import PaymentCautionModal from "@/components/public/PaymentCautionModal";

function stripPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  else if (d.length > 10) d = d.slice(-10);
  return d.slice(0, 10);
}

export default function WebinarRegister({
  webinarId,
  webinarSlug,
  price = 0,
  entryPoint = "detail",
}: {
  webinarId: string;
  webinarSlug?: string;
  price?: number;
  /** listing | detail | direct — stamped on registration + analytics only. */
  entryPoint?: "listing" | "detail" | "direct";
}) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ code: string; finalAmount: number; discount: number } | null>(null);
  const [caution, setCaution] = useState(false);
  const formId = `webinar_register:${webinarSlug || webinarId}`;
  const { onFocusCapture, trackSubmit } = useGa4FormTracking(formId, "Webinar registration");

  const isPaid = price > 0;
  const payable = applied ? applied.finalAmount : price;

  const nameOk = name.trim().length >= 2;
  const phoneOk = /^[6-9]\d{9}$/.test(phone);
  const formValid = nameOk && phoneOk;
  const disabledReason = !nameOk
    ? "Enter your full name."
    : !phoneOk
      ? "Enter your 10-digit mobile number."
      : null;

  // Silent ?coupon= — no UI field; API still optional.
  useEffect(() => {
    const code = (searchParams?.get("coupon") || "").trim().toUpperCase();
    if (!code || !webinarSlug || !isPaid) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/coupons/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemType: "webinar", slug: webinarSlug, code }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setApplied({ code: data.code, finalAmount: data.finalAmount, discount: data.discount });
        }
      } catch {
        /* ignore — coupon is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webinarSlug, isPaid]);

  useEffect(() => {
    trackClient("webinar_view", {
      webinar_id: webinarId,
      webinar_slug: webinarSlug ?? null,
      is_paid: isPaid,
      price,
      entry_point: entryPoint,
    });
    ga4Event("webinar_view", {
      webinar_id: webinarId,
      webinar_slug: webinarSlug ?? null,
      is_paid: isPaid,
      value: price,
      currency: "INR",
      entry_point: entryPoint,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackProps = useMemo(
    () => ({
      webinar_id: webinarId,
      webinar_slug: webinarSlug ?? null,
      is_paid: isPaid,
      price: payable,
      entry_point: entryPoint,
    }),
    [webinarId, webinarSlug, isPaid, payable, entryPoint],
  );

  function blurName() {
    if (!name.trim()) setNameErr("Enter your full name.");
    else if (name.trim().length < 2) setNameErr("Enter your full name.");
    else setNameErr(null);
  }

  function blurPhone() {
    if (!phone) setPhoneErr("Enter your 10-digit mobile number.");
    else if (!/^[6-9]\d{9}$/.test(phone)) setPhoneErr("Enter your 10-digit mobile number.");
    else setPhoneErr(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    blurName();
    blurPhone();
    if (!formValid || loading) return;

    trackClient("registration_attempt", trackProps);
    ga4Event("webinar_register_click", {
      webinar_id: webinarId,
      webinar_slug: webinarSlug ?? null,
      is_paid: isPaid,
      value: payable,
      currency: "INR",
      entry_point: entryPoint,
    });
    trackSubmit({ is_paid: isPaid, value: payable, currency: "INR", entry_point: entryPoint });

    if (isPaid) {
      setCaution(true);
      return;
    }
    void proceed();
  }

  async function proceed() {
    if (loading) return;
    setCaution(false);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/webinar-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webinar_id: webinarId,
          name: name.trim(),
          phone,
          entry_point: entryPoint,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
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
        trackClient("click_register_pay", {
          webinar_id: webinarId,
          webinar_slug: webinarSlug,
          item_type: "webinar",
          price: payable,
          source_section: "webinar_register",
          entry_point: entryPoint,
        });
        let isRetry = false;
        try {
          const key = `ga4_pay_start:webinar:${webinarSlug}`;
          isRetry = sessionStorage.getItem(key) === "1";
          sessionStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
        ga4Event(
          "payment_start",
          {
            item_type: "webinar",
            product_type: "webinar",
            webinar_slug: webinarSlug,
            value: payable,
            currency: "INR",
            is_retry: isRetry,
            entry_point: entryPoint,
          },
          { beacon: true },
        );
        // email intentionally blank — create-payment injects ${mobile}@guest.namanias.com for Eazypay only.
        const result = await startPayment({
          itemType: "webinar",
          webinarSlug,
          name: name.trim(),
          email: "",
          mobile: phone,
          couponCode: applied?.code,
        });
        if (!result.ok) {
          setError(result.error || "Could not start payment.");
          setLoading(false);
        }
        return;
      }

      setDone(true);
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

  const payLabel = isPaid ? `Pay ${formatINR(payable)} & Reserve Seat →` : "Register Now";

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
      <form onSubmit={submit} onFocusCapture={onFocusCapture} className="space-y-3" noValidate>
        <div>
          <input
            className="input"
            placeholder="Full name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameErr) setNameErr(null);
            }}
            onBlur={blurName}
          />
          {nameErr && <p className="mt-1 text-xs text-danger">{nameErr}</p>}
        </div>
        <div>
          <input
            className="input"
            placeholder="10-digit mobile"
            name="tel"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            pattern="[6-9][0-9]{9}"
            value={phone}
            onChange={(e) => {
              setPhone(stripPhone(e.target.value));
              if (phoneErr) setPhoneErr(null);
            }}
            onBlur={blurPhone}
          />
          {phoneErr && <p className="mt-1 text-xs text-danger">{phoneErr}</p>}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading || !formValid}
          className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          aria-disabled={loading || !formValid}
        >
          {loading ? "Opening secure payment…" : payLabel}
        </button>
        {!loading && disabledReason && (
          <p className="text-center text-xs text-muted">{disabledReason}</p>
        )}
      </form>
    </>
  );
}
