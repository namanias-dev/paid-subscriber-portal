"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/ui";

interface Row {
  product_id: string;
  name: string;
  sku: string;
  subject: string | null;
  availability_mode: string;
  demand: number;
  orders: number;
  ready_stock: number | null;
  additional_required: number;
}

interface Totals {
  products: number;
  copies_required: number;
  total_demand: number;
}

/**
 * Copies-to-prepare across all paid, not-yet-dispatched orders. Bundles are
 * already exploded into component demand server-side. Mobile-first cards.
 */
export default function PreparationQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/notes/preparation", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setRows(json.rows || []);
        setTotals(json.totals || null);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Preparation queue"
        subtitle="Physical copies to prepare from paid, not-yet-dispatched orders. Bundles are counted as their components. Cart / pending / cancelled / shipped are excluded."
      />

      {totals && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-white p-3">
            <p className="text-xs text-muted">Subjects to prepare</p>
            <p className="font-heading text-2xl font-bold tabular-nums">{totals.products}</p>
          </div>
          <div className="rounded-lg border border-line bg-white p-3">
            <p className="text-xs text-muted">Copies still required</p>
            <p className="font-heading text-2xl font-bold tabular-nums">{totals.copies_required}</p>
          </div>
          <div className="col-span-2 rounded-lg border border-line bg-white p-3 sm:col-span-1">
            <p className="text-xs text-muted">Total paid demand</p>
            <p className="font-heading text-2xl font-bold tabular-nums">{totals.total_demand}</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">
          Nothing to prepare — no paid orders are awaiting fulfilment.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <article
              key={r.product_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4"
            >
              <div className="min-w-0">
                <p className="font-heading text-base font-bold text-ink">{r.name}</p>
                <p className="text-xs text-ink2">
                  {r.subject ? `${r.subject} · ` : ""}
                  <span className="font-mono">{r.sku}</span> ·{" "}
                  {r.availability_mode === "on_demand" ? "On demand" : "Ready stock"} · {r.orders} order
                  {r.orders === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted">Demand</p>
                  <p className="font-heading text-lg font-bold tabular-nums">{r.demand}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted">Ready</p>
                  <p className="font-heading text-lg font-bold tabular-nums text-ink2">
                    {r.ready_stock == null ? "—" : r.ready_stock}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted">Prepare</p>
                  <p
                    className={`font-heading text-lg font-bold tabular-nums ${
                      r.additional_required > 0 ? "text-amber-700" : "text-emerald-700"
                    }`}
                  >
                    {r.additional_required}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
