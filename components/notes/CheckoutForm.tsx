"use client";

import { useEffect, useRef, useState } from "react";
import { trackClient } from "@/lib/analytics/client";

interface CartJson {
  item_count: number;
  subtotal_label: string;
  items: { name: string; qty: number; line_label: string }[];
}

interface QuoteJson {
  subtotal_label: string;
  discount_label?: string | null;
  shipping_label: string;
  tax_paise: number;
  tax_label: string;
  total_label: string;
  offer_name?: string | null;
  offer_id?: string | null;
}

export default function CheckoutForm() {
  const [cart, setCart] = useState<CartJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pinInfo, setPinInfo] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteJson | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const phoneTouched = useRef(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    line1: "",
    line2: "",
    pincode: "",
    city: "",
    state: "",
    delivery_instructions: "",
  });

  useEffect(() => {
    void fetch("/api/notes/checkout-lead", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((json) => {
        const draft = json?.draft;
        const prefill = json?.prefill;
        setForm((current) => ({
          ...current,
          name: current.name || draft?.name || prefill?.name || "",
          phone: current.phone || draft?.phone || prefill?.phone || "",
          email: current.email || draft?.email || "",
        }));
        if (draft?.marketing_consent) setMarketingConsent(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!phoneTouched.current || !/^[6-9]\d{9}$/.test(form.phone)) return;
    const timer = window.setTimeout(() => {
      const address = form.line1.trim() && /^[1-9][0-9]{5}$/.test(form.pincode) && form.city.trim() && form.state.trim()
        ? { line1: form.line1, city: form.city, state: form.state, pincode: form.pincode }
        : undefined;
      void fetch("/api/notes/checkout-lead", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          marketing_consent: marketingConsent,
          address,
        }),
      }).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [form.phone, form.name, form.email, form.line1, form.pincode, form.city, form.state, marketingConsent]);

  useEffect(() => {
    trackClient("notes_checkout_started", { cta_id: "checkout_page" });
    trackClient("notes_checkout_step_viewed", { step: "address" });
    fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setCart(j.cart))
      .catch(() => trackClient("notes_checkout_api_error", { endpoint: "cart", recoverable: true }));
  }, []);

  async function lookupPin(pin: string) {
    if (pin.length !== 6) return;
    const res = await fetch(`/api/notes/pin?pin=${pin}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) {
      setPinInfo(json.error);
      setQuote(null);
      trackClient("notes_checkout_validation_error", { field: "pin", reason: "invalid_pin" });
      return;
    }
    if (!json.serviceable) {
      setPinInfo("We don't currently deliver to this PIN.");
      setQuote(null);
      trackClient("notes_shipping_quote_error", { field: "serviceability", reason: "no_shipping_quote", recoverable: true });
      return;
    }
    setForm((f) => ({ ...f, city: f.city || json.city || "", state: f.state || json.state || "" }));
    setQuote(json.quote || null);
    setPinInfo(`Delivered by ${json.promised_label}.`);
    trackClient("notes_checkout_step_viewed", { step: "shipping_quote" });
  }

  async function onPinBlur() {
    await lookupPin(form.pincode);
  }

  function onLine1Paste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text") || "";
    const pin = text.match(/\b[1-9][0-9]{5}\b/);
    if (pin) {
      setForm((f) => ({ ...f, pincode: pin[0] }));
      void lookupPin(pin[0]);
    }
  }

  function persistLead() {
    if (!/^[6-9]\d{9}$/.test(form.phone)) return;
    const address = form.line1.trim() && /^[1-9][0-9]{5}$/.test(form.pincode) && form.city.trim() && form.state.trim()
      ? { line1: form.line1, city: form.city, state: form.state, pincode: form.pincode }
      : undefined;
    void fetch("/api/notes/checkout-lead", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        phone: form.phone,
        email: form.email,
        marketing_consent: marketingConsent,
        address,
      }),
    }).catch(() => {});
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[6-9]\d{9}$/.test(form.phone)) {
      trackClient("notes_checkout_validation_error", { field: "phone", reason: "invalid_phone" });
    }
    if (!/^[1-9][0-9]{5}$/.test(form.pincode)) {
      trackClient("notes_checkout_validation_error", { field: "pin", reason: "invalid_pin" });
    }
    if (!form.line1.trim()) {
      trackClient("notes_checkout_validation_error", { field: "address", reason: "required" });
    }
    setBusy(true);
    setErr(null);
    trackClient("notes_checkout_step_viewed", { step: "payment_clicked", item_count: cart?.item_count ?? 0 });
    if (quote?.offer_id) {
      trackClient("notes_offer_checkout_started", { offer_id: quote.offer_id });
    }
    try {
      const res = await fetch("/api/notes/checkout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Payment could not be started.");
      trackClient("notes_payment_gateway_opened", { cta_id: "pay_securely", item_count: cart?.item_count ?? 0 });
      window.location.href = json.payment_url;
    } catch (e2) {
      trackClient("notes_checkout_api_error", { endpoint: "checkout", recoverable: true, stage: "order_create" });
      trackClient("notes_payment_failed", { stage: "checkout_submit" });
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-3 rounded-3xl bg-white p-5 ns-elev-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">1 · Address</p>
        <Field label="Full name" autoComplete="name" value={form.name} onChange={set("name")} required />
        <Field label="Mobile" autoComplete="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={form.phone} onChange={(e) => { phoneTouched.current = true; set("phone")(e); }} onBlur={() => { phoneTouched.current = true; persistLead(); }} required />
        <Field label="Email (optional)" autoComplete="email" type="email" value={form.email} onChange={set("email")} />
        <label className="flex items-start gap-2 text-sm text-[var(--ca-navy)]/80">
          <input type="checkbox" className="mt-1" checked={marketingConsent} onChange={(e) => { phoneTouched.current = true; setMarketingConsent(e.target.checked); }} />
          <span>Send me useful UPSC notes updates and offers on WhatsApp/SMS.</span>
        </label>
        <Field label="Address line 1" autoComplete="address-line1" value={form.line1} onChange={set("line1")} onPaste={onLine1Paste} required />
        <Field label="Apartment / landmark (optional)" autoComplete="address-line2" value={form.line2} onChange={set("line2")} />
        <Field label="PIN code" autoComplete="postal-code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set("pincode")} onBlur={onPinBlur} required />
        {pinInfo && <p className="text-sm text-[var(--ca-navy)]/70">{pinInfo}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" autoComplete="address-level2" value={form.city} onChange={set("city")} required />
          <Field label="State" autoComplete="address-level1" value={form.state} onChange={set("state")} required />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-[var(--ca-navy)]">Delivery instructions (optional)</span>
          <textarea value={form.delivery_instructions} onChange={set("delivery_instructions")} rows={2} className="w-full rounded-xl border border-[var(--ca-navy)]/15 px-3 py-2" />
        </label>
      </div>
      <aside className="h-fit rounded-3xl bg-white p-5 ns-elev-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">2 · Pay securely</p>
        <h2 className="mt-2 font-heading text-lg font-semibold text-[var(--ca-navy)]">Order</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(cart?.items || []).map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>
                {it.name} × {it.qty}
              </span>
              <span className="tabular-nums">{it.line_label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1.5 border-t border-[var(--ca-navy)]/10 pt-3 text-sm">
          <p className="flex justify-between">
            <span className="text-[var(--ca-navy)]/70">Subtotal</span>
            <span className="tabular-nums font-medium">{quote?.subtotal_label ?? cart?.subtotal_label}</span>
          </p>
          {quote?.discount_label && (
            <p className="flex justify-between">
              <span className="text-[var(--ca-navy)]/70">
                {quote.offer_name ? `Offer applied: ${quote.offer_name}` : "Offer"}
              </span>
              <span className="tabular-nums font-medium">−{quote.discount_label}</span>
            </p>
          )}
          <p className="flex justify-between">
            <span className="text-[var(--ca-navy)]/70">Shipping</span>
            <span className="tabular-nums font-medium">
              {quote ? quote.shipping_label : <span className="text-[var(--ca-navy)]/45">Enter PIN</span>}
            </span>
          </p>
          {quote && quote.tax_paise > 0 && (
            <p className="flex justify-between">
              <span className="text-[var(--ca-navy)]/70">Tax</span>
              <span className="tabular-nums font-medium">{quote.tax_label}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-[var(--ca-navy)]/10 pt-2 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{quote ? quote.total_label : "—"}</span>
          </p>
        </div>
        <p className="mt-3 text-xs text-[var(--ca-navy)]/55">Physical notes, packed in Chandigarh. Prepaid only — UPI, cards, net banking via ICICI Eazypay.</p>
        {!quote && (
          <p className="mt-2 text-xs text-[var(--ca-navy)]/50">Shipping and total are calculated from your PIN and frozen before you pay.</p>
        )}
        {err && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !cart?.item_count}
          className="ca-focus ns-press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Redirecting to ICICI…" : quote ? `Pay ${quote.total_label} securely` : "Pay securely"}
        </button>
        <p className="mt-3 text-xs text-[var(--ca-navy)]/50">
          Full-page redirect to ICICI Eazypay. We never mark an order paid from this page — ICICI confirmation does.
        </p>
      </aside>
    </form>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--ca-navy)]">{label}</span>
      <input {...rest} className="min-h-11 w-full rounded-xl border border-[var(--ca-navy)]/15 px-3" />
    </label>
  );
}
