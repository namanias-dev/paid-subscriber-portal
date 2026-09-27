"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/store/money";

interface Detail {
  code: {
    id: string;
    code: string;
    name: string;
    discount_type: "fixed_amount" | "percentage";
    discount_value: number;
    scope: string;
    product_ids: string[];
    status: string;
    is_active: boolean;
    starts_at: string | null;
    expires_at: string | null;
    archived_at: string | null;
    starts_label: string | null;
    expires_label: string | null;
    redemption_count: number;
    max_redemptions: number | null;
    per_customer_limit: number | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
  };
  products: Array<{ id: string; name: string }>;
  orders: Array<{ id: string; order_no: string; status: string; total_paise: number; coupon_discount_paise: number; paid_at: string | null }>;
  events: Array<{ event: string; actor: string | null; created_at: string }>;
  usage: { captured: number; held: number; discount_paise: number; revenue_paise: number };
}

export default function DiscountCodeDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(true);

  async function load() {
    const res = await fetch(`/api/admin/notes/discounts/${id}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) {
      setError(json.error || "Not found");
      return;
    }
    setDetail(json);
    setActive(json.code.is_active);
  }

  useEffect(() => { void load(); }, [id]);

  async function saveActive(next: boolean) {
    if (!detail) return;
    const res = await fetch(`/api/admin/notes/discounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: detail.code.code,
        name: detail.code.name,
        discount_type: detail.code.discount_type,
        discount_value: detail.code.discount_value,
        scope: detail.code.scope,
        product_ids: detail.code.product_ids,
        starts_at: detail.code.starts_at,
        expires_at: detail.code.expires_at,
        max_redemptions: detail.code.max_redemptions,
        per_customer_limit: detail.code.per_customer_limit,
        is_active: next,
      }),
    });
    const json = await res.json();
    if (!json.ok) setError(json.error || "Could not update");
    else await load();
  }

  async function archive() {
    const res = await fetch(`/api/admin/notes/discounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archive: true }),
    });
    const json = await res.json();
    if (!json.ok) setError(json.error || "Could not archive");
    else await load();
  }

  if (!detail) return <p className="p-6 text-sm text-[var(--ca-navy)]/60">{error || "Loading…"}</p>;
  const code = detail.code;
  const names = new Map(detail.products.map((product) => [product.id, product.name]));
  const amount = code.discount_type === "percentage" ? `${code.discount_value}% off` : `${formatPaise(code.discount_value)} off`;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/notes/discounts" className="text-sm font-semibold text-[var(--ca-navy)]/70">Discount codes</Link>
      <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
          <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">{code.code}</h1>
          <p className="mt-1 text-sm text-[var(--ca-navy)]/60">{code.name} · {amount}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/notes/analytics?range=30d&code=${encodeURIComponent(code.code)}`} className="min-h-11 rounded-full bg-white px-3 py-2 text-sm font-semibold">View performance</Link>
          <Link href={`/admin/notes?code=${encodeURIComponent(code.code)}`} className="min-h-11 rounded-full bg-white px-3 py-2 text-sm font-semibold">Orders</Link>
        </div>
      </header>
      <section className="mt-4 rounded-2xl bg-white p-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Status</dt><dd className="capitalize">{code.status}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Applies to</dt><dd>{code.scope === "all_notes" ? "All Notes, including future products" : code.product_ids.map((pid) => names.get(pid) || "Notes").join(", ")}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Starts</dt><dd>{code.starts_label || "Immediately"}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Expires</dt><dd>{code.expires_label || "No expiry"}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Usage</dt><dd>{detail.usage.captured} captured{code.max_redemptions ? ` of ${code.max_redemptions}` : ""} · {detail.usage.held} in checkout</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Per customer</dt><dd>{code.per_customer_limit ? "One mobile number" : "No per-customer limit"}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Discount given</dt><dd>{formatPaise(detail.usage.discount_paise)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Captured revenue</dt><dd>{formatPaise(detail.usage.revenue_paise)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Created</dt><dd>{code.created_by || "—"} · {code.created_at ? new Date(code.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Updated</dt><dd>{code.updated_by || "—"} · {code.updated_at ? new Date(code.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</dd></div>
        </dl>
        {!code.archived_at && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setEditing(true); }} className="min-h-11 rounded-full border px-3 text-sm font-semibold">Edit</button>
            <button type="button" onClick={() => void saveActive(!active)} className="min-h-11 rounded-full border px-3 text-sm font-semibold">{code.is_active ? "Deactivate" : "Activate"}</button>
            <button type="button" onClick={() => void archive()} className="min-h-11 rounded-full border px-3 text-sm font-semibold">Archive</button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      </section>
      {editing && <Editor detail={detail} onClose={() => { setEditing(false); void load(); }} />}
      <section className="mt-4 rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold">Orders using {code.code}</h2>
        <ul className="mt-2 divide-y text-sm">
          {detail.orders.length === 0 && <li className="py-3 text-[var(--ca-navy)]/55">No orders yet.</li>}
          {detail.orders.map((order) => (
            <li key={order.id} className="flex justify-between gap-3 py-2">
              <span>{order.order_no}<span className="ml-2 text-[var(--ca-navy)]/50">{order.status.replaceAll("_", " ")}</span></span>
              <span className="tabular-nums">{formatPaise(order.total_paise)} · −{formatPaise(order.coupon_discount_paise || 0)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-4 rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold">History</h2>
        <ul className="mt-2 space-y-1 text-sm text-[var(--ca-navy)]/75">
          {detail.events.map((event) => (
            <li key={event.created_at + event.event}>{event.event} · {event.actor || "system"} · {new Date(event.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Editor({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const code = detail.code;
  const [amount, setAmount] = useState(code.discount_type === "fixed_amount" ? String(code.discount_value / 100) : String(code.discount_value));
  const [name, setName] = useState(code.name);
  const [scope, setScope] = useState(code.scope);
  const [productIds, setProductIds] = useState(code.product_ids);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/admin/notes/discounts/${code.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code.code,
        name,
        discount_type: code.discount_type,
        scope,
        product_ids: scope === "selected_products" ? productIds : [],
        starts_at: code.starts_at,
        expires_at: code.expires_at,
        is_active: code.is_active,
        max_redemptions: code.max_redemptions,
        per_customer_limit: code.per_customer_limit,
        discount_value: code.discount_type === "fixed_amount" ? Math.round(Number(amount) * 100) : Math.round(Number(amount)),
      }),
    });
    const json = await res.json();
    if (!json.ok) setError(json.error || "Could not save");
    else onClose();
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-2xl bg-white p-4">
      <h2 className="font-heading text-lg font-bold">Edit</h2>
      <p className="mt-1 text-sm text-[var(--ca-navy)]/60">New checkouts use this rule. Orders already placed keep their snapshot.</p>
      <label className="mt-3 block text-sm">Internal name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
      <label className="mt-3 block text-sm">{code.discount_type === "fixed_amount" ? "Amount (₹)" : "Percent"}<input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setScope("all_notes")} className={`min-h-10 rounded-full px-3 text-sm font-semibold ${scope === "all_notes" ? "bg-[var(--ca-navy)] text-white" : "border"}`}>All Notes</button>
        <button type="button" onClick={() => setScope("selected_products")} className={`min-h-10 rounded-full px-3 text-sm font-semibold ${scope === "selected_products" ? "bg-[var(--ca-navy)] text-white" : "border"}`}>Selected</button>
      </div>
      {scope === "selected_products" && (
        <ul className="mt-2 max-h-40 overflow-auto text-sm">
          {detail.products.map((product) => (
            <li key={product.id}>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={productIds.includes(product.id)} onChange={(e) => setProductIds((current) => e.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} />
                {product.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      <button type="submit" className="mt-3 min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">Save changes</button>
    </form>
  );
}
