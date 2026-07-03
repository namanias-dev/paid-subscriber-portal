"use client";

import { useMemo, useState } from "react";
import RegistrationsTrendChart from "./RegistrationsTrendChart";
import { istYMD } from "@/lib/dates";
import { isPaidStatus as isPaid, itemKey } from "@/lib/paymentsAgg";
import type { Payment } from "@/lib/types";

/**
 * Per-webinar registrations trend. Same source + methodology as
 * WebinarRegistrationsTrend (paid webinar payments, distinct by (phone, webinar)
 * per IST day) but scoped to a chosen webinar via a selector — "All webinars"
 * reproduces the all-webinars trend exactly. Reuses RegistrationsTrendChart so
 * the card/chart/timeframe look identical to the live card. Read-only.
 */
export default function WebinarRegistrationsByWebinarTrend({ payments }: { payments: Payment[] }) {
  const [selected, setSelected] = useState<string>(""); // "" = all webinars

  // Distinct webinars that actually have paid registrations → selector options,
  // ordered by volume (most-registered first), then title.
  const webinars = useMemo(() => {
    const totals = new Map<string, { key: string; label: string; count: number }>();
    for (const p of payments) {
      if (!isPaid(p.status) || p.item_type !== "webinar") continue;
      const key = itemKey(p);
      if (!key) continue;
      const cur = totals.get(key) || { key, label: p.item || key, count: 0 };
      cur.count += 1;
      if (p.item && (cur.label === key || !cur.label)) cur.label = p.item;
      totals.set(key, cur);
    }
    return [...totals.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [payments]);

  // Daily distinct (phone, webinar) counts for the current selection — identical
  // methodology to the all-webinars trend, optionally scoped to one webinar.
  const byDay = useMemo(() => {
    const perDay = new Map<string, Set<string>>();
    for (const p of payments) {
      if (!isPaid(p.status) || p.item_type !== "webinar") continue;
      const key = itemKey(p);
      if (selected && key !== selected) continue;
      const ymd = istYMD(p.created_at);
      if (!ymd) continue;
      let s = perDay.get(ymd);
      if (!s) { s = new Set(); perDay.set(ymd, s); }
      s.add(`${(p.phone || "").trim()}|${key}`);
    }
    const map = new Map<string, number>();
    for (const [ymd, s] of perDay) map.set(ymd, s.size);
    return map;
  }, [payments, selected]);

  const selectedLabel = selected ? (webinars.find((w) => w.key === selected)?.label ?? "Webinar") : "All webinars";

  const selector = (
    <select
      value={selected}
      onChange={(e) => setSelected(e.target.value)}
      className="input max-w-[220px]"
      aria-label="Filter by webinar"
    >
      <option value="">All webinars</option>
      {webinars.map((w) => (
        <option key={w.key} value={w.key}>{w.label}</option>
      ))}
    </select>
  );

  return (
    <RegistrationsTrendChart
      byDay={byDay}
      label={`By webinar · ${selectedLabel}`}
      modalTitle="Registrations by webinar"
      footNote="Paid webinar registrations by day (IST), scoped to the selected webinar. Read-only analytics."
      extraControls={selector}
      emptyState={
        <div className="flex h-full w-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface2/40 p-6 text-center">
          <p className="text-sm font-semibold text-ink">No registrations in this range</p>
          <p className="mt-1 text-xs text-muted">
            {webinars.length === 0
              ? "No paid webinar registrations yet."
              : "Try a different webinar or timeframe."}
          </p>
        </div>
      }
    />
  );
}
