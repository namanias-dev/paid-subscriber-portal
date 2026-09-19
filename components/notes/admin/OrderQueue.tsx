"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import { formatPaise } from "@/lib/store/money";

interface Row {
  id: string;
  order_no: string;
  status: string;
  customer_name: string;
  phone: string;
  email: string | null;
  total_paise: number;
  promised_delivery_date: string | null;
  placed_at: string;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
    landmark: string | null;
  } | null;
  items: Array<{ name: string; qty: number; sku: string }>;
}

function formatAddress(a: Row["address"]): string {
  if (!a) return "—";
  return [a.line1, a.line2, a.landmark, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(", ");
}

export default function NotesOrderQueue() {
  const [orders, setOrders] = useState<Row[]>([]);
  const [awb, setAwb] = useState<Record<string, string>>({});
  const [courier, setCourier] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/notes/orders", { cache: "no-store" });
    const json = await res.json();
    setOrders(json.orders || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function advance(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${id}/advance`, { method: "POST", cache: "no-store" });
      const json = await res.json();
      setMsg(json.ok ? `Moved to ${json.status}` : json.error);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function ship(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${id}/ship`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ awb: awb[id], courier_name: courier[id] || "Manual" }),
      });
      const json = await res.json();
      setMsg(json.ok ? "Marked shipped — stock deducted" : json.error);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Notes Store — order queue"
        subtitle="Manual fulfilment. Advance through print/pack states, then enter AWB to ship (stock deducts on ship)."
      />
      {msg && <p className="mb-3 rounded-lg border border-line bg-white px-3 py-2 text-sm">{msg}</p>}
      <div className="space-y-4">
        {orders.map((o) => (
          <article key={o.id} className="rounded-xl border border-line bg-white p-4 shadow-soft-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold text-ink">{o.order_no}</p>
                <p className="mt-1 font-heading text-lg font-bold">{o.customer_name}</p>
                <p className="text-sm tabular-nums text-ink2">
                  {o.phone}
                  {o.email ? ` · ${o.email}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-heading text-lg font-bold tabular-nums">{formatPaise(o.total_paise)}</p>
                <p className="mt-1 inline-flex rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink2">
                  {o.status.replaceAll("_", " ")}
                </p>
                {o.promised_delivery_date && (
                  <p className="mt-1 text-xs text-muted">Promised {o.promised_delivery_date}</p>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-ink2">
              <span className="font-semibold text-ink">Ship to: </span>
              {formatAddress(o.address)}
            </p>
            <ul className="mt-2 text-sm text-ink2">
              {o.items.map((it, i) => (
                <li key={i}>
                  <span className="font-mono text-xs text-muted">{it.sku}</span> — {it.name} × {it.qty}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === o.id}
                onClick={() => advance(o.id)}
                className="h-9 rounded bg-surface px-3 text-sm font-semibold text-ink ring-1 ring-line hover:bg-white disabled:opacity-50"
              >
                Advance status
              </button>
              <input
                value={courier[o.id] || ""}
                onChange={(e) => setCourier((m) => ({ ...m, [o.id]: e.target.value }))}
                placeholder="Courier"
                className="h-9 w-28 rounded border border-line px-2 text-sm"
              />
              <input
                value={awb[o.id] || ""}
                onChange={(e) => setAwb((m) => ({ ...m, [o.id]: e.target.value }))}
                placeholder="AWB"
                className="h-9 w-40 rounded border border-line px-2 font-mono text-sm"
              />
              <button
                type="button"
                disabled={busyId === o.id || !(awb[o.id] || "").trim()}
                onClick={() => ship(o.id)}
                className="h-9 rounded bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                Mark shipped
              </button>
            </div>
          </article>
        ))}
        {orders.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">
            No open notes orders.
          </p>
        )}
      </div>
    </div>
  );
}
