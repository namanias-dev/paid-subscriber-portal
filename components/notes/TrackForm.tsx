"use client";

import { useState } from "react";
import OrderStatus from "./OrderStatus";
import type { PublicOrder } from "@/lib/store/orders";

export default function TrackForm({ initialOrderNo = "" }: { initialOrderNo?: string }) {
  const [orderNo, setOrderNo] = useState(initialOrderNo);
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOrder(null);
    try {
      const res = await fetch("/api/notes/track", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_no: orderNo, phone }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setOrder(json.order);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-lg">
      {!order && (
        <form onSubmit={onSubmit} className="rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-2 sm:p-6">
          <label className="block text-sm font-medium text-[var(--ca-navy)]">
            Order number
            <input
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value.toUpperCase())}
              required
              autoComplete="off"
              className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--ca-navy)]/12 px-3 font-mono text-base"
              placeholder="NIAS-N-2026-001001"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-[var(--ca-navy)]">
            Phone used at checkout
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              required
              inputMode="numeric"
              autoComplete="tel"
              className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--ca-navy)]/12 px-3 text-base tabular-nums"
              placeholder="10-digit mobile"
            />
          </label>
          {err && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {err}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-5 min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Looking up your order…" : "Track order"}
          </button>
        </form>
      )}
      {busy && (
        <div className="mt-4 space-y-3" aria-hidden>
          <div className="h-40 animate-pulse rounded-[28px] bg-white" />
          <div className="h-56 animate-pulse rounded-[28px] bg-white" />
        </div>
      )}
      {order && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOrder(null)}
            className="mb-4 min-h-11 text-sm font-semibold text-[var(--ca-navy)]/70"
          >
            Track a different order
          </button>
          <OrderStatus order={order} />
        </div>
      )}
    </div>
  );
}
