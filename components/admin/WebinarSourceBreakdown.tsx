"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { istYMD } from "@/lib/dates";
import { isPaidStatus as isPaid, itemKey } from "@/lib/paymentsAgg";
import type { Payment } from "@/lib/types";

/** YMD (IST) for `daysAgo` days before today. */
function ymdDaysAgo(daysAgo: number): string {
  return istYMD(new Date(Date.now() - daysAgo * 86400000)) || "";
}

type Frame = "7d" | "30d" | "month" | "year";

/** Presentation for each normalized source; unmapped values fall back to a
 * neutral title-cased label so a new source never breaks the card. */
const SOURCE_META: Record<string, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  facebook: { label: "Facebook", color: "#1877F2" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  google: { label: "Google", color: "#EA4335" },
  youtube: { label: "YouTube", color: "#FF0000" },
  telegram: { label: "Telegram", color: "#229ED9" },
  direct: { label: "Direct", color: "#0057FF" },
  referral: { label: "Referral", color: "#8B5CF6" },
  other: { label: "Other", color: "#64748b" },
  unknown: { label: "Unknown", color: "#94a3b8" },
};
function sourceMeta(key: string) {
  return SOURCE_META[key] || { label: key.charAt(0).toUpperCase() + key.slice(1), color: "#64748b" };
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

function inFrame(ymd: string, frame: Frame, month: string, year: number): boolean {
  if (frame === "7d") return ymd >= ymdDaysAgo(6);
  if (frame === "30d") return ymd >= ymdDaysAgo(29);
  if (frame === "month") return ymd.slice(0, 7) === month;
  return ymd.slice(0, 4) === String(year);
}

/**
 * Paid webinar registrations broken down by acquisition SOURCE, per webinar (or
 * all). Same paid-only + distinct methodology as the webinar trend card: one
 * registration = distinct (phone, webinar, IST day). Each registration's source
 * is its stamped `attribution_source` (first non-empty among that day's rows);
 * registrations with none — e.g. historical rows from before attribution was
 * captured — fall into an explicit "Unknown" bucket (never inferred). Buckets
 * therefore always sum to the paid total for the selection. Read-only.
 */
export default function WebinarSourceBreakdown({ payments }: { payments: Payment[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>(""); // "" = all webinars
  const [frame, setFrame] = useState<Frame>("7d");
  const [month, setMonth] = useState(() => (istYMD(new Date()) || "").slice(0, 7));
  const [year, setYear] = useState(() => Number((istYMD(new Date()) || "2026").slice(0, 4)));

  const paidWebinar = useMemo(
    () => payments.filter((p) => isPaid(p.status) && p.item_type === "webinar"),
    [payments],
  );

  // Selector options — webinars that actually have paid registrations.
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

  // Distinct (phone, webinar, day) registrations for a predicate → counts by source.
  const bucketize = (inSel: (ymd: string) => boolean) => {
    const regs = new Map<string, string>(); // key -> source
    for (const p of paidWebinar) {
      const key = itemKey(p);
      if (selected && key !== selected) continue;
      const ymd = istYMD(p.created_at);
      if (!ymd || !inSel(ymd)) continue;
      const rk = `${(p.phone || "").trim()}|${key}|${ymd}`;
      const src = norm(p.attribution_source) || "unknown";
      const cur = regs.get(rk);
      if (cur === undefined) regs.set(rk, src);
      else if (cur === "unknown" && src !== "unknown") regs.set(rk, src);
    }
    const bySource = new Map<string, number>();
    for (const s of regs.values()) bySource.set(s, (bySource.get(s) || 0) + 1);
    const rows = [...bySource.entries()]
      .map(([key, count]) => ({ key, count }))
      // Known sources first (by count), Unknown always last for clarity.
      .sort((a, b) => {
        if ((a.key === "unknown") !== (b.key === "unknown")) return a.key === "unknown" ? 1 : -1;
        return b.count - a.count || sourceMeta(a.key).label.localeCompare(sourceMeta(b.key).label);
      });
    return { rows, total: regs.size };
  };

  const mini = useMemo(() => bucketize((ymd) => ymd >= ymdDaysAgo(6)), [paidWebinar, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(
    () => bucketize((ymd) => inFrame(ymd, frame, month, year)),
    [paidWebinar, selected, frame, month, year], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selectedLabel = selected ? (webinars.find((w) => w.key === selected)?.label ?? "Webinar") : "All webinars";

  return (
    <>
      {/* Mini card — click to expand */}
      <button
        type="button"
        onClick={() => { setFrame("7d"); setOpen(true); }}
        className="card flex w-full items-center gap-4 p-4 text-left transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none"
        title="View paid registrations by source"
      >
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">Paid registrations by source</p>
          <p className="mt-0.5 text-2xl font-extrabold leading-none">{mini.total}</p>
        </div>
        <div className="ml-auto flex h-2.5 w-28 overflow-hidden rounded-full bg-surface2" aria-hidden="true">
          {mini.total > 0 &&
            mini.rows.map((r) => (
              <span key={r.key} style={{ width: `${(r.count / mini.total) * 100}%`, background: sourceMeta(r.key).color }} />
            ))}
        </div>
        <span className="ml-1 text-xs font-semibold text-primary">View →</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Paid registrations by source" maxWidth="max-w-3xl">
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
              className="input max-w-[220px]"
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
      </Modal>
    </>
  );
}
