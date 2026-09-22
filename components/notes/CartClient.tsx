"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackClient } from "@/lib/analytics/client";

interface Item {
  id: string;
  name: string;
  slug: string;
  subject?: string | null;
  qty: number;
  cover_url: string | null;
  unit_label: string;
  line_label: string;
  sellable?: number;
  max_qty?: number;
  availability?: string;
}

interface BundleOffer {
  slug: string;
  name: string;
  save_label: string;
}

export default function CartClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [subtotal, setSubtotal] = useState("");
  const [discount, setDiscount] = useState("");
  const [total, setTotal] = useState("");
  const [promo, setPromo] = useState<{ id: string; name: string; label: string } | null>(null);
  const [offer, setOffer] = useState<BundleOffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Unable to load your cart right now.");
    setItems(json.cart?.items || []);
    setSubtotal(json.cart?.subtotal_label || "");
    setDiscount(json.cart?.discount_label || "");
    setTotal(json.cart?.total_label || json.cart?.subtotal_label || "");
    setPromo(json.cart?.offer || null);
    setOffer(json.cart?.bundle_offer || null);
    if (json.cart?.offer?.id) {
      trackClient("notes_offer_cart_applied", { offer_id: json.cart.offer.id });
    }
  }

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, []);

  async function setQty(id: string, qty: number) {
    setBusyId(id);
    setErr(null);
    try {
      const res = await fetch("/api/notes/cart", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: id, qty }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Unable to update your cart right now.");
      if (qty <= 0) trackClient("notes_removed_from_cart", { item_id: id });
      setItems(json.cart?.items || []);
      setSubtotal(json.cart?.subtotal_label || "");
      setDiscount(json.cart?.discount_label || "");
      setTotal(json.cart?.total_label || json.cart?.subtotal_label || "");
      setPromo(json.cart?.offer || null);
      setOffer(json.cart?.bundle_offer || null);
      window.dispatchEvent(new CustomEvent("notes-cart-updated", { detail: { count: json.cart?.item_count } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (items == null) {
    return <p className="mt-8 text-sm text-[var(--ca-navy)]/50">Loading your cart…</p>;
  }
  if (!items.length) {
    return (
      <div className="mt-10 rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-6 py-14 text-center">
        <p className="font-heading text-xl font-semibold text-[var(--ca-navy)]">Your cart is empty</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--ca-navy)]/60">
          Browse subject notes or a listed bundle. Guest checkout — no account needed.
        </p>
        <Link href="/notes" className="ca-focus mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--ca-navy)] px-6 text-sm font-semibold text-white">
          Explore Notes
        </Link>
      </div>
    );
  }

  return (
    <>
      {err && (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {err}
        </p>
      )}
      {offer && (
        <div className="mt-6 rounded-3xl border border-[var(--ca-gold)]/35 bg-[#fff8e8] p-4">
          <p className="text-sm font-semibold text-[var(--ca-navy)]">
            You can save {offer.save_label} with the {offer.name}.
          </p>
          <p className="mt-1 text-xs text-[var(--ca-navy)]/60">Optional — we will not replace your cart. You stay in control.</p>
          <Link href={`/notes/${offer.slug}`} className="mt-3 inline-flex text-sm font-semibold text-[var(--ca-navy)] underline">
            View bundle
          </Link>
        </div>
      )}
      <ul className="mt-8 divide-y divide-[var(--ca-navy)]/10 rounded-3xl bg-white ns-elev-1">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--ca-slate-100)]">
              {it.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.cover_url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {it.subject && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">{it.subject}</p>}
              <Link href={`/notes/${it.slug}`} className="font-semibold text-[var(--ca-navy)] hover:underline">
                {it.name}
              </Link>
              <p className="text-sm text-[var(--ca-navy)]/55">
                {it.unit_label}
                {it.availability ? ` · ${it.availability}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ca-focus h-10 w-10 rounded-full border border-[var(--ca-navy)]/15 disabled:opacity-40"
                disabled={busyId === it.id}
                onClick={() => setQty(it.id, it.qty - 1)}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-6 text-center tabular-nums">{it.qty}</span>
              <button
                type="button"
                className="ca-focus h-10 w-10 rounded-full border border-[var(--ca-navy)]/15 disabled:opacity-40"
                disabled={busyId === it.id}
                onClick={() => setQty(it.id, it.qty + 1)}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <div className="flex w-full items-center justify-between sm:w-auto sm:flex-col sm:items-end">
              <p className="font-semibold tabular-nums">{it.line_label}</p>
              <button type="button" className="text-xs font-semibold text-[var(--ca-navy)]/50 underline" onClick={() => setQty(it.id, 0)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white p-4 ns-elev-4">
        <div>
          <p className="text-sm text-[var(--ca-navy)]/60">
            Subtotal <span className="font-semibold text-[var(--ca-navy)]">{subtotal}</span>
          </p>
          {promo && discount && (
            <p className="text-sm text-[var(--ca-navy)]/60">
              {promo.name}
              {promo.label ? ` (${promo.label})` : ""}{" "}
              <span className="font-semibold text-[var(--ca-navy)]">−{discount}</span>
            </p>
          )}
          <p className="text-sm font-semibold text-[var(--ca-navy)]">
            Total <span className="tabular-nums">{total}</span>
          </p>
          <p className="text-xs text-[var(--ca-navy)]/45">Shipping is calculated from your PIN at checkout.</p>
        </div>
        <Link href="/notes/checkout" className="ca-focus ns-buy-now inline-flex min-h-14 w-full items-center justify-center rounded-full px-6 text-[15px] font-bold text-[var(--ca-navy)] sm:w-auto sm:min-w-[14rem]">
          Proceed to checkout
        </Link>
      </div>
    </>
  );
}
