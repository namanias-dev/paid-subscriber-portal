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
  total_paise: number;
  promised_delivery_date: string | null;
  placed_at: string;
}

export default function NotesOrderQueue() {
  const [orders, setOrders] = useState<Row[]>([]);
  const [awb, setAwb] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/notes/orders", { cache: "no-store" });
    const json = await res.json();
    setOrders(json.orders || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function ship(id: string) {
    const res = await fetch(`/api/admin/notes/orders/${id}/ship`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ awb: awb[id], courier_name: "Manual" }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Marked shipped" : json.error);
    await load();
  }

  return (
    <div>
      <PageHeader title="Notes Store — order queue" subtitle="Manual fulfilment. Enter an AWB to mark shipped; that is when stock is deducted." />
      {msg && <p className="mb-3 text-sm">{msg}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="p-3">Order</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Value</th>
              <th className="p-3">Status</th>
              <th className="p-3">Promised</th>
              <th className="p-3">Ship</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="p-3 font-mono text-xs">{o.order_no}</td>
                <td className="p-3">{o.customer_name}</td>
                <td className="p-3 tabular-nums">{o.phone}</td>
                <td className="p-3">{formatPaise(o.total_paise)}</td>
                <td className="p-3">{o.status}</td>
                <td className="p-3">{o.promised_delivery_date}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <input
                      value={awb[o.id] || ""}
                      onChange={(e) => setAwb((m) => ({ ...m, [o.id]: e.target.value }))}
                      placeholder="AWB"
                      className="h-9 w-36 rounded border px-2"
                    />
                    <button type="button" onClick={() => ship(o.id)} className="h-9 rounded bg-slate-900 px-3 text-white">
                      Ship
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-slate-500">
                  No open notes orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
