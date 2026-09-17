"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/lib/store/money";

interface CartJson {
  item_count: number;
  subtotal_label: string;
  items: { name: string; qty: number; line_label: string }[];
}

export default function CheckoutForm() {
  const [cart, setCart] = useState<CartJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pinInfo, setPinInfo] = useState<string | null>(null);
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
    fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setCart(j.cart));
  }, []);

  async function onPinBlur() {
    if (form.pincode.length !== 6) return;
    const res = await fetch(`/api/notes/pin?pin=${form.pincode}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) {
      setPinInfo(json.error);
      return;
    }
    if (!json.serviceable) {
      setPinInfo("We don't currently deliver to this PIN.");
      return;
    }
    setForm((f) => ({ ...f, city: f.city || json.city || "", state: f.state || json.state || "" }));
    const ship =
      typeof json.shipping_paise === "number" ? ` Shipping ${formatPaise(json.shipping_paise)}.` : "";
    setPinInfo(`Delivered by ${json.promised_label}.${ship}`);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/notes/checkout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Checkout failed");
      window.location.href = json.payment_url;
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-3 rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-5">
        <Field label="Full name" autoComplete="name" value={form.name} onChange={set("name")} required />
        <Field label="Mobile" autoComplete="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={form.phone} onChange={set("phone")} required />
        <Field label="Email (optional)" autoComplete="email" type="email" value={form.email} onChange={set("email")} />
        <Field label="Address line 1" autoComplete="address-line1" value={form.line1} onChange={set("line1")} required />
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
      <aside className="h-fit rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-5">
        <h2 className="font-heading text-lg font-semibold text-[var(--ca-navy)]">Order</h2>
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
        <p className="mt-4 flex justify-between text-sm">
          <span>Subtotal</span>
          <span className="font-semibold">{cart?.subtotal_label}</span>
        </p>
        <p className="mt-1 text-xs text-[var(--ca-navy)]/50">Shipping is calculated from your PIN and frozen before you pay.</p>
        {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
        <button
          type="submit"
          disabled={busy || !cart?.item_count}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Redirecting to ICICI…" : "Pay securely"}
        </button>
        <p className="mt-3 text-xs text-[var(--ca-navy)]/50">Full-page redirect to ICICI Eazypay. We never mark an order paid from this page.</p>
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
