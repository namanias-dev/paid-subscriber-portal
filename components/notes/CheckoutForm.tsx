"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackClient } from "@/lib/analytics/client";
import { addressAnalyticsProps, addressFingerprint, buildDeliveryGoogleMapsUrl, canonicalDelivery, formatDeliveryAddress } from "@/lib/store/deliveryAddress";
import { pinPlaceConflict } from "@/lib/store/address";
import type { FulfillmentMethod } from "@/lib/store/fulfillment";
import FulfillmentChooser from "./FulfillmentChooser";
import PickupLocationCard, { pickupViewFromSnapshot } from "./PickupLocationCard";

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

interface PickupLocationJson {
  code: string;
  name: string;
  address_lines: string[];
  maps_url: string;
  phone: string;
  phone_tel: string;
  fingerprint: string;
}

const PICKUP_READY_COPY = "Your notes will be ready after they are prepared, printed and packed. We’ll let you know when they’re ready to collect.";

export default function CheckoutForm() {
  const [cart, setCart] = useState<CartJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pinInfo, setPinInfo] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteJson | null>(null);
  const [pinReady, setPinReady] = useState(false);
  const [postal, setPostal] = useState<{ city: string | null; state: string | null }>({ city: null, state: null });
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null);
  const shownRef = useRef(false);
  const editedRef = useRef(false);
  const confirmRef = useRef<HTMLElement | null>(null);
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

  // Academy Pickup. Offered only when the server says so (flag + location record).
  const [pickupAvailable, setPickupAvailable] = useState(false);
  const [pickupLocation, setPickupLocation] = useState<PickupLocationJson | null>(null);
  const [method, setMethod] = useState<FulfillmentMethod>("DELIVERY");
  const methodRef = useRef<FulfillmentMethod>("DELIVERY");
  methodRef.current = method;
  const touchedMethod = useRef(false);
  const [pickupPin, setPickupPin] = useState("");
  const [pickupPlace, setPickupPlace] = useState<{ pincode: string; city: string; state: string } | null>(null);
  const [pickupPinMsg, setPickupPinMsg] = useState<{ text: string; retriable: boolean } | null>(null);
  const [pickupQuote, setPickupQuote] = useState<QuoteJson | null>(null);
  const [pickupTaxOk, setPickupTaxOk] = useState(true);
  const [pickupAck, setPickupAck] = useState<string | null>(null);
  const pickupLookupSeq = useRef(0);
  const ackRef = useRef<HTMLDivElement | null>(null);
  const isPickup = pickupAvailable && method === "ACADEMY_PICKUP";

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
    const timer = window.setTimeout(() => saveLead(), 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, marketingConsent, confirmedHash, method, pickupPlace]);

  const loadCart = useCallback(async () => {
    const res = await fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" });
    const j = await res.json();
    setCart(j.cart);
    const available = j.fulfillment?.pickup_available === true && Boolean(j.fulfillment?.pickup_location);
    setPickupAvailable(available);
    setPickupLocation(available ? j.fulfillment.pickup_location : null);
    if (!available) {
      setMethod("DELIVERY");
    } else if (j.fulfillment?.method === "ACADEMY_PICKUP" && methodRef.current === "DELIVERY" && !touchedMethod.current) {
      setMethod("ACADEMY_PICKUP");
    }
    return available;
  }, []);

  useEffect(() => {
    trackClient("notes_checkout_started", { cta_id: "checkout_page" });
    trackClient("notes_checkout_step_viewed", { step: "address" });
    loadCart().catch(() => trackClient("notes_checkout_api_error", { endpoint: "cart", recoverable: true }));
  }, [loadCart]);

  // Back/forward cache restores a frozen page: re-check the cart, the flag and the
  // location, and never leave the Pay button stuck in "Redirecting…".
  useEffect(() => {
    function onShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      setBusy(false);
      setErr(null);
      void loadCart().catch(() => {});
      if (methodRef.current === "DELIVERY" && /^[1-9][0-9]{5}$/.test(form.pincode)) void lookupPin(form.pincode);
      if (methodRef.current === "ACADEMY_PICKUP" && /^[1-9][0-9]{5}$/.test(pickupPin)) void lookupPickupPin(pickupPin);
    }
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCart, form.pincode, pickupPin]);

  async function lookupPin(pin: string) {
    if (pin.length !== 6) return;
    const res = await fetch(`/api/notes/pin?pin=${pin}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) {
      setPinReady(false);
      setPinInfo(json.error);
      setQuote(null);
      trackClient("notes_checkout_validation_error", { field: "pin", reason: "invalid_pin" });
      return;
    }
    if (!json.serviceable) {
      setPinReady(false);
      setPinInfo("We don't currently deliver to this PIN.");
      setQuote(null);
      trackClient("notes_shipping_quote_error", { field: "serviceability", reason: "no_shipping_quote", recoverable: true });
      return;
    }
    setPostal({ city: json.city || null, state: json.state || null });
    setPinReady(true);
    setForm((f) => ({ ...f, city: f.city || json.city || "", state: f.state || json.state || "" }));
    setQuote(json.quote || null);
    setPinInfo(`Delivered by ${json.promised_label}.`);
    trackClient("notes_checkout_step_viewed", { step: "shipping_quote" });
  }

  async function lookupPickupPin(pin: string) {
    const seq = ++pickupLookupSeq.current;
    setPickupPlace(null);
    setPickupQuote(null);
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      setPickupPinMsg(pin.length ? { text: "Enter a 6-digit PIN code", retriable: false } : null);
      return;
    }
    setPickupPinMsg({ text: "Checking PIN…", retriable: false });
    try {
      const res = await fetch(`/api/notes/pickup-quote?pin=${pin}`, { cache: "no-store", credentials: "same-origin" });
      const json = await res.json();
      if (seq !== pickupLookupSeq.current) return; // a newer PIN won
      if (!json.ok) {
        if (json.code === "PICKUP_UNAVAILABLE") return pickupWentAway(json.error);
        setPickupPinMsg({ text: json.error || "We couldn't check this PIN.", retriable: json.retriable === true });
        trackClient("notes_checkout_validation_error", { field: "pin", reason: json.retriable ? "lookup_unavailable" : "invalid_pin", fulfillment_method: "ACADEMY_PICKUP" });
        return;
      }
      setPickupPlace({ pincode: json.pincode, city: json.city, state: json.state });
      setPickupQuote(json.quote || null);
      setPickupTaxOk(json.tax_supported !== false);
      setPickupPinMsg(null);
    } catch {
      if (seq !== pickupLookupSeq.current) return;
      setPickupPinMsg({ text: "We couldn't check this PIN right now. Please try again in a moment.", retriable: true });
    }
  }

  function pickupWentAway(message?: string) {
    setPickupAvailable(false);
    setPickupLocation(null);
    setMethod("DELIVERY");
    setPickupAck(null);
    setErr(message || "Academy Pickup isn't available right now. Please choose Delivery.");
  }

  function chooseMethod(next: FulfillmentMethod) {
    if (next === method) return;
    touchedMethod.current = true;
    setMethod(next);
    // Errors belong to the method that raised them.
    setErr(null);
    setPickupAck(null);
    trackClient("notes_fulfillment_selected", { fulfillment_method: next, surface: "checkout" });
    void fetch("/api/notes/cart", {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fulfillment_method: next }),
    })
      .then((r) => (r.status === 409 && next === "ACADEMY_PICKUP" ? pickupWentAway() : undefined))
      .catch(() => {});
    if (next === "ACADEMY_PICKUP") {
      const seed = pickupPin || form.pincode;
      if (!pickupPin && seed) setPickupPin(seed);
      if (/^[1-9][0-9]{5}$/.test(seed) && !pickupPlace) void lookupPickupPin(seed);
    }
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

  function saveLead() {
    if (!/^[6-9]\d{9}$/.test(form.phone)) return;
    const pickup = methodRef.current === "ACADEMY_PICKUP";
    const address = !pickup && form.line1.trim() && /^[1-9][0-9]{5}$/.test(form.pincode) && form.city.trim() && form.state.trim()
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
        address_confirmed: !pickup && Boolean(confirmedHash) && confirmedHash === addressFingerprint(canonicalDelivery(form)),
        fulfillment_method: pickupAvailable ? methodRef.current : undefined,
        pickup_location: pickup && pickupPlace ? pickupPlace : undefined,
      }),
    }).catch(() => {});
  }

  const canonical = canonicalDelivery(form);
  const fingerprint = addressFingerprint(canonical);
  const placeConflict = pinPlaceConflict(form.city, form.state, postal.city, postal.state);
  const canConfirm = pinReady && !placeConflict && form.line1.trim().length > 2 && /^[1-9][0-9]{5}$/.test(form.pincode) && Boolean(form.city.trim()) && Boolean(form.state.trim());
  const confirmed = confirmedHash === fingerprint;
  const mapsUrl = buildDeliveryGoogleMapsUrl(canonical);
  const pickupAcked = Boolean(pickupLocation) && pickupAck === pickupLocation?.fingerprint;
  const pickupReady = isPickup && pickupAcked && Boolean(pickupPlace) && pickupTaxOk && form.name.trim().length > 1 && /^[6-9]\d{9}$/.test(form.phone);

  useEffect(() => {
    if (method !== "DELIVERY" || !canConfirm || shownRef.current) return;
    shownRef.current = true;
    trackClient("notes_address_confirmation_shown", addressAnalyticsProps({ itemCount: cart?.item_count }));
    if (window.matchMedia("(max-width: 1023px)").matches) {
      // Scroll the confirm control, not the whole card. A bottom cookie sheet
      // covers the last ~20rem; scroll-margin keeps the button above it.
      const target = confirmRef.current?.querySelector("[data-confirm-delivery]");
      (target instanceof HTMLElement ? target : confirmRef.current)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [canConfirm, cart?.item_count, method]);

  useEffect(() => {
    if (confirmedHash && confirmedHash !== fingerprint) {
      if (!editedRef.current) trackClient("notes_address_edited_after_confirmation", addressAnalyticsProps({}));
      editedRef.current = true;
      return;
    }
    editedRef.current = false;
  }, [confirmedHash, fingerprint]);

  // Same cookie-sheet rule for pickup: once the PIN resolves, bring the collect
  // confirmation into view on phones, above a bottom privacy sheet.
  useEffect(() => {
    if (!isPickup || !pickupPlace || pickupAcked) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const target = ackRef.current?.querySelector("[data-confirm-pickup]");
    if (target instanceof HTMLElement) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPlace]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (isPickup) return submitPickup();
    if (confirmedHash !== addressFingerprint(canonicalDelivery(form))) {
      setErr("Confirm the delivery address before paying.");
      trackClient("notes_address_validation_error", addressAnalyticsProps({ reason: "unconfirmed" }));
      return;
    }
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
        body: JSON.stringify({ ...form, address_hash: confirmedHash, fulfillment_method: "DELIVERY" }),
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

  async function submitPickup() {
    if (!pickupLocation) return pickupWentAway();
    if (form.name.trim().length < 2) return setErr("Enter your full name");
    if (!/^[6-9]\d{9}$/.test(form.phone)) {
      trackClient("notes_checkout_validation_error", { field: "phone", reason: "invalid_phone", fulfillment_method: "ACADEMY_PICKUP" });
      return setErr("Enter a 10-digit mobile number");
    }
    if (!pickupPlace) return setErr("Enter your PIN code so we can add your city and state to the invoice.");
    if (!pickupAcked) return setErr("Confirm that you'll collect from Chandigarh before paying.");
    setBusy(true);
    setErr(null);
    trackClient("notes_checkout_step_viewed", { step: "payment_clicked", item_count: cart?.item_count ?? 0, fulfillment_method: "ACADEMY_PICKUP" });
    if (pickupQuote?.offer_id) trackClient("notes_offer_checkout_started", { offer_id: pickupQuote.offer_id });
    try {
      const res = await fetch("/api/notes/checkout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fulfillment_method: "ACADEMY_PICKUP",
          name: form.name,
          phone: form.phone,
          email: form.email,
          pincode: pickupPlace.pincode,
          pickup_location_code: pickupLocation.code,
          pickup_location_fingerprint: pickupLocation.fingerprint,
          pickup_acknowledged: true,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        if (json.code === "PICKUP_UNAVAILABLE" || json.code === "TAX_UNSUPPORTED") {
          pickupWentAway(json.error);
          return setBusy(false);
        }
        if (json.code === "LOCATION_CHANGED") {
          setPickupAck(null);
          await loadCart().catch(() => {});
        }
        throw new Error(json.error || "Payment could not be started.");
      }
      trackClient("notes_payment_gateway_opened", { cta_id: "pay_securely", item_count: cart?.item_count ?? 0, fulfillment_method: "ACADEMY_PICKUP" });
      window.location.href = json.payment_url;
    } catch (e2) {
      trackClient("notes_checkout_api_error", { endpoint: "checkout", recoverable: true, stage: "order_create", fulfillment_method: "ACADEMY_PICKUP" });
      trackClient("notes_payment_failed", { stage: "checkout_submit" });
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  function acknowledgePickup() {
    if (!pickupLocation) return;
    setPickupAck(pickupLocation.fingerprint);
    setErr(null);
    trackClient("notes_pickup_acknowledged", { fulfillment_method: "ACADEMY_PICKUP", item_count: cart?.item_count ?? 0 });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const activeQuote = isPickup ? pickupQuote : quote;
  const payReady = isPickup ? pickupReady : confirmed;
  const payLabel = busy ? "Redirecting to ICICI…" : activeQuote ? `Pay ${activeQuote.total_label} securely` : "Pay securely";
  const payDisabled = busy || !cart?.item_count || !payReady;
  const step = (n: number, legacy: string, label: string) => (pickupAvailable ? `${n} · ${label}` : legacy);

  const contactFields = (
    <>
      <Field label="Full name" autoComplete="name" value={form.name} onChange={set("name")} required />
      <Field label="Mobile" autoComplete="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={form.phone} onChange={(e) => { phoneTouched.current = true; set("phone")(e); }} onBlur={() => { phoneTouched.current = true; saveLead(); }} required />
      <Field label="Email (optional)" autoComplete="email" type="email" value={form.email} onChange={set("email")} />
      <label className="flex items-start gap-2 text-sm text-[var(--ca-navy)]/80">
        <input type="checkbox" className="mt-1" checked={marketingConsent} onChange={(e) => { phoneTouched.current = true; setMarketingConsent(e.target.checked); }} />
        <span>Send me useful UPSC notes updates and offers on WhatsApp/SMS.</span>
      </label>
    </>
  );

  const deliveryFields = (
    <>
      <Field id="delivery-line1" label="Address line 1" autoComplete="address-line1" value={form.line1} onChange={set("line1")} onPaste={onLine1Paste} required />
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
      {placeConflict && <p className="text-sm text-red-700" role="alert">{placeConflict}</p>}
      {canConfirm && (
        <section ref={confirmRef} className="rounded-2xl border border-[var(--ca-navy)]/10 bg-[#f7f5ef] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Confirm delivery address</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--ca-navy)]">{formatDeliveryAddress(canonical)}</p>
          <p className="mt-2 text-xs text-[var(--ca-navy)]/60">Please confirm this is where you want your Notes delivered.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {mapsUrl ? (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackClient("notes_address_maps_opened", addressAnalyticsProps({}))} className="inline-flex min-h-11 items-center rounded-full border border-[var(--ca-navy)]/15 px-3 text-sm font-semibold text-[var(--ca-navy)]">Open in Google Maps</a>
            ) : (
              <p className="text-xs text-[var(--ca-navy)]/55">Complete the delivery address to open it in Maps.</p>
            )}
            <button type="button" className="min-h-11 rounded-full border border-[var(--ca-navy)]/15 px-3 text-sm font-semibold" onClick={() => document.getElementById("delivery-line1")?.focus()}>Edit address</button>
          </div>
          <button type="button" data-confirm-delivery className="ca-focus mt-3 inline-flex min-h-11 w-full scroll-mb-[20rem] items-center justify-center rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white lg:scroll-mb-0" onClick={() => { setConfirmedHash(fingerprint); trackClient("notes_address_confirmed", addressAnalyticsProps({ itemCount: cart?.item_count })); }}>
            {confirmed ? "Delivering here" : "Yes, deliver here"}
          </button>
        </section>
      )}
    </>
  );

  const pickupFields = pickupLocation && (
    <>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-[var(--ca-navy)]">Your PIN code</span>
        <input
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          required
          value={pickupPin}
          aria-describedby="pickup-pin-help"
          aria-invalid={pickupPinMsg && !pickupPinMsg.retriable && pickupPinMsg.text !== "Checking PIN…" ? true : undefined}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "").slice(0, 6);
            setPickupPin(value);
            if (value.length === 6) void lookupPickupPin(value);
            else {
              pickupLookupSeq.current += 1;
              setPickupPlace(null);
              setPickupQuote(null);
              setPickupPinMsg(null);
            }
          }}
          onBlur={() => { if (pickupPin.length && pickupPin.length !== 6) void lookupPickupPin(pickupPin); }}
          className="min-h-11 w-full rounded-xl border border-[var(--ca-navy)]/15 px-3"
        />
        <span id="pickup-pin-help" className="mt-1 block text-xs text-[var(--ca-navy)]/55">For your invoice and order details. We won&rsquo;t deliver to this address.</span>
      </label>
      {pickupPlace && (
        <p className="text-sm text-[var(--ca-navy)]/75" aria-live="polite">
          {pickupPlace.city}, {pickupPlace.state}
        </p>
      )}
      {pickupPinMsg && (
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <p className={`text-sm ${pickupPinMsg.text === "Checking PIN…" ? "text-[var(--ca-navy)]/60" : "text-red-700"}`}>{pickupPinMsg.text}</p>
          {pickupPinMsg.retriable && (
            <button type="button" className="ca-focus min-h-11 rounded-full border border-[var(--ca-navy)]/15 px-3 text-sm font-semibold" onClick={() => void lookupPickupPin(pickupPin)}>
              Try again
            </button>
          )}
        </div>
      )}
      {!pickupTaxOk && (
        <p className="text-sm text-red-700" role="alert">Academy Pickup isn&rsquo;t available for one of these items yet. Please choose Delivery.</p>
      )}
      <PickupLocationCard location={pickupViewFromSnapshot(pickupLocation)!} eyebrow="Collect from" note={PICKUP_READY_COPY}>
        <div ref={ackRef} className="mt-3">
          <button
            type="button"
            data-confirm-pickup
            aria-pressed={pickupAcked}
            onClick={acknowledgePickup}
            className={`ca-focus inline-flex min-h-11 w-full scroll-mb-[20rem] items-center justify-center rounded-full text-sm font-semibold lg:scroll-mb-0 ${
              pickupAcked ? "border border-[var(--ca-navy)]/20 bg-white text-[var(--ca-navy)]" : "bg-[var(--ca-navy)] text-white"
            }`}
          >
            {pickupAcked ? "Collecting here ✓" : "Yes, I’ll collect from Chandigarh"}
          </button>
        </div>
      </PickupLocationCard>
    </>
  );

  return (
    <form onSubmit={onSubmit} noValidate={isPickup} className="mt-8 grid gap-8 pb-28 lg:grid-cols-[1.2fr_0.8fr] lg:pb-0">
      <div className="min-w-0 space-y-4">
        {pickupAvailable ? (
          <>
            <div className="rounded-3xl bg-white p-5 ns-elev-1">
              <FulfillmentChooser value={method} onChange={chooseMethod} legend="1 · How you’ll get it" deliveryHint="Shipping calculated from your PIN" disabled={busy} />
            </div>
            <div className="space-y-3 rounded-3xl bg-white p-5 ns-elev-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">2 · Your details</p>
              {contactFields}
            </div>
            <div className="space-y-3 rounded-3xl bg-white p-5 ns-elev-1" data-fulfillment-panel={method}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">{isPickup ? "3 · Pickup details" : "3 · Delivery address"}</p>
              {isPickup ? pickupFields : deliveryFields}
            </div>
          </>
        ) : (
          <div className="space-y-3 rounded-3xl bg-white p-5 ns-elev-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">1 · Address</p>
            {contactFields}
            {deliveryFields}
          </div>
        )}
      </div>
      <aside className="h-fit rounded-3xl bg-white p-5 ns-elev-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">{step(4, "2 · Pay securely", "Pay securely")}</p>
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
            <span className="tabular-nums font-medium">{activeQuote?.subtotal_label ?? cart?.subtotal_label}</span>
          </p>
          {activeQuote?.discount_label && (
            <p className="flex justify-between">
              <span className="text-[var(--ca-navy)]/70">
                {activeQuote.offer_name ? `Offer applied: ${activeQuote.offer_name}` : "Offer"}
              </span>
              <span className="tabular-nums font-medium">−{activeQuote.discount_label}</span>
            </p>
          )}
          {isPickup ? (
            <p className="flex justify-between">
              <span className="text-[var(--ca-navy)]/70">Academy pickup</span>
              <span className="tabular-nums font-medium">Free</span>
            </p>
          ) : (
            <p className="flex justify-between">
              <span className="text-[var(--ca-navy)]/70">Shipping</span>
              <span className="tabular-nums font-medium">
                {quote ? quote.shipping_label : <span className="text-[var(--ca-navy)]/45">Enter PIN</span>}
              </span>
            </p>
          )}
          {activeQuote && activeQuote.tax_paise > 0 && (
            <p className="flex justify-between">
              <span className="text-[var(--ca-navy)]/70">Tax</span>
              <span className="tabular-nums font-medium">{activeQuote.tax_label}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-[var(--ca-navy)]/10 pt-2 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{activeQuote ? activeQuote.total_label : "—"}</span>
          </p>
        </div>
        <p className="mt-3 text-xs text-[var(--ca-navy)]/55">
          {isPickup
            ? "Physical notes, collected from the academy in Chandigarh. Prepaid only — UPI, cards, net banking via ICICI Eazypay."
            : "Physical notes, packed in Chandigarh. Prepaid only — UPI, cards, net banking via ICICI Eazypay."}
        </p>
        {!activeQuote && (
          <p className="mt-2 text-xs text-[var(--ca-navy)]/50">
            {isPickup ? "Enter your PIN code to see the total. It is frozen before you pay." : "Shipping and total are calculated from your PIN and frozen before you pay."}
          </p>
        )}
        {err && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={payDisabled}
          className="ca-focus ns-press mt-5 hidden min-h-12 w-full items-center justify-center rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50 lg:inline-flex"
        >
          {payLabel}
        </button>
        <p className="mt-3 text-xs text-[var(--ca-navy)]/50">
          Full-page redirect to ICICI Eazypay. We never mark an order paid from this page — ICICI confirmation does.
        </p>
      </aside>
      {/* Sticky mobile pay bar. The counsellor launcher is hidden on this page so nothing covers it. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ca-navy)]/10 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden" data-sticky-pay>
        {err && <p className="mb-2 text-xs text-red-700" aria-hidden>{err}</p>}
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 shrink-0">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--ca-navy)]/50">{isPickup ? "Academy pickup" : "Total"}</p>
            <p className="font-heading text-lg font-semibold tabular-nums text-[var(--ca-navy)]">{activeQuote ? activeQuote.total_label : "—"}</p>
          </div>
          <button
            type="submit"
            disabled={payDisabled}
            className="ca-focus ns-press inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {payLabel}
          </button>
        </div>
      </div>
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
