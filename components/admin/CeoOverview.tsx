"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PageHeader, LoadingBlock } from "@/components/admin/ui";
import SplitPreviewCard, { type SplitRow } from "@/components/admin/SplitPreviewCard";
import { formatINR, formatISTDateTime } from "@/lib/dates";

// Heavy (Recharts) trend charts sit below the fold — load them lazily so Recharts
// stays out of the initial /admin bundle. A same-height skeleton avoids layout shift.
const ChartFallback = () => <div className="skeleton h-64 w-full animate-shimmer rounded-xl" />;
const RevenueTrend = dynamic(() => import("@/components/admin/CeoCharts").then((m) => m.RevenueTrend), { ssr: false, loading: ChartFallback });
const SuccessTrend = dynamic(() => import("@/components/admin/CeoCharts").then((m) => m.SuccessTrend), { ssr: false, loading: ChartFallback });

// ---- Types (mirror lib/analytics/ceoOverview.CeoOverviewResult; kept local so no
// server-only module is pulled into the client bundle) ----
interface GlanceMetric {
  value: number | null;
  prev: number | null;
  deltaPct: number | null;
  deltaPts: number | null;
  isRate: boolean;
  isMoney: boolean;
}
type LineKey = "course" | "webinar" | "plan";
interface CeoOverview {
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  preset: Preset;
  excludeAdmin: boolean;
  canRevenue: boolean;
  generatedAt: string;
  glance: {
    revenue: GlanceMetric;
    paidStudents: GlanceMetric;
    successRate: GlanceMetric;
    registrationToPaid: GlanceMetric;
    newPayingCustomers: GlanceMetric;
    avgRevenuePerStudent: GlanceMetric;
  };
  money: {
    revenueByLine: { line: LineKey; label: string; revenue: number; paidStudents: number }[];
    refunds: number;
    atRisk: { verifyingAmount: number; abandonedValue: number; courseOutstanding: number; total: number };
    trend: { day: string; revenue: number; paid: number }[];
  };
  funnel: {
    steps: { label: string; value: number; conversionFromPrev: number | null }[];
    topWebinars: { slug: string; title: string; registrations: number; paid: number; attended: number; revenue: number }[];
    successTrend: { day: string; rate: number | null }[];
  };
  attention: { id: string; severity: "danger" | "warn" | "info"; label: string; detail: string }[];
  today: {
    revenue: number;
    paidRegistrations: number;
    webinarPaid: number;
    coursePaid: number;
    planPaid: number;
    upcomingWebinars: { slug: string; title: string; datetime: string; registrations: number; paid: number }[];
  };
  future: string[];
}

type Preset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "custom";
const PRESET_LABELS: Record<Preset, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "7 days", "30d": "30 days", this_month: "This month", custom: "Custom",
};
const PRESET_SUB: Record<Preset, string> = {
  today: "vs yesterday", yesterday: "vs day before", "7d": "vs prior 7 days", "30d": "vs prior 30 days", this_month: "vs prior period", custom: "vs prior period",
};

const nf = (n: number) => n.toLocaleString("en-IN");
const LINE_COLOR: Record<LineKey, string> = { course: "#0057FF", webinar: "#7C3AED", plan: "#0891B2" };

