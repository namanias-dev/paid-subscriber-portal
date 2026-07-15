"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Users, MousePointerClick, TicketCheck, IndianRupee, ArrowRight, LogIn, FileClock, Wallet,
  CreditCard, UserCheck, TrendingDown, Download, Hourglass, Receipt,
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import InfoTip from "@/components/admin/InfoTip";
import { formatINR } from "@/lib/dates";
import { METRICS, GLOBAL_NOTES, type MetricDef } from "@/lib/analytics/metrics";
// Trends is the only Recharts-backed tab; load it lazily so Recharts stays out of
// the initial /admin/analytics bundle. It renders only behind the "trends" tab.
const Trends = dynamic(() => import("@/components/admin/analytics/Trends"), {
  ssr: false,
  loading: () => <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>,
});
import ActivityTab from "@/components/admin/analytics/Activity";
import QuizTab from "@/components/admin/analytics/Quiz";
import WebinarsTab from "@/components/admin/analytics/Webinars";
import PaymentsTab from "@/components/admin/analytics/Payments";
import CampaignsTab from "@/components/admin/analytics/Campaigns";
import LeadCampaignsTab from "@/components/admin/analytics/LeadCampaigns";
import AttributionTab from "@/components/admin/analytics/Attribution";

interface Overview {
  range: { from: string; to: string };
  trackingStartISO: string | null;
  excludeAdmin: boolean;
  kpis: {
    visitors: number; sessions: number; pageViews: number; logins: number; loginUsers: number;
    registrations: number; paymentInitiated: number; paidStudents: number; paidTransactions: number;
    revenue: number; abandoned: number; proofPending: number; verifyingAmount: number;
  };
  conversions: { visitorToPaid: number | null; registrationToPaid: number | null; paymentToPaid: number | null; avgRevenuePerStudent: number | null };
}

interface SourceRow {
  source: string; label: string; isSpecial: boolean;
  visitors: number; sessions: number; registrations: number; paymentInitiated: number;
  paidStudents: number; paidTransactions: number; revenue: number;
  visitorToPaid: number | null; registrationToPaid: number | null; paymentToPaid: number | null; avgRevenuePerStudent: number | null;
}
interface Sources { range: { from: string; to: string }; trackingStartISO: string | null; rows: SourceRow[]; totals: SourceRow }

type Preset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "custom";
const PRESET_LABELS: Record<Preset, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "7 days", "30d": "30 days", this_month: "This month", custom: "Custom",
};

type Tab = "overview" | "trends" | "activity" | "quiz" | "webinars" | "payments" | "campaigns" | "lead_campaigns" | "attribution";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "activity", label: "Student activity" },
  { id: "quiz", label: "Quiz" },
  { id: "webinars", label: "Webinars" },
  { id: "payments", label: "Payments" },
  { id: "campaigns", label: "Campaigns" },
  { id: "lead_campaigns", label: "Lead campaigns" },
  { id: "attribution", label: "Attribution (Meta)" },
];

const nf = (n: number) => n.toLocaleString("en-IN");
const pctStr = (v: number | null) => (v === null ? "N/A" : `${v}%`);

function istDateLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function AnalyticsDashboardPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [excludeAdmin, setExcludeAdmin] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);
  const [loading, setLoading] = useState(true);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ preset });
    if (preset === "custom" && customFrom && customTo) { p.set("from", customFrom); p.set("to", customTo); }
    if (excludeAdmin) p.set("excludeAdmin", "1");
    return p.toString();
  }, [preset, customFrom, customTo, excludeAdmin]);

  const load = useCallback(() => {
    if (tab !== "overview") return;
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/analytics/overview?${qs}`).then((r) => r.json()),
      fetch(`/api/admin/analytics/sources?${qs}`).then((r) => r.json()),
    ])
      .then(([o, s]) => { setOverview(o.ok ? o.overview : null); setSources(s.ok ? s.sources : null); })
      .catch(() => { setOverview(null); setSources(null); })
      .finally(() => setLoading(false));
  }, [qs, tab, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    if (!sources) return;
    const headers = ["Source", "Unique visitors", "Sessions", "Registrations", "Payment initiated", "Paid students", "Paid transactions", "Revenue", "Visitor→Paid %", "Registration→Paid %", "Payment→Paid %", "Avg revenue/student"];
    const line = (r: SourceRow) => [
      r.label, r.visitors, r.sessions, r.registrations, r.paymentInitiated, r.paidStudents, r.paidTransactions, r.revenue,
      pctStr(r.visitorToPaid), pctStr(r.registrationToPaid), pctStr(r.paymentToPaid), r.avgRevenuePerStudent ?? "N/A",
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
    const csv = [headers.join(","), ...sources.rows.map(line), line(sources.totals)].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `analytics-sources-${preset}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const trackingStart = istDateLabel(overview?.trackingStartISO || sources?.trackingStartISO || null);

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Business Analytics</h1>
          <p className="text-sm text-muted">Acquisition, conversion &amp; revenue — every number defined, reconciled to Payments.</p>
        </div>
        <Link href="/admin/analytics/segments" className="btn btn-secondary text-sm">
          Re-engagement segments <ArrowRight size={15} />
        </Link>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap overflow-hidden rounded-xl border border-line">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button key={p} onClick={() => setPreset(p)} className={`px-3 py-2 text-sm font-semibold transition ${preset === p ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="inline-flex items-center gap-1.5">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
            <span className="text-muted">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
          </div>
        )}
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <input type="checkbox" checked={excludeAdmin} onChange={(e) => setExcludeAdmin(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          Exclude admin traffic
        </label>
      </div>

      {/* Tabs */}
      <div className="-mb-1 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trends" && <Trends qs={qs} />}
      {tab === "activity" && <ActivityTab qs={qs} />}
      {tab === "quiz" && <QuizTab qs={qs} />}
      {tab === "webinars" && <WebinarsTab qs={qs} />}
      {tab === "payments" && <PaymentsTab qs={qs} />}
      {tab === "campaigns" && <CampaignsTab qs={qs} />}
      {tab === "lead_campaigns" && <LeadCampaignsTab />}
      {tab === "attribution" && <AttributionTab qs={qs} />}

      {tab === "overview" && (loading ? (
        <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>
      ) : !overview ? (
        <div className="card p-10 text-center text-sm text-muted">No analytics yet. Data appears as visitors arrive.</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi def={METRICS.visitors} icon={<Users size={16} />} value={nf(overview.kpis.visitors)} hint={`${nf(overview.kpis.pageViews)} page views · ${nf(overview.kpis.sessions)} sessions`} />
            <Kpi def={METRICS.registrations} icon={<MousePointerClick size={16} />} value={nf(overview.kpis.registrations)} />
            <Kpi def={METRICS.paymentInitiated} icon={<CreditCard size={16} />} value={nf(overview.kpis.paymentInitiated)} hint={`${nf(overview.kpis.abandoned)} abandoned`} />
            <Kpi def={METRICS.logins} icon={<LogIn size={16} />} value={nf(overview.kpis.logins)} hint={`${nf(overview.kpis.loginUsers)} unique users`} />
            <Kpi def={METRICS.paidStudents} icon={<UserCheck size={16} />} value={nf(overview.kpis.paidStudents)} tone="green" />
            <Kpi def={METRICS.paidTransactions} icon={<TicketCheck size={16} />} value={nf(overview.kpis.paidTransactions)} tone="green" />
            <Kpi def={METRICS.revenue} icon={<IndianRupee size={16} />} value={formatINR(overview.kpis.revenue)} tone="green" />
            <Kpi def={METRICS.verifyingAmount} icon={<Hourglass size={16} />} value={formatINR(overview.kpis.verifyingAmount)} hint={`${nf(overview.kpis.proofPending)} proofs pending`} tone="amber" />
          </div>

          {/* Conversion cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi def={METRICS.visitorToPaid} icon={<TrendingDown size={16} />} value={pctStr(overview.conversions.visitorToPaid)} />
            <Kpi def={METRICS.registrationToPaid} icon={<TrendingDown size={16} />} value={pctStr(overview.conversions.registrationToPaid)} />
            <Kpi def={METRICS.paymentToPaid} icon={<TrendingDown size={16} />} value={pctStr(overview.conversions.paymentToPaid)} />
            <Kpi def={METRICS.avgRevenuePerStudent} icon={<Wallet size={16} />} value={overview.conversions.avgRevenuePerStudent === null ? "N/A" : formatINR(overview.conversions.avgRevenuePerStudent)} />
          </div>

          {/* By source */}
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-heading text-base font-bold">By source</h2>
              <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface2">
                <Download size={13} /> Export CSV
              </button>
            </div>
            {!sources || sources.rows.length === 0 ? (
              <p className="text-sm text-muted">No attributed traffic yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <Th>Source</Th>
                      <Th right def={METRICS.visitors}>Visitors</Th>
                      <Th right def={METRICS.sessions}>Sessions</Th>
                      <Th right def={METRICS.registrations}>Regs</Th>
                      <Th right def={METRICS.paymentInitiated}>Pay init.</Th>
                      <Th right def={METRICS.paidStudents}>Paid students</Th>
                      <Th right def={METRICS.paidTransactions}>Paid txns</Th>
                      <Th right def={METRICS.revenue}>Revenue</Th>
                      <Th right def={METRICS.visitorToPaid}>V→Paid</Th>
                      <Th right def={METRICS.registrationToPaid}>R→Paid</Th>
                      <Th right def={METRICS.paymentToPaid}>P→Paid</Th>
                      <Th right def={METRICS.avgRevenuePerStudent}>Avg/student</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.rows.map((r) => (
                      <tr key={r.source} className={`border-b border-line/60 last:border-0 ${r.isSpecial ? "bg-surface2/40 text-muted" : ""}`}>
                        <td className={`py-2 pr-2 font-semibold ${r.isSpecial ? "text-muted" : "text-ink"}`}>{r.label}</td>
                        <Td>{nf(r.visitors)}</Td>
                        <Td>{nf(r.sessions)}</Td>
                        <Td>{nf(r.registrations)}</Td>
                        <Td>{nf(r.paymentInitiated)}</Td>
                        <Td>{nf(r.paidStudents)}</Td>
                        <Td>{nf(r.paidTransactions)}</Td>
                        <Td className="font-semibold">{formatINR(r.revenue)}</Td>
                        <Td muted={r.visitorToPaid === null}>{pctStr(r.visitorToPaid)}</Td>
                        <Td muted={r.registrationToPaid === null}>{pctStr(r.registrationToPaid)}</Td>
                        <Td muted={r.paymentToPaid === null}>{pctStr(r.paymentToPaid)}</Td>
                        <Td muted={r.avgRevenuePerStudent === null}>{r.avgRevenuePerStudent === null ? "N/A" : formatINR(r.avgRevenuePerStudent)}</Td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-line font-semibold">
                      <td className="py-2 pr-2 text-ink">{sources.totals.label}</td>
                      <Td>{nf(sources.totals.visitors)}</Td>
                      <Td>{nf(sources.totals.sessions)}</Td>
                      <Td>{nf(sources.totals.registrations)}</Td>
                      <Td>{nf(sources.totals.paymentInitiated)}</Td>
                      <Td>{nf(sources.totals.paidStudents)}</Td>
                      <Td>{nf(sources.totals.paidTransactions)}</Td>
                      <Td>{formatINR(sources.totals.revenue)}</Td>
                      <Td muted>{pctStr(sources.totals.visitorToPaid)}</Td>
                      <Td muted={sources.totals.registrationToPaid === null}>{pctStr(sources.totals.registrationToPaid)}</Td>
                      <Td muted={sources.totals.paymentToPaid === null}>{pctStr(sources.totals.paymentToPaid)}</Td>
                      <Td muted={sources.totals.avgRevenuePerStudent === null}>{sources.totals.avgRevenuePerStudent === null ? "N/A" : formatINR(sources.totals.avgRevenuePerStudent)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* About these numbers */}
          <details className="card p-4 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 font-heading text-base font-bold">
              <Receipt size={16} className="text-primary" /> About these numbers
            </summary>
            <ul className="mt-3 space-y-2 text-ink2">
              {GLOBAL_NOTES.map((n, i) => (
                <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{n.replace("{trackingStart}", trackingStart)}</span></li>
              ))}
            </ul>
          </details>
        </>
      ))}
    </div>
  );
}

function Kpi({ def, icon, value, hint, tone }: { def: MetricDef; icon: React.ReactNode; value: string; hint?: string; tone?: "green" | "amber" }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="inline-flex items-center text-xs font-medium">{def.label}<InfoTip label={def.label} meaning={def.meaning} formula={def.formula} /></span>
      </div>
      <p className={`mt-1.5 font-heading text-2xl font-extrabold ${tone === "green" ? "text-success" : tone === "amber" ? "text-warning" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Th({ children, right, def }: { children?: React.ReactNode; right?: boolean; def?: MetricDef }) {
  return (
    <th className={`py-2 ${right ? "px-2 text-right" : "pr-2"}`}>
      <span className="inline-flex items-center">{children}{def && <InfoTip label={def.label} meaning={def.meaning} formula={def.formula} />}</span>
    </th>
  );
}

function Td({ children, className = "", muted }: { children: React.ReactNode; className?: string; muted?: boolean }) {
  return <td className={`px-2 py-2 text-right tabular-nums ${muted ? "text-muted" : ""} ${className}`}>{children}</td>;
}
