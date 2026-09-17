"use client";

import { useEffect, useState } from "react";
import type { PublicOrder } from "@/lib/store/orders";

export default function OrderStatus({ order }: { order: PublicOrder }) {
  const [current, setCurrent] = useState(order);

  useEffect(() => {
    setCurrent(order);
  }, [order]);

  useEffect(() => {
    if (!current.confirming) return;
    let cancelled = false;
    let ticks = 0;
    const run = async () => {
      try {
        const res = await fetch(`/api/notes/order/${encodeURIComponent(current.order_no)}/verify`, {
          method: "POST",
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok && json.order) setCurrent(json.order);
      } catch {
        /* next tick retries */
      }
    };
    void run();
    const id = setInterval(() => {
      ticks += 1;
      if (ticks > 40) {
        clearInterval(id);
        return;
      }
      void run();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [current.confirming, current.order_no]);

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">{current.order_no}</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">{current.stage_label}</h1>
      {current.confirming && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Waiting for ICICI to confirm the payment. This page does not mark the order paid itself.</p>
      )}
      {current.promised_delivery_date && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Promised by {current.promised_delivery_date}</p>
      )}
      <ol className="mt-8 space-y-3">
        {current.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${s.done ? "bg-[var(--ca-gold,#d4af37)]" : "bg-[var(--ca-navy)]/20"}`} />
            <span className={s.done ? "font-medium text-[var(--ca-navy)]" : "text-[var(--ca-navy)]/40"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <ul className="mt-8 divide-y rounded-2xl border border-[var(--ca-navy)]/10 bg-white">
        {current.items.map((it, i) => (
          <li key={i} className="flex justify-between p-4 text-sm">
            <span>
              {it.name} × {it.qty}
            </span>
            <span>{it.total}</span>
          </li>
        ))}
        <li className="flex justify-between p-4 font-semibold">
          <span>Total</span>
          <span>{current.total_label}</span>
        </li>
      </ul>
      {current.awb && (
        <p className="mt-4 text-sm text-[var(--ca-navy)]/70">
          {current.courier} · AWB {current.awb}
        </p>
      )}
    </div>
  );
}