export default function CeoOverview() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [excludeAdmin, setExcludeAdmin] = useState(false);
  const [data, setData] = useState<CeoOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ preset });
    if (preset === "custom" && customFrom && customTo) { p.set("from", customFrom); p.set("to", customTo); }
    if (excludeAdmin) p.set("excludeAdmin", "1");
    return p.toString();
  }, [preset, customFrom, customTo, excludeAdmin]);

  const load = useCallback(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(false);
    fetch(`/api/admin/overview?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setData(d.overview); else { setData(null); setError(true); } })
      .catch(() => { setData(null); setError(true); })
      .finally(() => setLoading(false));
  }, [qs, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const sub = PRESET_SUB[preset];

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Your business at a glance — reconciled to Payments & Business Analytics"
        action={
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <input type="checkbox" checked={excludeAdmin} onChange={(e) => setExcludeAdmin(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Exclude admin traffic
          </label>
        }
      />

      {/* Date-range control (IST) — drives every card except the fixed today snapshot. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
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
      </div>

      {loading ? (
        <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>
      ) : error || !data ? (
        <div className="card p-10 text-center text-sm text-muted">Couldn&apos;t load the overview. Please try again.</div>
      ) : (
        <div className="pay-stagger space-y-6">
          {/* ===== Morning glance — the six most trustworthy hard numbers ===== */}
          <section>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              <GlanceCard label="Revenue" metric={data.glance.revenue} sub={sub} canRevenue={data.canRevenue} />
              <GlanceCard label="Paid students" metric={data.glance.paidStudents} sub={sub} canRevenue />
              <GlanceCard label="Payment success rate" metric={data.glance.successRate} sub={sub} canRevenue />
              <GlanceCard label="Registration → paid" metric={data.glance.registrationToPaid} sub={sub} canRevenue />
              <GlanceCard label="New paying customers" metric={data.glance.newPayingCustomers} sub={sub} canRevenue />
              <GlanceCard label="Avg revenue / student" metric={data.glance.avgRevenuePerStudent} sub={sub} canRevenue={data.canRevenue} />
            </div>
          </section>

          {/* ===== Is money healthy? ===== */}
          <section className="space-y-3">
            <SectionTitle>Is money healthy?</SectionTitle>
            <div className="card p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Revenue trend (IST, per day)</p>
                {data.canRevenue && (
                  <p className="text-sm text-muted">Total: <span className="font-bold text-ink">{formatINR(data.money.trend.reduce((a, d) => a + d.revenue, 0))}</span></p>
                )}
              </div>
              {!data.canRevenue ? (
                <RevenueHidden />
              ) : (
                <RevenueTrend points={data.money.trend} />
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <RevenueByLineCard rows={data.money.revenueByLine} canRevenue={data.canRevenue} />
              <AtRiskCard atRisk={data.money.atRisk} canRevenue={data.canRevenue} />
              <div className="grid grid-cols-1 gap-3">
                <SplitPreviewCard
                  label="Paid students by line"
                  href="/admin/analytics"
                  total={data.money.revenueByLine.reduce((a, r) => a + r.paidStudents, 0)}
                  rows={data.money.revenueByLine.map((r): SplitRow => ({ key: r.line, label: r.label, count: r.paidStudents, color: LINE_COLOR[r.line] }))}
                  hint="paid students"
                  emptyText="No paid students in this range."
                />
                <div className="card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Refunds (range)</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums text-warning">{data.canRevenue ? formatINR(data.money.refunds) : "—"}</p>
                </div>
              </div>
            </div>
          </section>

          {/* ===== Is the funnel working? ===== */}
          <section className="space-y-3">
            <SectionTitle>Is the funnel working?</SectionTitle>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="card p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Webinar funnel</p>
                <FunnelSteps steps={data.funnel.steps} />
              </div>
              <div className="card p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Payment success rate trend</p>
                <SuccessTrend points={data.funnel.successTrend} />
              </div>
            </div>
            <SplitPreviewCard
              label="Top webinars by paid seats"
              href="/admin/payments"
              total={data.funnel.topWebinars.reduce((a, w) => a + w.paid, 0)}
              maxRows={5}
              rows={data.funnel.topWebinars.map((w): SplitRow => ({ key: w.slug, label: w.title, count: w.paid }))}
              hint="paid seats"
              emptyText="No paid webinar seats in this range."
            />
          </section>

          {/* ===== What needs my attention today? ===== */}
          <section className="space-y-3">
            <SectionTitle>What needs my attention?</SectionTitle>
            {data.attention.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-green-500/15 text-lg">✅</span>
                All clear — no thresholds tripped for this period.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {data.attention.map((a) => <AttentionChip key={a.id} chip={a} />)}
              </div>
            )}
          </section>

          {/* ===== Today snapshot (always IST today) ===== */}
          <section className="space-y-3">
            <SectionTitle>Today <span className="text-sm font-normal text-muted">· IST, live</span></SectionTitle>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <TodayStat icon="💰" label="Revenue today" value={data.canRevenue ? formatINR(data.today.revenue) : "—"} />
              <TodayStat icon="🎟️" label="Paid registrations" value={nf(data.today.paidRegistrations)} sub={`${data.today.webinarPaid} webinar · ${data.today.coursePaid} course · ${data.today.planPaid} plan`} />
              <TodayStat icon="🎥" label="Webinar seats" value={nf(data.today.webinarPaid)} />
              <TodayStat icon="🎓" label="Course seats" value={nf(data.today.coursePaid)} />
            </div>
            <div className="card p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Upcoming webinars</p>
              {data.today.upcomingWebinars.length === 0 ? (
                <p className="text-sm text-muted">No upcoming webinars scheduled.</p>
              ) : (
                <div className="space-y-2">
                  {data.today.upcomingWebinars.map((w) => (
                    <div key={w.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{w.title}</span>
                      <span className="text-xs text-muted">{formatISTDateTime(w.datetime)}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <span className="rounded-full bg-surface2 px-2 py-0.5 font-medium text-ink2">{nf(w.registrations)} regs</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{nf(w.paid)} paid</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ===== Future (needs instrumentation) ===== */}
          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-heading text-sm font-bold text-ink">Future (needs instrumentation)</summary>
            <ul className="mt-3 space-y-2 text-ink2">
              {data.future.map((f, i) => <li key={i} className="flex gap-2"><span className="text-muted">•</span><span>{f}</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-muted">Generated {formatISTDateTime(data.generatedAt)} · {data.excludeAdmin ? "admin traffic excluded" : "all traffic"}.</p>
          </details>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-heading text-lg font-extrabold text-ink">{children}</h2>;
}

/** Format a glance metric's headline value depending on its kind. */
function glanceValue(m: GlanceMetric): string {
  if (m.value === null) return "—";
  if (m.isRate) return `${m.value}%`;
  if (m.isMoney) return formatINR(m.value);
  return nf(m.value);
}

function GlanceCard({ label, metric, sub, canRevenue }: { label: string; metric: GlanceMetric; sub: string; canRevenue: boolean }) {
  const hidden = metric.isMoney && !canRevenue;
  // Rates compare in percentage-points; counts/money compare in %.
  const delta = metric.isRate ? metric.deltaPts : metric.deltaPct;
  const up = delta !== null && delta > 0;
  const down = delta !== null && delta < 0;
  const deltaText = delta === null ? null : `${up ? "▲" : down ? "▼" : "•"} ${Math.abs(delta)}${metric.isRate ? "pts" : "%"}`;
  return (
    <div className="card p-4">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1.5 font-heading text-2xl font-extrabold tabular-nums text-ink">{hidden ? "—" : glanceValue(metric)}</p>
      <div className="mt-1 flex items-center gap-1 text-xs">
        {!hidden && deltaText ? (
          <span className={`font-semibold ${up ? "text-success" : down ? "text-danger" : "text-muted"}`}>{deltaText}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
        <span className="truncate text-muted">{sub}</span>
      </div>
    </div>
  );
}

function RevenueByLineCard({ rows, canRevenue }: { rows: { line: LineKey; label: string; revenue: number; paidStudents: number }[]; canRevenue: boolean }) {
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Revenue by product line</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{canRevenue ? formatINR(total) : "—"}</p>
      {!canRevenue ? (
        <p className="mt-3 text-xs text-muted">Revenue is hidden for your account.</p>
      ) : total === 0 ? (
        <p className="mt-3 text-xs text-muted">No revenue in this range.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.line} className="flex items-center gap-2">
              <span className="flex min-w-0 basis-[34%] items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LINE_COLOR[r.line] }} />
                <span className="truncate text-xs font-medium text-ink">{r.label}</span>
              </span>
              <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface2">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max((r.revenue / max) * 100, 3)}%`, background: LINE_COLOR[r.line] }} />
              </span>
              <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ink2">{formatINR(r.revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AtRiskCard({ atRisk, canRevenue }: { atRisk: CeoOverview["money"]["atRisk"]; canRevenue: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">At-risk / uncollected ₹</p>
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="An estimate combining money awaiting verification, unrecovered abandoned attempts (PAID-wins filtered), and outstanding course installments.">proxy</span>
      </div>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-warning">{canRevenue ? formatINR(atRisk.total) : "—"}</p>
      {canRevenue && (
        <div className="mt-3 space-y-1.5 text-xs">
          <RiskRow label="Awaiting verification" value={atRisk.verifyingAmount} />
          <RiskRow label="Abandoned / failed (recoverable)" value={atRisk.abandonedValue} />
          <RiskRow label="Course fees outstanding" value={atRisk.courseOutstanding} />
        </div>
      )}
    </div>
  );
}
function RiskRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-muted">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums text-ink2">{formatINR(value)}</span>
    </div>
  );
}


