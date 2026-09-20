"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackClient } from "@/lib/analytics/client";

interface Item {
  id: string;
  name: string;
  slug: string;
  qty: number;
  cover_url: string | null;
  unit_label: string;
  line_label: string;
  sellable?: number;
  max_qty?: number;
}

export default function CartClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [subtotal, setSubtotal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Could not load cart");
    setItems(json.cart?.items || []);
    setSubtotal(json.cart?.subtotal_label || "");
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
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not update cart");
      if (qty <= 0) trackClient("notes_removed_from_cart", { item_id: id });
      setItems(json.cart?.items || []);
      setSubtotal(json.cart?.subtotal_label || "");
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
      <div className="mt-10 rounded-2xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-6 py-14 text-center">
        <p className="font-heading text-xl font-semibold text-[var(--ca-navy)]">Your cart is empty</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--ca-navy)]/60">
          Browse subject notes or the Complete GS set. Guest checkout — no account needed.
        </p>
        <Link
          href="/notes"
          className="ca-focus mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--ca-navy)] px-6 text-sm font-semibold text-white"
        >
          Shop notes
        </Link>
      </div>
    );
  }

  return (
    <>
      {err && <p className="mt-4 text-sm text-red-700">{err}</p>}
      <ul className="mt-8 divide-y divide-[var(--ca-navy)]/10 rounded-2xl border border-[var(--ca-navy)]/10 bg-white">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--ca-slate-100)]">
              {it.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.cover_url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/notes/products/${it.slug}`} className="font-semibold text-[var(--ca-navy)] hover:underline">
                {it.name}
              </Link>
              <p className="text-sm text-[var(--ca-navy)]/55">{it.unit_label}</p>
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
            <p className="w-full text-right font-semibold sm:w-20">{it.line_label}</p>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-4 shadow-[0_-8px_30px_rgba(10,26,63,0.06)]">
        <div>
          <p className="text-sm text-[var(--ca-navy)]/60">
            Subtotal <span className="font-semibold text-[var(--ca-navy)]">{subtotal}</span>
          </p>
          <p className="text-xs text-[var(--ca-navy)]/45">Shipping is calculated from your PIN at checkout.</p>
        </div>
        <Link
          href="/notes/checkout"
          className="ca-focus inline-flex min-h-12 items-center rounded-full bg-[var(--ca-navy)] px-6 text-sm font-semibold text-white"
        >
          Checkout
        </Link>
      </div>
    </>
  );
}
