"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Users, MousePointerClick, TicketCheck, IndianRupee, TrendingDown, ArrowRight } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import SortControl from "@/components/admin/SortControl";
import { formatINR } from "@/lib/dates";

interface Summary {
  range: { from: string; to: string };
  kpis: { visitors: number; sessions: number; pageViews: number; registrations: number; paidCount: number; revenue: number; abandoned: number };
  funnel: { label: string; value: number }[];
  bySource: { source: string; visitors: number; registrations: number; paid: number; revenue: number; conversion: number }[];
  daily: { day: string; visitors: number; registrations: number; paid: number; revenue: number }[];
  sources: string[];
}

const FUNNEL_COLORS = ["#2563eb", "#7c3aed", "#d97706", "#16a34a"];

function dayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return d && m ? `${d}/${m}` : ymd;
}

export default function AnalyticsDashboardPage() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [source, setSource] = useState<string>("all");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ days, ...(source !== "all" ? { source } : {}) });
    fetch(`/api/admin/analytics/summary?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => setData(d.ok ? d.summary : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days, source]);

  const sourceOptions = useMemo(
    () => [{ value: "all", label: "All sources" }, ...(data?.sources || []).map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))],
    [data?.sources],
  );

  const maxFunnel = Math.max(1, ...(data?.funnel.map((f) => f.value) || [1]));

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Business Analytics</h1>
          <p className="text-sm text-muted">Acquisition, funnel & revenue — reconciled to the Payments tab.</p>
        </div>
        <Link href="/admin/analytics/segments" className="btn btn-secondary text-sm">
          Re-engagement segments <ArrowRight size={15} />
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          {(["7", "30", "90"] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-2 text-sm font-semibold transition ${days === d ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>
              {d}d
            </button>
          ))}
        </div>
        <SortControl value={source} onChange={setSource} options={sourceOptions} label="Source" />
      </div>

      {loading ? (
        <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>
      ) : !data ? (
        <div className="card p-10 text-center text-sm text-muted">No analytics yet. Data appears as visitors arrive.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={<Users size={16} />} label="Visitors" value={data.kpis.visitors.toLocaleString("en-IN")} hint={`${data.kpis.pageViews.toLocaleString("en-IN")} page views`} />
            <Kpi icon={<MousePointerClick size={16} />} label="Registrations" value={data.kpis.registrations.toLocaleString("en-IN")} hint={`${data.kpis.sessions.toLocaleString("en-IN")} sessions`} />
            <Kpi icon={<TicketCheck size={16} />} label="Paid" value={data.kpis.paidCount.toLocaleString("en-IN")} hint="distinct purchases" tone="green" />
            <Kpi icon={<IndianRupee size={16} />} label="Revenue" value={formatINR(data.kpis.revenue)} hint="ties to Payments" tone="green" />
          </div>

          {/* Daily trend */}
          <div className="card p-4">
            <h2 className="mb-3 font-heading text-base font-bold">Daily activity</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily.map((d) => ({ ...d, label: dayLabel(d.day) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="visitors" name="Visitors" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="registrations" name="Registrations" stroke="#d97706" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="paid" name="Paid" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Funnel */}
            <div className="card p-4">
              <h2 className="mb-3 font-heading text-base font-bold">Conversion funnel</h2>
              <div className="space-y-3">
                {data.funnel.map((f, i) => (
                  <div key={f.label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-ink2">{f.label}</span>
                      <span className="font-semibold text-ink">{f.value.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface2">
                      <div className="h-full rounded-full" style={{ width: `${(f.value / maxFunnel) * 100}%`, background: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }} />
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 rounded-xl bg-surface2 p-3 text-xs text-ink2">
                  <TrendingDown size={14} className="text-warning" />
                  {data.kpis.abandoned.toLocaleString("en-IN")} payment(s) abandoned in this window.
                </div>
              </div>
            </div>

            {/* By source */}
            <div className="card p-4">
              <h2 className="mb-3 font-heading text-base font-bold">By source</h2>
              {data.bySource.length === 0 ? (
                <p className="text-sm text-muted">No attributed traffic yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="py-2 pr-2">Source</th>
                        <th className="px-2 py-2 text-right">Visitors</th>
                        <th className="px-2 py-2 text-right">Paid</th>
                        <th className="px-2 py-2 text-right">Conv %</th>
                        <th className="py-2 pl-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bySource.map((r) => (
                        <tr key={r.source} className="border-b border-line/60 last:border-0">
                          <td className="py-2 pr-2 font-semibold capitalize text-ink">{r.source}</td>
                          <td className="px-2 py-2 text-right">{r.visitors.toLocaleString("en-IN")}</td>
                          <td className="px-2 py-2 text-right">{r.paid.toLocaleString("en-IN")}</td>
                          <td className="px-2 py-2 text-right">{r.conversion}%</td>
                          <td className="py-2 pl-2 text-right font-semibold">{formatINR(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "green" }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted">{icon}<span className="text-xs font-medium">{label}</span></div>
      <p className={`mt-1.5 font-heading text-2xl font-extrabold ${tone === "green" ? "text-success" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
