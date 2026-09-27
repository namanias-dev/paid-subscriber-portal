"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/store/money";
import { formatIstDateTime, istLocalToUtcIso } from "@/lib/store/discountPricing";

interface Product { id: string; name: string; sku: string; is_active: boolean }
interface CodeRow {
  id: string;
  code: string;
  name: string;
  discount_type: "fixed_amount" | "percentage";
  discount_value: number;
  scope: "all_notes" | "selected_products";
  product_ids: string[];
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  status: string;
  redemption_count: number;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  expires_label: string | null;
}

const FILTERS = ["all", "active", "scheduled", "expired", "inactive", "archived"] as const;
type DiscountForm = {
  code: string;
  name: string;
  discount_type: "fixed_amount" | "percentage";
  amount_rupees: string;
  percent: string;
  scope: "all_notes" | "selected_products";
  product_ids: string[];
  starts_date: string;
  starts_time: string;
  expires_date: string;
  expires_time: string;
  max_redemptions: string;
  one_per_customer: boolean;
  is_active: boolean;
};

const EMPTY: DiscountForm = {
  code: "",
  name: "",
  discount_type: "fixed_amount",
  amount_rupees: "500",
  percent: "10",
  scope: "selected_products",
  product_ids: [],
  starts_date: "",
  starts_time: "",
  expires_date: "",
  expires_time: "23:59",
  max_redemptions: "",
  one_per_customer: false,
  is_active: true,
};

function istStamp(date: string, time: string): string | null {
  if (!date) return null;
  const iso = istLocalToUtcIso(date, time || "00:00");
  return iso ? formatIstDateTime(iso) : null;
}

