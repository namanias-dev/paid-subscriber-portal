"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Line {
  id: string;
  name: string;
  qty: number;
  cover_url: string | null;
  line_label: string;
}

export default function CartAddedDrawer() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [total, setTotal] = useState("");

  useEffect(() => {
    const onAdded = () => {
      fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" })
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok && json.ok !== undefined && !json.cart) return;
          setLines(json.cart?.items || []);
          setTotal(json.cart?.total_label || json.cart?.subtotal_label || "");
          setOpen(true);
        })
        .catch(() => undefined);
    };
    window.addEventListener("notes-cart-added", onAdded);
    return () => window.removeEventListener("notes-cart-added", onAdded);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const latest = lines[lines.length - 1];

  return (
    <div className="fixed inset-0 z-[70]">
      <button type="button" className="absolute inset-0 bg-[rgba(10,26,63,0.45)]" aria-label="Close cart" onClick={() => setOpen(false)} />
      <aside className="ns-cart-drawer absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[22rem] sm:rounded-none" role="dialog" aria-modal="true" aria-label="Added to cart">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Added to cart</p>
        {latest && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--ca-slate-100)]">
              {latest.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latest.cover_url} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-[var(--ca-navy)]">{latest.name}</p>
              <p className="text-sm tabular-nums text-[var(--ca-navy)]/60">{latest.line_label}</p>
            </div>
          </div>
        )}
        <p className="mt-4 text-sm text-[var(--ca-navy)]/60">
          Total <span className="font-heading text-lg font-extrabold text-[var(--ca-navy)]">{total}</span>
        </p>
        <Link href="/notes/checkout" className="ca-focus ns-buy-now mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-full text-[15px] font-bold text-[var(--ca-navy)]">
          Proceed to checkout
        </Link>
        <button type="button" className="ca-focus mt-2 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-[var(--ca-navy)]/70" onClick={() => setOpen(false)}>
          Continue shopping
        </button>
      </aside>
    </div>
  );
}
