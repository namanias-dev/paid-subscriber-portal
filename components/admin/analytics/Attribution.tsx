"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { SectionCard, EmptyState, nf } from "./Shared";
import { formatINR } from "@/lib/dates";

interface Row {
  campaign: string;
  label: string;
  source: string | null;
  isMeta: boolean;
  isUntracked: boolean;
  leads: number;
  paidWebinars: number;
  paidAdmissions: number;
  paidTotal: number;
  revenue: number;
  spend: number | null;
  costPerConversion: number | null;
  roas: number | null;
}
interface Report {
  spendConnected: boolean;
  spendError: string | null;
  rows: Row[];
  totals: { leads: number; paidWebinars: number; paidAdmissions: number; revenue: number; spend: number | null };
  coverage: { totalRevenue: number; attributedRevenue: number; untrackedRevenue: number; metaRevenue: number };
  notes: string[];
}

const money = (v: number | null) => (v === null ? "—" : formatINR(v));

export default function AttributionTab({ qs }: { qs: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/attribution?${qs}`)
      .then((r) => r.json())
      .then((d) => setData(d.ok ? d.report : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [qs]);

  if (loading) return <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>;
  if (!data) return <EmptyState>No attribution data yet.</EmptyState>;

  const attributedPct = data.coverage.totalRevenue > 0 ? Math.round((data.coverage.attributedRevenue / data.coverage.totalRevenue) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Coverage summary — honest labeling */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Total revenue" value={formatINR(data.coverage.totalRevenue)} tone="green" />
        <Card label="Campaign-attributed" value={formatINR(data.coverage.attributedRevenue)} hint={`${attributedPct}% of revenue`} />
        <Card label="Meta-sourced" value={formatINR(data.coverage.metaRevenue)} hint="fb / instagram / meta" />
        <Card label="Untracked" value={formatINR(data.coverage.untrackedRevenue)} hint="never guessed" tone="muted" />
      </div>

      <SectionCard title="By campaign">
        {!data.spendConnected && (
          <p className="mb-3 text-xs text-muted">
            Spend, cost-per-conversion and ROAS are hidden — connect a Meta Ad Account (<code>META_AD_ACCOUNT_ID</code>) to enable them.
            Leads, paid conversions and revenue are shown regardless.
          </p>
        )}
        {data.spendConnected && data.spendError && (
          <p className="mb-3 text-xs text-warning">Ad Account connected but spend fetch failed: {data.spendError}</p>
        )}
        {data.rows.length === 0 ? <EmptyState>No campaigns in this range.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2">Campaign</th>
                  <th className="px-2 py-2 text-left">Source</th>
                  <th className="px-2 py-2 text-right">Leads</th>
                  <th className="px-2 py-2 text-right">Paid webinars</th>
                  <th className="px-2 py-2 text-right">Paid admissions</th>
                  <th className="px-2 py-2 text-right">Revenue</th>
                  {data.spendConnected && <th className="px-2 py-2 text-right">Spend</th>}
                  {data.spendConnected && <th className="px-2 py-2 text-right">Cost / conv.</th>}
                  {data.spendConnected && <th className="py-2 pl-2 text-right">ROAS</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.campaign} className={`border-b border-line/60 last:border-0 ${r.isUntracked ? "bg-surface2/40 text-muted" : ""}`}>
                    <td className={`py-2 pr-2 font-medium ${r.isUntracked ? "text-muted" : "text-ink"}`}>{r.label}</td>
                    <td className="px-2 py-2 text-left">
                      {r.source ? <span className={`rounded px-1.5 py-0.5 text-xs ${r.isMeta ? "bg-primary/10 text-primary" : "bg-surface2 text-muted"}`}>{r.source}</span> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.leads)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.paidWebinars)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.paidAdmissions)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatINR(r.revenue)}</td>
                    {data.spendConnected && <td className="px-2 py-2 text-right tabular-nums">{money(r.spend)}</td>}
                    {data.spendConnected && <td className="px-2 py-2 text-right tabular-nums">{money(r.costPerConversion)}</td>}
                    {data.spendConnected && <td className="py-2 pl-2 text-right font-semibold tabular-nums">{r.roas === null ? "—" : `${r.roas}×`}</td>}
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-semibold">
                  <td className="py-2 pr-2 text-ink">Total</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums">{nf(data.totals.leads)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{nf(data.totals.paidWebinars)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{nf(data.totals.paidAdmissions)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatINR(data.totals.revenue)}</td>
                  {data.spendConnected && <td className="px-2 py-2 text-right tabular-nums">{money(data.totals.spend)}</td>}
                  {data.spendConnected && <td className="px-2 py-2" />}
                  {data.spendConnected && <td className="py-2 pl-2 text-right tabular-nums">{data.totals.spend && data.totals.spend > 0 ? `${Number((data.totals.revenue / data.totals.spend).toFixed(2))}×` : "—"}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <details className="card p-4 text-sm">
        <summary className="cursor-pointer font-heading text-base font-bold">About attribution</summary>
        <ul className="mt-3 space-y-2 text-ink2">
          {data.notes.map((n, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{n}</span></li>)}
        </ul>
      </details>
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "muted" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1.5 font-heading text-2xl font-extrabold ${tone === "green" ? "text-success" : tone === "muted" ? "text-muted" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
