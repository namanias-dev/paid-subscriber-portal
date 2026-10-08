"use client";

import { useEffect, useMemo, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { SectionCard, EmptyState, Stat, nf, pctStr } from "./Shared";
import { formatINR } from "@/lib/dates";
import CampaignLinkStudio from "./CampaignLinkStudio";

type Preset = "today" | "yesterday" | "7d" | "30d" | "this_month";
type Touch = "first" | "last";

interface Row {
  source: string;
  label: string;
  isSpecial: boolean;
  visitors: number;
  registrations: number;
  paidStudents: number;
  revenue: number;
  visitorToRegistration: number | null;
  registrationToPaid: number | null;
  visitorToPaid: number | null;
  revenuePerVisitor: number | null;
}
interface Funnel {
  touch: Touch;
  rows: Row[];
  totals: Row;
  range: { from: string; to: string };
  updatedAt?: string | null;
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "this_month", label: "MTD" },
];

export default function GrowthIntelligence() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [touch, setTouch] = useState<Touch>("first");
  const [excludeAdmin, setExcludeAdmin] = useState(true);
  const [data, setData] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({
      preset,
      touch,
      excludeAdmin: excludeAdmin ? "1" : "0",
    }).toString();
    fetch(`/api/admin/analytics/touch-sources?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok) setData(d.funnel); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [preset, touch, excludeAdmin]);

  const t = data?.totals;
  const visitorToReg = useMemo(() => (t && t.visitors > 0 ? Math.round((t.registrations / t.visitors) * 1000) / 10 : null), [t]);
  const regToPaid = useMemo(() => (t && t.registrations > 0 ? Math.round((t.paidStudents / t.registrations) * 1000) / 10 : null), [t]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-2.5 py-1.5 text-xs font-semibold transition ${preset === p.id ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          <button
            onClick={() => setTouch("first")}
            className={`px-3 py-1.5 text-xs font-semibold transition ${touch === "first" ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}
          >
            First touch
          </button>
          <button
            onClick={() => setTouch("last")}
            className={`px-3 py-1.5 text-xs font-semibold transition ${touch === "last" ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}
          >
            Last touch
          </button>
        </div>
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={excludeAdmin} onChange={(e) => setExcludeAdmin(e.target.checked)} />
          Exclude staff/admin
        </label>
      </div>

      <p className="text-xs text-muted">
        {touch === "first"
          ? "First touch = the acquisition channel that first brought each visitor/buyer. Best for deciding where to spend to acquire new people."
          : "Last touch = the channel on the visit that converted. Best for understanding what closes."}
        {data?.updatedAt ? ` · Updated ${Math.max(0, Math.round((Date.now() - new Date(data.updatedAt).getTime()) / 60000))} min ago` : ""}
        {loading && data ? " · Updating…" : ""}
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Visitors" value={loading || !t ? "—" : nf(t.visitors)} />
        <Stat label="Registrations" value={loading || !t ? "—" : nf(t.registrations)} />
        <Stat label="Paid students" value={loading || !t ? "—" : nf(t.paidStudents)} />
        <Stat label="Revenue" value={loading || !t ? "—" : formatINR(t.revenue)} tone="green" />
        <Stat label="Visitor → Reg" value={loading ? "—" : pctStr(visitorToReg)} />
        <Stat label="Reg → Paid" value={loading ? "—" : pctStr(regToPaid)} />
      </div>

      {/* Source funnel */}
      <SectionCard title={`Sources — ${touch === "first" ? "acquisition (first touch)" : "conversion (last touch)"}`}>
        {loading && !data ? (
          <LoadingBlock />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState>No tracked traffic in this period yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2">Source</th>
                  <th className="px-2 py-2 text-right">Visitors</th>
                  <th className="px-2 py-2 text-right">Registrations</th>
                  <th className="px-2 py-2 text-right">Paid students</th>
                  <th className="px-2 py-2 text-right">Revenue</th>
                  <th className="px-2 py-2 text-right">Visitor→Reg</th>
                  <th className="px-2 py-2 text-right">Reg→Paid</th>
                  <th className="py-2 pl-2 text-right">₹ / visitor</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.source} className={`border-b border-line/60 last:border-0 ${r.isSpecial ? "text-muted" : ""}`}>
                    <td className="py-2 pr-2 font-medium text-ink">{r.label}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.visitors)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.registrations)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.paidStudents)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatINR(r.revenue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pctStr(r.visitorToRegistration)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pctStr(r.registrationToPaid)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{r.revenuePerVisitor === null ? "N/A" : formatINR(r.revenuePerVisitor)}</td>
                  </tr>
                ))}
                {t && (
                  <tr className="border-t-2 border-line font-semibold">
                    <td className="py-2 pr-2">{t.label}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(t.visitors)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(t.registrations)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(t.paidStudents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatINR(t.revenue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pctStr(visitorToReg)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pctStr(regToPaid)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Revenue reconciles to the Payments tab (PAID, deduped). Paid students &amp; revenue are credited to the buyer&apos;s
          {touch === "first" ? " first-touch source (lifetime, cross-device)" : " converting-visit source"}; rows with no
          tracked origin collapse into <em>Untracked / pre-tracking</em> — never guessed.
        </p>
      </SectionCard>

      <CampaignLinkStudio />
    </div>
  );
}