export default function DiscountCodesAdmin() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DiscountForm>(EMPTY);
  const [productQuery, setProductQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notes/discounts", { cache: "no-store" });
    const json = await res.json();
    setCodes(json.codes || []);
    setProducts(json.products || []);
    setEnabled(json.enabled !== false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const names = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);
  const visible = codes.filter((code) => {
    if (filter !== "all" && code.status !== filter) return false;
    const query = q.trim().toUpperCase();
    return !query || code.code.includes(query) || code.name.toUpperCase().includes(query);
  });
  const selectedProducts = products.filter((product) => form.product_ids.includes(product.id));
  const picker = products.filter((product) => product.name.toLowerCase().includes(productQuery.trim().toLowerCase()));
  const amountPaise = Math.round(Number(form.amount_rupees || 0) * 100);
  const valueLabel = form.discount_type === "percentage" ? `${form.percent || 0}% off` : formatPaise(amountPaise || 0) + " off";

  function preset(kind: "today" | "24h" | "3d" | "7d") {
    const now = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
    const end = new Date(now);
    if (kind === "today") {
      end.setUTCHours(23, 59, 0, 0);
    } else if (kind === "24h") end.setUTCHours(end.getUTCHours() + 24);
    else if (kind === "3d") end.setUTCDate(end.getUTCDate() + 3);
    else end.setUTCDate(end.getUTCDate() + 7);
    setForm((current) => ({
      ...current,
      expires_date: end.toISOString().slice(0, 10),
      expires_time: kind === "today" ? "23:59" : end.toISOString().slice(11, 16),
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/notes/discounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        name: form.name || form.code,
        discount_type: form.discount_type,
        discount_value: form.discount_type === "percentage" ? Number(form.percent) : amountPaise,
        scope: form.scope,
        product_ids: form.scope === "selected_products" ? form.product_ids : [],
        starts_date: form.starts_date,
        starts_time: form.starts_time,
        expires_date: form.expires_date,
        expires_time: form.expires_time,
        is_active: form.is_active,
        max_redemptions: form.max_redemptions.trim() ? Number(form.max_redemptions) : null,
        per_customer_limit: form.one_per_customer ? 1 : null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.ok) {
      setError(json.error || "Could not save this code.");
      return;
    }
    setOpen(false);
    setForm(EMPTY);
    await load();
  }

  async function toggleEntry() {
    const res = await fetch("/api/admin/notes/discounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    const json = await res.json();
    if (json.ok) setEnabled(json.enabled);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
          <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Discount Codes</h1>
          <p className="mt-1 text-sm text-[var(--ca-navy)]/60">One code per order. It discounts eligible Notes once, never shipping.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">Create discount</button>
      </header>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void toggleEntry()} className="min-h-10 rounded-full bg-white px-3 text-sm font-semibold text-[var(--ca-navy)]">
          Checkout entry {enabled ? "on" : "off"}
        </button>
        {FILTERS.map((key) => (
          <button key={key} type="button" onClick={() => setFilter(key)} className={`min-h-10 rounded-full px-3 text-sm font-semibold capitalize ${filter === key ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}>{key}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code" aria-label="Search discount codes" className="min-h-10 rounded-full border border-[var(--ca-navy)]/10 bg-white px-3 text-sm" />
      </div>
      <div className="overflow-hidden rounded-2xl bg-white">
        {visible.length === 0 && <p className="p-8 text-center text-sm text-[var(--ca-navy)]/60">No discount codes in this view.</p>}
        <ul className="hidden md:block">
          {visible.map((code) => (
            <li key={code.id} className="grid grid-cols-[1.1fr_0.8fr_1.2fr_0.5fr_1fr_0.6fr_auto] items-center gap-3 border-b border-[var(--ca-navy)]/5 px-4 py-3 text-sm">
              <span><span className="block font-semibold text-[var(--ca-navy)]">{code.code}</span><span className="text-xs text-[var(--ca-navy)]/50">{code.name}</span></span>
              <span>{code.discount_type === "percentage" ? `${code.discount_value}% off` : `${formatPaise(code.discount_value)} off`}</span>
              <span className="text-[var(--ca-navy)]/75">{code.scope === "all_notes" ? "All Notes, including future" : code.product_ids.map((id) => names.get(id) || "Notes").join(" + ") || "Selected"}</span>
              <span className="tabular-nums">{code.redemption_count}{code.max_redemptions ? ` / ${code.max_redemptions}` : ""}</span>
              <span className="text-[var(--ca-navy)]/70">{code.expires_label || "No expiry"}</span>
              <span className="capitalize">{code.status}</span>
              <Link href={`/admin/notes/discounts/${code.id}`} className="min-h-11 font-semibold text-[var(--ca-navy)]">View</Link>
            </li>
          ))}
        </ul>
        <ul className="space-y-2 p-2 md:hidden">
          {visible.map((code) => (
            <li key={code.id}>
              <Link href={`/admin/notes/discounts/${code.id}`} className="block rounded-2xl border border-[var(--ca-navy)]/5 px-3 py-3">
                <span className="flex items-baseline justify-between gap-2"><span className="font-semibold">{code.code}</span><span>{code.discount_type === "percentage" ? `${code.discount_value}% off` : `${formatPaise(code.discount_value)} off`}</span></span>
                <span className="mt-1 block text-sm text-[var(--ca-navy)]/70">{code.scope === "all_notes" ? "All Notes" : code.product_ids.map((id) => names.get(id) || "Notes").join(" + ")}</span>
                <span className="mt-1 block text-xs text-[var(--ca-navy)]/55">Redeemed {code.redemption_count}{code.max_redemptions ? ` / ${code.max_redemptions}` : ""} · {code.expires_label || "No expiry"} · {code.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-[var(--ca-navy)]/30 p-4">
          <form onSubmit={save} className="mx-auto mt-6 max-w-xl rounded-3xl bg-[#f7f5ef] p-5">
            <div className="flex items-start justify-between">
              <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">Create discount</h2>
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 text-sm text-[var(--ca-navy)]/60">Close</button>
            </div>
            <fieldset className="mt-4 space-y-3">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Basic</legend>
              <label className="block text-sm">Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="mt-1 min-h-11 w-full rounded-xl border px-3 uppercase" required /></label>
              <button type="button" className="text-sm font-semibold text-[var(--ca-navy)]" onClick={() => setForm((current) => ({ ...current, code: current.code || `NOTES${current.amount_rupees || "500"}` }))}>Generate code</button>
              <label className="block text-sm">Internal name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" placeholder="September Notes offer" /></label>
            </fieldset>
            <fieldset className="mt-4 space-y-3">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Discount</legend>
              <label className="block text-sm">Type
                <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as "fixed_amount" | "percentage" })} className="mt-1 min-h-11 w-full rounded-xl border px-3">
                  <option value="fixed_amount">Fixed amount</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
              {form.discount_type === "fixed_amount" ? (
                <label className="block text-sm">Amount (₹)<input inputMode="numeric" value={form.amount_rupees} onChange={(e) => setForm({ ...form, amount_rupees: e.target.value.replace(/[^\d.]/g, "") })} className="mt-1 min-h-11 w-full rounded-xl border px-3" required /></label>
              ) : (
                <label className="block text-sm">Percent<input inputMode="numeric" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/\D/g, "") })} className="mt-1 min-h-11 w-full rounded-xl border px-3" required /></label>
              )}
            </fieldset>
            <fieldset className="mt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Applies to</legend>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setForm({ ...form, scope: "all_notes" })} className={`min-h-10 rounded-full px-3 text-sm font-semibold ${form.scope === "all_notes" ? "bg-[var(--ca-navy)] text-white" : "bg-white"}`}>All Notes</button>
                <button type="button" onClick={() => setForm({ ...form, scope: "selected_products" })} className={`min-h-10 rounded-full px-3 text-sm font-semibold ${form.scope === "selected_products" ? "bg-[var(--ca-navy)] text-white" : "bg-white"}`}>Selected Notes</button>
              </div>
              {form.scope === "all_notes" && <p className="mt-2 text-sm text-[var(--ca-navy)]/65">Future Notes products become eligible automatically.</p>}
              {form.scope === "selected_products" && (
                <div className="mt-3 rounded-2xl bg-white p-3">
                  <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Search Notes" aria-label="Search Notes products" className="min-h-11 w-full rounded-xl border px-3 text-sm" />
                  <p className="mt-2 text-xs text-[var(--ca-navy)]/55">{form.product_ids.length} products selected</p>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                    {picker.map((product) => (
                      <li key={product.id}>
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input type="checkbox" checked={form.product_ids.includes(product.id)} onChange={(e) => setForm((current) => ({ ...current, product_ids: e.target.checked ? [...current.product_ids, product.id] : current.product_ids.filter((id) => id !== product.id) }))} />
                          {product.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </fieldset>
            <fieldset className="mt-4 space-y-3">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Schedule · India Standard Time (IST)</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">Starts<input type="date" value={form.starts_date} onChange={(e) => setForm({ ...form, starts_date: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
                <label className="text-sm">Time<input type="time" value={form.starts_time} onChange={(e) => setForm({ ...form, starts_time: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
                <label className="text-sm">Expires<input type="date" value={form.expires_date} onChange={(e) => setForm({ ...form, expires_date: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
                <label className="text-sm">Time<input type="time" value={form.expires_time} onChange={(e) => setForm({ ...form, expires_time: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                {([["today", "End of today"], ["24h", "24 hours"], ["3d", "3 days"], ["7d", "7 days"]] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => preset(key)} className="min-h-10 rounded-full bg-white px-3 text-xs font-semibold">{label}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-4 space-y-3">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Usage limits</legend>
              <label className="block text-sm">Maximum paid redemptions<input inputMode="numeric" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value.replace(/\D/g, "") })} placeholder="Unlimited" className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
              <p className="text-xs text-[var(--ca-navy)]/55">Counts only successful paid orders. Applying a code without completing payment does not use a redemption.</p>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.one_per_customer} onChange={(e) => setForm({ ...form, one_per_customer: e.target.checked })} /> Limit to one successful use per customer</label>
              <p className="text-xs text-[var(--ca-navy)]/55">A redemption is counted only after payment is successfully captured.</p>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            </fieldset>
            <div className="mt-4 rounded-2xl bg-white p-3 text-sm text-[var(--ca-navy)]">
              <p className="font-semibold">{form.code || "CODE"}</p>
              <p className="mt-1">{valueLabel} eligible Notes</p>
              <p className="mt-1">Applies to: {form.scope === "all_notes" ? "All Notes, including future products" : selectedProducts.map((product) => product.name).join(", ") || "No products selected"}</p>
              <p className="mt-1">Valid until: {istStamp(form.expires_date, form.expires_time) || "No expiry"}</p>
            </div>
            {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
            <button type="submit" disabled={saving} className="ca-focus mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save discount"}</button>
          </form>
        </div>
      )}
    </div>
  );
}