function FunnelSteps({ steps }: { steps: { label: string; value: number; conversionFromPrev: number | null }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  if (steps.every((s) => s.value === 0)) return <p className="text-sm text-muted">No webinar funnel activity in this range.</p>;
  return (
    <div className="space-y-2.5">
      {steps.map((s) => (
        <div key={s.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-ink">{s.label}</span>
            <span className="shrink-0 tabular-nums text-ink2">
              <span className="font-semibold text-ink">{nf(s.value)}</span>
              {s.conversionFromPrev !== null && <span className="ml-1.5 text-muted">{s.conversionFromPrev}%</span>}
            </span>
          </div>
          <span className="relative block h-2 overflow-hidden rounded-full bg-surface2">
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.max((s.value / max) * 100, 2)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

const SEVERITY_META: Record<"danger" | "warn" | "info", { cls: string; icon: string }> = {
  danger: { cls: "border-red-200 bg-red-50 text-red-900", icon: "🚨" },
  warn: { cls: "border-orange-200 bg-orange-50 text-orange-900", icon: "⚠️" },
  info: { cls: "border-blue-200 bg-blue-50 text-blue-900", icon: "ℹ️" },
};
function AttentionChip({ chip }: { chip: { severity: "danger" | "warn" | "info"; label: string; detail: string } }) {
  const meta = SEVERITY_META[chip.severity];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${meta.cls}`}>
      <span className="text-lg leading-none">{meta.icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{chip.label}</p>
        <p className="mt-0.5 text-xs opacity-90">{chip.detail}</p>
      </div>
    </div>
  );
}

function TodayStat({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-xl">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-0.5 font-heading text-xl font-extrabold tabular-nums text-ink">{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p>}
      </div>
    </div>
  );
}

function RevenueHidden() {
  return <div className="grid h-64 place-items-center text-sm text-muted">Revenue is hidden for your account.</div>;
}
