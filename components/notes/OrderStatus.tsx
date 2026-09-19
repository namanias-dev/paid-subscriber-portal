"use client";

import { useEffect, useRef, useState } from "react";
import { trackClient } from "@/lib/analytics/client";
import type { PublicOrder } from "@/lib/store/orders";

/** ~90s of confirmation polling with gentle backoff. Cron remains recovery. */
const MAX_MS = 90_000;
const GAPS_MS = [2000, 2500, 3000, 4000, 5000, 6000, 8000];

export default function OrderStatus({ order }: { order: PublicOrder }) {
  const [current, setCurrent] = useState(order);
  const [stillWaiting, setStillWaiting] = useState(false);
  const completedFired = useRef(false);

  useEffect(() => {
    setCurrent(order);
    setStillWaiting(false);
  }, [order]);

  // Fire the completion funnel event once, when the order is confirmed (not
  // confirming and at least the "Order confirmed" step is done — never on a
  // failure). PII-free: order_no only.
  useEffect(() => {
    if (completedFired.current) return;
    if (!current.confirming && current.steps.some((s) => s.done)) {
      completedFired.current = true;
      trackClient("notes_order_completed", { order_no: current.order_no });
    }
  }, [current]);

  useEffect(() => {
    if (!current.confirming) return;
    const token = current.access_token;
    if (!token) return;
    let cancelled = false;
    const started = Date.now();
    let gapIdx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        const res = await fetch(`/api/notes/order/${encodeURIComponent(current.order_no)}/verify`, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ t: token }),
        });
        const json = await res.json();
        if (!cancelled && json.ok && json.order) {
          setCurrent(json.order);
          if (!json.order.confirming) return;
        }
      } catch {
        /* next tick retries */
      }
      if (cancelled) return;
      const elapsed = Date.now() - started;
      if (elapsed >= MAX_MS) {
        setStillWaiting(true);
        return;
      }
      const gap = GAPS_MS[Math.min(gapIdx, GAPS_MS.length - 1)];
      gapIdx += 1;
      timer = setTimeout(() => {
        void run();
      }, gap);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [current.confirming, current.order_no, current.access_token]);

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">{current.order_no}</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">
        {current.confirming ? "Payment received — confirming your order" : current.stage_label}
      </h1>
      {current.confirming && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/60">
          Waiting for ICICI to confirm the payment. This page does not mark the order paid itself.
        </p>
      )}
      {stillWaiting && current.confirming && (
        <p className="mt-3 rounded-xl border border-[var(--ca-navy)]/10 bg-[var(--ca-navy)]/[0.03] p-3 text-sm text-[var(--ca-navy)]/75">
          Confirmation is taking a little longer than usual. You can leave this page — we will keep checking in the background, and you can track the order anytime with your phone number.
        </p>
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
