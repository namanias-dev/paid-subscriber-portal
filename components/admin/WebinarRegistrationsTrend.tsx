"use client";

import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import Modal from "@/components/ui/Modal";
import { istYMD } from "@/lib/dates";
import { isPaidStatus as isPaid, itemKey } from "@/lib/paymentsAgg";
import type { Payment } from "@/lib/types";

/** YMD (IST) for `daysAgo` days before today. */
function ymdDaysAgo(daysAgo: number): string {
  return istYMD(new Date(Date.now() - daysAgo * 86400000)) || "";
}

function dayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Frame = "7d" | "30d" | "month" | "year";

/**
 * Read-only registrations trend. Counts PAID webinar payments by IST day — the
 * SAME source as the "Webinar Registrations Today" card, so the latest bar always
 * matches that number. Never mutates any data.
 */
export default function WebinarRegistrationsTrend({ payments }: { payments: Payment[] }) {
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<Frame>("7d");
  const [month, setMonth] = useState(() => (istYMD(new Date()) || "").slice(0, 7)); // YYYY-MM
  const [year, setYear] = useState(() => Number((istYMD(new Date()) || "2026").slice(0, 4)));

  // Paid webinar registrations bucketed by IST day — counted DISTINCT by
  // (phone, webinar) per day, so a retry that leaves two paid rows for the same
  // person+webinar on a day counts as ONE registration (matches the seat count).
  const byDay = useMemo(() => {
    const perDay = new Map<string, Set<string>>();
    for (const p of payments) {
      if (!isPaid(p.status) || p.item_type !== "webinar") continue;
      const ymd = istYMD(p.created_at);
      if (!ymd) continue;
      let s = perDay.get(ymd);
      if (!s) { s = new Set(); perDay.set(ymd, s); }
      s.add(`${(p.phone || "").trim()}|${itemKey(p)}`);
    }
    const map = new Map<string, number>();
    for (const [ymd, s] of perDay) map.set(ymd, s.size);
    return map;
  }, [payments]);

  const last7 = useMemo(() => {
    const out: { label: string; ymd: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const ymd = ymdDaysAgo(i);
      out.push({ label: dayLabel(ymd), ymd, count: byDay.get(ymd) || 0 });
    }
    return out;
  }, [byDay]);

  const last7Total = last7.reduce((a, d) => a + d.count, 0);
  const max7 = Math.max(1, ...last7.map((d) => d.count));

  // Data for the expanded chart, per selected timeframe.
  const chartData = useMemo(() => {
    if (frame === "7d") return last7;
    if (frame === "30d") {
      const out: { label: string; ymd: string; count: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const ymd = ymdDaysAgo(i);
        out.push({ label: dayLabel(ymd), ymd, count: byDay.get(ymd) || 0 });
      }
      return out;
    }
    if (frame === "month") {
      const [y, m] = month.split("-").map(Number);
      if (!y || !m) return [];
      const days = new Date(y, m, 0).getDate();
      const out: { label: string; ymd: string; count: number }[] = [];
      for (let d = 1; d <= days; d++) {
        const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        out.push({ label: String(d), ymd, count: byDay.get(ymd) || 0 });
      }
      return out;
    }
    // year → monthly buckets
    const monthly = new Array(12).fill(0);
    for (const [ymd, c] of byDay) {
      if (ymd.startsWith(`${year}-`)) {
        const mi = Number(ymd.slice(5, 7)) - 1;
        if (mi >= 0 && mi < 12) monthly[mi] += c;
      }
    }
    return monthly.map((count, i) => ({ label: MONTHS[i], ymd: `${year}-${String(i + 1).padStart(2, "0")}`, count }));
  }, [frame, last7, byDay, month, year]);

  const frameTotal = chartData.reduce((a, d) => a + d.count, 0);
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const ymd of byDay.keys()) set.add(Number(ymd.slice(0, 4)));
    set.add(year);
    return [...set].sort((a, b) => b - a);
  }, [byDay, year]);

  return (
    <>
      {/* Mini sparkline card — click to expand */}
      <button
        type="button"
        onClick={() => { setFrame("7d"); setOpen(true); }}
        className="card flex w-full items-center gap-4 p-4 text-left transition hover:shadow-md"
        title="View full registrations trend"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Registrations · last 7 days</p>
          <p className="mt-0.5 text-2xl font-extrabold leading-none">{last7Total}</p>
        </div>
        <div className="ml-auto flex h-12 items-end gap-1" aria-hidden="true">
          {last7.map((d) => (
            <span
              key={d.ymd}
              className="w-2.5 rounded-t bg-primary/80"
              style={{ height: `${Math.max(8, (d.count / max7) * 100)}%` }}
              title={`${d.label}: ${d.count}`}
            />
          ))}
        </div>
        <span className="ml-1 text-xs font-semibold text-primary">View →</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Webinar registrations trend" maxWidth="max-w-3xl">
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
            <span className="ml-auto text-sm text-muted">Total: <span className="font-bold text-ink">{frameTotal}</span></span>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={frame === "30d" || frame === "month" ? 2 : 0} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "rgba(0,87,255,0.06)" }} contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v) => [`${v} registrations`, "Registrations"]} labelFormatter={(l) => `${l}`} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#0057FF">
                  {chartData.map((d) => <Cell key={d.ymd} fill={d.count > 0 ? "#0057FF" : "#dbe3ff"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted">Counts paid webinar registrations by day (IST). Read-only analytics.</p>
        </div>
      </Modal>
    </>
  );
}
