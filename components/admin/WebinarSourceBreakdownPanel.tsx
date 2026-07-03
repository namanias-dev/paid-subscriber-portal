"use client";

import { useMemo, useState } from "react";
import { istYMD } from "@/lib/dates";
import { isPaidStatus as isPaid, itemKey } from "@/lib/paymentsAgg";
import { type Frame, inFrame } from "@/lib/webinarReg";
import { bucketizeSources, sourceMeta } from "@/lib/webinarSource";
import type { Payment } from "@/lib/types";

/**
 * Opened content for "Paid registrations by source": timeframe controls + webinar
 * selector + the source breakdown bars. Same paid-only + distinct methodology as
 * the mini card (shared {@link bucketizeSources}). Read-only. Used full-page.
 * The content here is intentionally identical to what the card showed before —
 * only the container (modal → full page) changed.
 */
export default function WebinarSourceBreakdownPanel({ payments }: { payments: Payment[] }) {
  const [selected, setSelected] = useState<string>(""); // "" = all webinars
  const [frame, setFrame] = useState<Frame>("7d");
  const [month, setMonth] = useState(() => (istYMD(new Date()) || "").slice(0, 7));
  const [year, setYear] = useState(() => Number((istYMD(new Date()) || "2026").slice(0, 4)));

  const paidWebinar = useMemo(
    () => payments.filter((p) => isPaid(p.status) && p.item_type === "webinar"),
    [payments],
  );

  const webinars = useMemo(() => {
    const totals = new Map<string, { key: string; label: string; count: number }>();
    for (const p of paidWebinar) {
      const key = itemKey(p);
      if (!key) continue;
      const cur = totals.get(key) || { key, label: p.item || key, count: 0 };
      cur.count += 1;
      if (p.item && (cur.label === key || !cur.label)) cur.label = p.item;
      totals.set(key, cur);
    }
    return [...totals.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [paidWebinar]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const p of paidWebinar) { const y = Number((istYMD(p.created_at) || "").slice(0, 4)); if (y) set.add(y); }
    set.add(year);
    return [...set].sort((a, b) => b - a);
  }, [paidWebinar, year]);

  const view = useMemo(
    () => bucketizeSources(paidWebinar, selected, (ymd) => inFrame(ymd, frame, month, year)),
    [paidWebinar, selected, frame, month, year],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["7d", "30d", "month", "year"] as Frame[]).map((f) => (
          <button
            key={f}
            onClick={() => setFrame(f)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${frame === f ? "bg-primary text-white" : "bg-surface2 text-ink2 hover:bg-surface"}`}
          >
            {f === "7d" ? "Last 7 days" : f === "30d" ? "Last 30 days" : f === "month" ? "Month" : "Year"}
          </button>
        ))}
        {frame === "month" && (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input max-w-[180px]" />
        )}
        {frame === "year" && (
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="input max-w-[140px]">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="input max-w-[240px]"
          aria-label="Filter by webinar"
        >
          <option value="">All webinars</option>
          {webinars.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
        <span className="ml-auto text-sm text-muted">Total: <span className="font-bold text-ink">{view.total}</span></span>
      </div>

      <div className="min-h-[16rem]">
        {view.total === 0 ? (
          <div className="flex h-64 w-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface2/40 p-6 text-center">
            <p className="text-sm font-semibold text-ink">No paid registrations in this range</p>
            <p className="mt-1 text-xs text-muted">
              {webinars.length === 0 ? "No paid webinar registrations yet." : "Try a different webinar or timeframe."}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {view.rows.map((r) => {
              const meta = sourceMeta(r.key);
              const pct = view.total ? (r.count / view.total) * 100 : 0;
              return (
                <div key={r.key} className="flex items-center gap-3">
                  <span className="flex w-24 shrink-0 items-center gap-2 sm:w-28">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden="true" />
                    <span className="truncate text-sm font-medium text-ink">{meta.label}</span>
                  </span>
                  <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface2">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: meta.color }} />
                  </span>
                  <span className="w-16 shrink-0 text-right text-sm tabular-nums text-ink2 sm:w-20">
                    {r.count} · {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-muted">
        Paid webinar registrations by acquisition source (distinct per person/day, IST). &ldquo;Unknown&rdquo; = registrations
        from before source attribution was captured — shown honestly, never inferred. Read-only analytics.
      </p>
    </div>
  );
}
