"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Item {
  id: string;
  name: string;
  slug: string;
  qty: number;
  cover_url: string | null;
  unit_label: string;
  line_label: string;
}

export default function CartClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [subtotal, setSubtotal] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" });
    const json = await res.json();
    setItems(json.cart?.items || []);
    setSubtotal(json.cart?.subtotal_label || "");
  }

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, []);

  async function setQty(id: string, qty: number) {
    await fetch("/api/notes/cart", {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_id: id, qty }),
    });
    await load();
  }

  if (items == null) return <p className="mt-8 text-sm text-[var(--ca-navy)]/50">Loading…</p>;
  if (!items.length) {
    return (
      <p className="mt-8 text-sm text-[var(--ca-navy)]/60">
        Your cart is empty. <Link href="/notes" className="underline">Shop notes</Link>
      </p>
    );
  }

  return (
    <>
      {err && <p className="mt-4 text-sm text-red-700">{err}</p>}
      <ul className="mt-8 divide-y divide-[var(--ca-navy)]/10 rounded-2xl border border-[var(--ca-navy)]/10 bg-white">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-4 p-4">
            <div className="h-16 w-16 overflow-hidden rounded-lg bg-[var(--ca-slate-100)]">
              {it.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.cover_url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/notes/products/${it.slug}`} className="font-semibold text-[var(--ca-navy)]">
                {it.name}
              </Link>
              <p className="text-sm text-[var(--ca-navy)]/55">{it.unit_label}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="h-10 w-10 rounded-full border" onClick={() => setQty(it.id, it.qty - 1)} aria-label="Decrease">
                −
              </button>
              <span className="w-6 text-center tabular-nums">{it.qty}</span>
              <button type="button" className="h-10 w-10 rounded-full border" onClick={() => setQty(it.id, it.qty + 1)} aria-label="Increase">
                +
              </button>
            </div>
            <p className="w-20 text-right font-semibold">{it.line_label}</p>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-4 rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-4">
        <p className="text-sm text-[var(--ca-navy)]/60">
          Subtotal <span className="font-semibold text-[var(--ca-navy)]">{subtotal}</span>
        </p>
        <Link href="/notes/checkout" className="inline-flex min-h-12 items-center rounded-full bg-[var(--ca-navy)] px-6 text-sm font-semibold text-white">
          Checkout
        </Link>
      </div>
    </>
  );
}
