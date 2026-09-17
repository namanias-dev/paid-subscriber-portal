"use client";

import { useState } from "react";
import OrderStatus from "./OrderStatus";
import type { PublicOrder } from "@/lib/store/orders";

export default function TrackForm() {
  const [orderNo, setOrderNo] = useState("");
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
    <div className="mt-8 max-w-xl">
      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-5">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Order number</span>
          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value.toUpperCase())} required className="min-h-11 w-full rounded-xl border px-3 font-mono" placeholder="NIAS-N-2026-001284" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} required inputMode="numeric" className="min-h-11 w-full rounded-xl border px-3 tabular-nums" />
        </label>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <button type="submit" disabled={busy} className="min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white">
          {busy ? "Looking…" : "Track"}
        </button>
      </form>
      {order && (
        <div className="mt-8">
          <OrderStatus order={order} />
        </div>
      )}
    </div>
  );
}
