"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PageHeader, LoadingBlock } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { formatINR, formatISTDateTime } from "@/lib/dates";

const ChartFallback = () => <div className="skeleton h-40 w-full animate-shimmer rounded-xl" />;
const SparkArea = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.SparkArea), {
  ssr: false,
  loading: ChartFallback,
});
const MiniBars = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.MiniBars), {
  ssr: false,
  loading: ChartFallback,
});
const FunnelBars = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.FunnelBars), {
  ssr: false,
  loading: ChartFallback,
});

type Preset = "today" | "7d" | "30d" | "this_month" | "all_time" | "custom";

interface MetricDelta {
  value: number | null;
  prev: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  scope: "today" | "period" | "all_time";
  unavailableReason?: string;
}

interface SparkPoint {
  day: string;
  value: number;
}

interface ExecutiveOverview {
  generatedAt: string;
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  preset: Preset | string;
  excludeAdmin: boolean;
  canRevenue: boolean;
  pulse: {
    visitorsToday: MetricDelta;
    loginUsersToday: MetricDelta;
    loginCodesToday: MetricDelta;
    leadsToday: MetricDelta;
    webinarRegsToday: MetricDelta;
    seatBookingsToday: MetricDelta;
    webinarRevenue: MetricDelta;
    courseRevenue: MetricDelta;
  };
  activity: {
    visitors: MetricDelta;
    pageViews: MetricDelta;
    logins: MetricDelta;
    loginUsers: MetricDelta;
    loginCodesGenerated: MetricDelta;
    visitorTrend: SparkPoint[];
    loginTrend: SparkPoint[];
    loginAverages: { daily: number | null; weekly: number | null; monthly: number | null };
    topPages: {
      path: string;
      views: number;
      uniqueVisitors: number;
      clicks: number;
      prevViews: number | null;
    }[];
    newVsReturningLogins: { newUsers: number | null; returningUsers: number | null; unavailableReason?: string };
  };
  leads: {
    totalPeriod: MetricDelta;
    today: MetricDelta;
    metaToday: MetricDelta;
    metaPeriod: MetricDelta;
    trend: SparkPoint[];
    bySource: { source: string; count: number }[];
  };
  webinars: {
    regsToday: MetricDelta;
    revenue: MetricDelta;
    trend: SparkPoint[];
    top: WebinarRow[];
    recent: WebinarRow[];
    paymentFunnel: { paid: number; abandoned: number; failed: number; pending: number };
  };
  courses: {
    seatBookingsToday: MetricDelta;
    seatBookingsAllTime: MetricDelta;
    revenue: MetricDelta;
    trend: SparkPoint[];
    top: CourseRow[];
    recent: CourseRow[];
  };
  admissionFunnel: {
    stages: { key: string; label: string; count: number }[];
    byCourse: { courseId: string; title: string; stages: { key: string; label: string; count: number }[] }[];
  };
  collections: {
    overdueCount: MetricDelta;
    overdueAmount: MetricDelta;
    blockedCount: MetricDelta;
    graceCount: MetricDelta;
    aging: { bucket: string; count: number; amount: number }[];
    upcomingDue: { count: number; amount: number };
  };
  engagement: {
    quizAttemptsToday: MetricDelta;
    quizTrend: SparkPoint[];
    topQuizzes: { id: string; title: string; attempts: number }[];
    caTop: { slug: string; title: string; views: number }[];
    resourceDownloads: { id: string; title: string; downloads: number }[];
    resourceDownloadEvents: MetricDelta;
  };
  sms: {
    sent: number;
    delivered: number | null;
    failed: number;
    pending: number;
    deliveryRate: number | null;
    failureRate: number | null;
    deliveryKnown: boolean;
    trend: SparkPoint[];
  };
  unavailable: string[];
}

interface WebinarRow {
  id: string;
  slug: string;
  title: string;
  datetime: string;
  registrations: number;
  paid: number;
  revenue: number;
  conversionPct: number | null;
  status: { paid: number; abandoned: number; failed: number; pending: number };
}

interface CourseRow {
  courseId: string;
  slug: string;
  title: string;
  batchStart: string | null;
  seatBookings: number;
  confirmedAdmissions: number;
  revenue: number;
  progressLabel: string;
}

type DetailState =
  | { kind: "login" }
  | { kind: "page"; path: string }
  | { kind: "webinar"; row: WebinarRow }
  | { kind: "course"; row: CourseRow }
  | { kind: "funnel"; stage: string; label: string }
  | { kind: "kpi"; title: string; body: string; href: string; hrefLabel: string }
  | null;

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "this_month", label: "This month" },
  { id: "all_time", label: "All time" },
  { id: "custom", label: "Custom" },
];

const nf = (n: number) => n.toLocaleString("en-IN");

function scopeLabel(scope: MetricDelta["scope"]): string {
  if (scope === "today") return "Today (IST)";
  if (scope === "all_time") return "All time";
  return "Selected period";
}

function DeltaBadge({ m }: { m: MetricDelta }) {
  if (m.value === null) return <span className="text-[11px] text-muted">Unavailable</span>;
  if (m.deltaAbs === null || m.prev === null) return null;
  const up = m.deltaAbs > 0;
  const flat = m.deltaAbs === 0;
  const color = flat ? "text-muted" : up ? "text-emerald-600" : "text-red-600";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${color}`}>
      {arrow} {Math.abs(m.deltaAbs).toLocaleString("en-IN")}
      {m.deltaPct !== null ? ` (${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%)` : ""}
    </span>
  );
}

function fmtVal(m: MetricDelta, money = false): string {
  if (m.value === null) return "—";
  return money ? formatINR(m.value) : nf(m.value);
}

function Section({
  title,
  href,
  hrefLabel,
  children,
  onClick,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="font-heading text-base font-bold tracking-tight">{title}</h2>
        <div className="flex items-center gap-3">
          {onClick && (
            <button type="button" onClick={onClick} className="text-xs font-semibold text-primary hover:underline">
              Details
            </button>
          )}
          {href && (
            <Link href={href} className="text-xs font-semibold text-ink2 hover:text-primary">
              {hrefLabel || "Open admin →"}
            </Link>
          )}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ExecKpi({
  label,
  metric,
  money,
  gold,
  onClick,
  title,
}: {
  label: string;
  metric: MetricDelta;
  money?: boolean;
  gold?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const unavailable = metric.value === null;
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className="rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
          {scopeLabel(metric.scope)}
        </span>
      </div>
      <p
        className={`mt-2 font-heading text-2xl font-extrabold tabular-nums ${
          unavailable ? "text-muted" : gold ? "text-[#9A7B0A]" : "text-ink"
        }`}
      >
        {fmtVal(metric, money)}
      </p>
      <div className="mt-1 min-h-[16px]">
        {unavailable && metric.unavailableReason ? (
          <span className="text-[11px] text-muted" title={metric.unavailableReason}>
            Unavailable
          </span>
        ) : (
          <DeltaBadge m={metric} />
        )}
      </div>
    </>
  );
  const cls =
    "rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${cls} cursor-pointer`}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} title={title}>
      {inner}
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [excludeAdmin, setExcludeAdmin] = useState(false);
  const [funnelCourseId, setFunnelCourseId] = useState<string>("");
  const [data, setData] = useState<ExecutiveOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<DetailState>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ preset });
    if (preset === "custom" && customFrom && customTo) {
      p.set("from", customFrom);
      p.set("to", customTo);
    }
    if (excludeAdmin) p.set("excludeAdmin", "1");
    return p.toString();
  }, [preset, customFrom, customTo, excludeAdmin]);

  const load = useCallback(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(false);
    fetch(`/api/admin/executive-overview?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d.overview);
        else {
          setData(null);
          setError(true);
        }
      })
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [qs, preset, customFrom, customTo]);

  useEffect(() => {
    load();
  }, [load]);

  const funnelStages = useMemo(() => {
    if (!data) return [];
    if (!funnelCourseId) return data.admissionFunnel.stages;
    return data.admissionFunnel.byCourse.find((c) => c.courseId === funnelCourseId)?.stages || data.admissionFunnel.stages;
  }, [data, funnelCourseId]);

  const openKpi = (title: string, body: string, href: string, hrefLabel: string) =>
    setDetail({ kind: "kpi", title, body, href, hrefLabel });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Executive command dashboard · Asia/Kolkata · confirmed payments only for revenue"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={excludeAdmin}
                onChange={(e) => setExcludeAdmin(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Exclude admin traffic
            </label>
            <button
              type="button"
              onClick={load}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold hover:border-primary/40"
            >
              Refresh
            </button>
          </div>
        }
      />

      {/* Global controls */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              preset === p.id ? "bg-primary text-white shadow-sm" : "bg-surface2 text-ink2 hover:bg-line/60"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="ml-1 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
            />
          </div>
        )}
        {data && (
          <p className="ml-auto text-[11px] text-muted">
            Last updated {formatISTDateTime(data.generatedAt)} IST
          </p>
        )}
      </div>

      {loading && !data && <LoadingBlock />}
      {error && !data && (
        <div className="card border-red-200 bg-red-50/50 p-5 text-sm text-red-700">
          Could not load overview. Refresh to retry. Other admin pages are unaffected.
        </div>
      )}

      {data && (
        <>
          {loading && (
            <p className="text-xs font-medium text-muted">Refreshing…</p>
          )}

          {/* 1. Executive pulse */}
          <div>
            <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-wider text-muted">
              Executive pulse
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ExecKpi
                label="Website visitors"
                metric={data.pulse.visitorsToday}
                title="Unique visitor_id from analytics_events today (public site + portal pages)."
                onClick={() =>
                  openKpi(
                    "Website visitors today",
                    `Unique visitors today: ${fmtVal(data.pulse.visitorsToday)}. Source: analytics_events (visitor_id). Separate from authenticated logins.`,
                    "/admin/analytics",
                    "Open Analytics",
                  )
                }
              />
              <ExecKpi
                label="Logged-in users"
                metric={data.pulse.loginUsersToday}
                title="Unique authenticated login events today."
                onClick={() => setDetail({ kind: "login" })}
              />
              <ExecKpi
                label="Login codes generated"
                metric={data.pulse.loginCodesToday}
                title="New non-staff buyer accounts created today."
                onClick={() =>
                  openKpi(
                    "Login codes today",
                    `New buyer accounts (login codes) created today: ${fmtVal(data.pulse.loginCodesToday)}.`,
                    "/admin/students",
                    "Open Students",
                  )
                }
              />
              <ExecKpi
                label="Leads collected"
                metric={data.pulse.leadsToday}
                onClick={() =>
                  openKpi(
                    "Leads today",
                    `All CRM leads created today: ${fmtVal(data.pulse.leadsToday)}. Meta leads are a subset — see Leads section.`,
                    "/admin/leads",
                    "Open Leads",
                  )
                }
              />
              <ExecKpi
                label="Webinar registrations"
                metric={data.pulse.webinarRegsToday}
                onClick={() =>
                  openKpi(
                    "Webinar registrations today",
                    `Registration rows created today: ${fmtVal(data.pulse.webinarRegsToday)}.`,
                    "/admin/payments/webinar-registrations",
                    "Open registrations",
                  )
                }
              />
              <ExecKpi
                label="Course seat bookings"
                metric={data.pulse.seatBookingsToday}
                title="Confirmed paid seat payments (deduped)."
                onClick={() =>
                  openKpi(
                    "Seat bookings today",
                    `Confirmed seat payments today (distinct phone×course): ${fmtVal(data.pulse.seatBookingsToday)}.`,
                    "/admin/course-payments",
                    "Open course payments",
                  )
                }
              />
              <ExecKpi
                label="Webinar revenue"
                metric={data.pulse.webinarRevenue}
                money
                gold
                title="Confirmed/successful webinar payments in selected period."
                onClick={() =>
                  openKpi(
                    "Webinar revenue",
                    data.canRevenue
                      ? `Confirmed webinar revenue for selected period: ${fmtVal(data.pulse.webinarRevenue, true)}.`
                      : "Revenue hidden — missing view_revenue permission.",
                    "/admin/payments",
                    "Open Payments",
                  )
                }
              />
              <ExecKpi
                label="Course revenue"
                metric={data.pulse.courseRevenue}
                money
                gold
                title="Confirmed/successful course payments in selected period."
                onClick={() =>
                  openKpi(
                    "Course revenue",
                    data.canRevenue
                      ? `Confirmed course revenue for selected period: ${fmtVal(data.pulse.courseRevenue, true)}.`
                      : "Revenue hidden — missing view_revenue permission.",
                    "/admin/course-payments",
                    "Open course payments",
                  )
                }
              />
            </div>
          </div>

          {/* 2. Website & portal */}
          <Section title="Website & portal activity" href="/admin/analytics" hrefLabel="Analytics →">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <ExecKpi label="Visitors" metric={data.activity.visitors} />
              <ExecKpi label="Page views" metric={data.activity.pageViews} />
              <ExecKpi label="Login events" metric={data.activity.logins} onClick={() => setDetail({ kind: "login" })} />
              <ExecKpi label="Unique logins" metric={data.activity.loginUsers} onClick={() => setDetail({ kind: "login" })} />
              <ExecKpi label="Login codes" metric={data.activity.loginCodesGenerated} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Visitor trend</p>
                <SparkArea points={data.activity.visitorTrend} color="#0057FF" />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Login trend</p>
                <SparkArea points={data.activity.loginTrend} color="#00205B" />
              </div>
            </div>
            {data.activity.newVsReturningLogins.unavailableReason && (
              <p className="mt-3 text-[11px] text-muted">
                New vs returning logins: unavailable — {data.activity.newVsReturningLogins.unavailableReason}
              </p>
            )}
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-2 font-semibold">Page</th>
                    <th className="pb-2 font-semibold">Views</th>
                    <th className="pb-2 font-semibold">Unique</th>
                    <th className="pb-2 font-semibold">Clicks</th>
                    <th className="pb-2 font-semibold">Δ vs prior</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activity.topPages.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted">
                        No page views in this range.
                      </td>
                    </tr>
                  )}
                  {data.activity.topPages.map((row) => {
                    const delta =
                      row.prevViews !== null ? row.views - row.prevViews : null;
                    return (
                      <tr
                        key={row.path}
                        className="cursor-pointer border-b border-line/60 hover:bg-surface2/80"
                        onClick={() => setDetail({ kind: "page", path: row.path })}
                      >
                        <td className="py-2.5">
                          <div className="font-medium text-ink">{row.path}</div>
                        </td>
                        <td className="py-2.5 tabular-nums">{nf(row.views)}</td>
                        <td className="py-2.5 tabular-nums">{nf(row.uniqueVisitors)}</td>
                        <td className="py-2.5 tabular-nums">{nf(row.clicks)}</td>
                        <td
                          className={`py-2.5 tabular-nums text-xs font-semibold ${
                            delta === null ? "text-muted" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted"
                          }`}
                        >
                          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${nf(delta)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 3. Leads */}
          <Section
            title="Leads & acquisition"
            href="/admin/leads"
            hrefLabel="Leads CRM →"
            onClick={() =>
              openKpi(
                "Leads overview",
                `Period leads: ${fmtVal(data.leads.totalPeriod)}. Meta (subset): ${fmtVal(data.leads.metaPeriod)}. Meta is not added again on top of total.`,
                "/admin/leads",
                "Open Leads",
              )
            }
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ExecKpi label="Leads (period)" metric={data.leads.totalPeriod} />
              <ExecKpi label="Leads today" metric={data.leads.today} />
              <ExecKpi label="Meta leads today" metric={data.leads.metaToday} title="Subset of total — not additive." />
              <ExecKpi label="Meta leads (period)" metric={data.leads.metaPeriod} title="Subset of total — not additive." />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Daily lead volume</p>
                <MiniBars points={data.leads.trend} color="#7C3AED" />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By source</p>
                <ul className="space-y-1.5">
                  {data.leads.bySource.length === 0 && (
                    <li className="text-sm text-muted">No leads in this range.</li>
                  )}
                  {data.leads.bySource.map((s) => (
                    <li key={s.source} className="flex items-center justify-between rounded-lg bg-surface2 px-3 py-2 text-sm">
                      <span className="truncate font-medium">{s.source}</span>
                      <span className="tabular-nums font-semibold">{nf(s.count)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          {/* 4. Webinars */}
          <Section title="Webinar performance" href="/admin/webinars" hrefLabel="Webinars →">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ExecKpi label="Registrations today" metric={data.webinars.regsToday} />
              <ExecKpi label="Confirmed revenue" metric={data.webinars.revenue} money gold />
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Payment status (attempts)</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted">Successful</span><p className="font-bold tabular-nums text-emerald-700">{nf(data.webinars.paymentFunnel.paid)}</p></div>
                  <div><span className="text-muted">Abandoned</span><p className="font-bold tabular-nums">{nf(data.webinars.paymentFunnel.abandoned)}</p></div>
                  <div><span className="text-muted">Failed</span><p className="font-bold tabular-nums text-red-600">{nf(data.webinars.paymentFunnel.failed)}</p></div>
                  <div><span className="text-muted">Pending</span><p className="font-bold tabular-nums">{nf(data.webinars.paymentFunnel.pending)}</p></div>
                </div>
                <p className="mt-2 text-[10px] text-muted">Abandoned = payment status ABANDONED only.</p>
              </div>
            </div>
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Registration trend</p>
              <SparkArea points={data.webinars.trend} color="#7C3AED" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <WebinarTable title="Top by registrations" rows={data.webinars.top} canRevenue={data.canRevenue} onRow={(row) => setDetail({ kind: "webinar", row })} />
              <WebinarTable title="Latest / upcoming" rows={data.webinars.recent} canRevenue={data.canRevenue} onRow={(row) => setDetail({ kind: "webinar", row })} />
            </div>
          </Section>

          {/* 5. Courses */}
          <Section title="Course admissions & seat bookings" href="/admin/course-payments" hrefLabel="Course payments →">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ExecKpi label="Seat bookings today" metric={data.courses.seatBookingsToday} />
              <ExecKpi label="Seat bookings (all time)" metric={data.courses.seatBookingsAllTime} />
              <ExecKpi label="Confirmed course revenue" metric={data.courses.revenue} money gold />
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Seat booking rule</p>
                <p className="mt-2 text-xs leading-relaxed text-ink2">
                  Counted only after a confirmed paid seat payment (deduped). Amounts follow each course&apos;s configured seat fee.
                </p>
              </div>
            </div>
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Course revenue trend</p>
              <SparkArea points={data.courses.trend} color="#C9A227" money />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <CourseTable title="Top by seat bookings" rows={data.courses.top} canRevenue={data.canRevenue} onRow={(row) => setDetail({ kind: "course", row })} />
              <CourseTable title="Latest batches" rows={data.courses.recent} canRevenue={data.canRevenue} onRow={(row) => setDetail({ kind: "course", row })} />
            </div>
          </Section>

          {/* 6. Admission funnel */}
          <Section title="Admission payment funnel" href="/admin/course-payments" hrefLabel="Course payments →">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-muted">Course filter</label>
              <select
                value={funnelCourseId}
                onChange={(e) => setFunnelCourseId(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <option value="">All courses</option>
                {data.admissionFunnel.byCourse.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-3 text-[11px] text-muted">
              Unique active enrollments. Stages are cumulative. Fully paid (incl. full-fee) counts through all stages.
            </p>
            <FunnelBars
              stages={funnelStages}
              onStageClick={(key) => {
                const stage = funnelStages.find((s) => s.key === key);
                if (stage) setDetail({ kind: "funnel", stage: key, label: stage.label });
              }}
            />
          </Section>

          {/* 7. Collections */}
          <Section title="Installment & collection health" href="/admin/access-risk" hrefLabel="Access at risk →">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ExecKpi
                label="Overdue enrollments"
                metric={data.collections.overdueCount}
                onClick={() =>
                  openKpi(
                    "Overdue installments",
                    `${fmtVal(data.collections.overdueCount)} active enrollments with overdue schedule lines.`,
                    "/admin/access-risk",
                    "Open access risk",
                  )
                }
              />
              <ExecKpi label="Overdue amount" metric={data.collections.overdueAmount} money />
              <ExecKpi
                label="Access blocked"
                metric={data.collections.blockedCount}
                onClick={() =>
                  openKpi(
                    "Access blocked",
                    `${fmtVal(data.collections.blockedCount)} enrollments blocked for overdue payment (schedule rule).`,
                    "/admin/access-risk",
                    "Open access risk",
                  )
                }
              />
              <ExecKpi
                label="In grace period"
                metric={data.collections.graceCount}
                onClick={() =>
                  openKpi(
                    "Grace period",
                    `${fmtVal(data.collections.graceCount)} enrollments currently in the 15-day grace window.`,
                    "/admin/access-risk",
                    "Open access risk",
                  )
                }
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Aging (overdue)</p>
                <ul className="space-y-1.5">
                  {data.collections.aging.map((a) => (
                    <li key={a.bucket} className="flex items-center justify-between rounded-lg bg-surface2 px-3 py-2 text-sm">
                      <span>{a.bucket}</span>
                      <span className="tabular-nums">
                        <strong>{nf(a.count)}</strong>
                        {data.canRevenue ? <span className="ml-2 text-muted">{formatINR(a.amount)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Upcoming installments</p>
                <p className="mt-3 font-heading text-2xl font-extrabold tabular-nums">
                  {nf(data.collections.upcomingDue.count)}
                </p>
                <p className="mt-1 text-sm text-ink2">
                  {data.canRevenue
                    ? formatINR(data.collections.upcomingDue.amount)
                    : "Amount hidden"}{" "}
                  due on next unpaid line
                </p>
                <Link href="/admin/course-payments" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
                  View course payments →
                </Link>
              </div>
            </div>
          </Section>

          {/* 8. Engagement */}
          <Section title="Content & learning engagement" href="/admin/quizzes" hrefLabel="Quizzes →">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ExecKpi label="Quizzes taken today" metric={data.engagement.quizAttemptsToday} />
              <ExecKpi label="Resource download events" metric={data.engagement.resourceDownloadEvents} />
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">CA article views</p>
                <p className="mt-2 text-xs text-ink2">Lifetime view counters on published articles (not period-scoped).</p>
              </div>
            </div>
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Quiz attempts trend</p>
              <MiniBars points={data.engagement.quizTrend} color="#0891B2" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <RankList
                title="Top quizzes"
                rows={data.engagement.topQuizzes.map((q) => ({
                  key: q.id,
                  label: q.title,
                  value: nf(q.attempts),
                  href: `/admin/quizzes/${q.id}/edit`,
                }))}
              />
              <RankList
                title="Top current affairs"
                rows={data.engagement.caTop.map((a) => ({
                  key: a.slug,
                  label: a.title,
                  value: nf(a.views),
                  href: "/admin/current-affairs",
                }))}
              />
              <RankList
                title="Top downloads"
                rows={data.engagement.resourceDownloads.map((r) => ({
                  key: r.id,
                  label: r.title,
                  value: nf(r.downloads),
                  href: "/admin/current-affairs/pdfs",
                }))}
              />
            </div>
          </Section>

          {/* 9. SMS */}
          <Section title="SMS delivery performance" href="/admin/communications/sms" hrefLabel="SMS Mission Control →">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <button
                type="button"
                className="rounded-2xl border border-line bg-surface p-4 text-left hover:border-primary/30"
                onClick={() =>
                  openKpi("SMS sent", `Total SMS records in selected period: ${nf(data.sms.sent)}.`, "/admin/communications/sms", "Open SMS logs")
                }
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Sent</p>
                <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums">{nf(data.sms.sent)}</p>
              </button>
              <button
                type="button"
                className="rounded-2xl border border-line bg-surface p-4 text-left hover:border-primary/30"
                onClick={() =>
                  openKpi(
                    "SMS delivered",
                    data.sms.delivered === null
                      ? "No DELIVERED receipts in this window — delivery rate unavailable."
                      : `Delivered: ${nf(data.sms.delivered)}.`,
                    "/admin/communications/sms",
                    "Open SMS logs",
                  )
                }
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Delivered</p>
                <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums text-emerald-700">
                  {data.sms.delivered === null ? "—" : nf(data.sms.delivered)}
                </p>
              </button>
              <button
                type="button"
                className="rounded-2xl border border-line bg-surface p-4 text-left hover:border-primary/30"
                onClick={() =>
                  openKpi("SMS failed", `Failed: ${nf(data.sms.failed)}.`, "/admin/communications/sms", "Open SMS logs")
                }
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Failed</p>
                <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums text-red-600">{nf(data.sms.failed)}</p>
              </button>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Pending / unknown</p>
                <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums">{nf(data.sms.pending)}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Rates</p>
                <p className="mt-2 text-sm">
                  Delivery{" "}
                  <strong className="tabular-nums">
                    {data.sms.deliveryRate === null ? "—" : `${data.sms.deliveryRate}%`}
                  </strong>
                </p>
                <p className="text-sm">
                  Failure{" "}
                  <strong className="tabular-nums text-red-600">
                    {data.sms.failureRate === null ? "—" : `${data.sms.failureRate}%`}
                  </strong>
                </p>
              </div>
            </div>
            <p className="mb-2 text-[11px] text-muted">
              Status totals reconcile: delivered + failed + pending = sent ({nf(data.sms.sent)}).
            </p>
            <SparkArea points={data.sms.trend} color="#0891B2" />
          </Section>

          {data.unavailable.length > 0 && (
            <details className="rounded-xl border border-line bg-surface2/50 px-4 py-3 text-xs text-muted">
              <summary className="cursor-pointer font-semibold text-ink2">Metric notes ({data.unavailable.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {data.unavailable.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={
          detail?.kind === "login"
            ? "Login activity"
            : detail?.kind === "page"
              ? "Page details"
              : detail?.kind === "webinar"
                ? detail.row.title
                : detail?.kind === "course"
                  ? detail.row.title
                  : detail?.kind === "funnel"
                    ? detail.label
                    : detail?.kind === "kpi"
                      ? detail.title
                      : undefined
        }
        maxWidth="max-w-xl"
      >
        {detail?.kind === "login" && data && (
          <div className="space-y-3 text-sm">
            <p>
              Unique users today: <strong className="tabular-nums">{fmtVal(data.pulse.loginUsersToday)}</strong>
            </p>
            <p>
              Login events (period): <strong className="tabular-nums">{fmtVal(data.activity.logins)}</strong>
            </p>
            <p>
              Unique users (period): <strong className="tabular-nums">{fmtVal(data.activity.loginUsers)}</strong>
            </p>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface2 p-3">
              <div>
                <p className="text-[10px] uppercase text-muted">Daily avg</p>
                <p className="font-bold tabular-nums">{data.activity.loginAverages.daily ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted">Weekly avg</p>
                <p className="font-bold tabular-nums">{data.activity.loginAverages.weekly ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted">Monthly avg</p>
                <p className="font-bold tabular-nums">{data.activity.loginAverages.monthly ?? "—"}</p>
              </div>
            </div>
            <SparkArea points={data.activity.loginTrend} color="#00205B" height={140} />
            <p className="text-xs text-muted">
              New vs returning: unavailable — {data.activity.newVsReturningLogins.unavailableReason}
            </p>
            <Link href="/admin/analytics" className="inline-block text-sm font-semibold text-primary hover:underline">
              View full analytics →
            </Link>
          </div>
        )}
        {detail?.kind === "page" && (
          <div className="space-y-3 text-sm">
            <p className="font-mono text-xs">{detail.path}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={detail.path} className="text-sm font-semibold text-primary hover:underline" target="_blank">
                Open page →
              </Link>
              <Link href="/admin/analytics" className="text-sm font-semibold text-ink2 hover:underline">
                View analytics →
              </Link>
            </div>
          </div>
        )}
        {detail?.kind === "webinar" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{formatISTDateTime(detail.row.datetime)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Registrations" value={nf(detail.row.registrations)} />
              <Stat label="Paid" value={nf(detail.row.paid)} />
              <Stat label="Conversion" value={detail.row.conversionPct === null ? "—" : `${detail.row.conversionPct}%`} />
              <Stat label="Revenue" value={data?.canRevenue ? formatINR(detail.row.revenue) : "—"} />
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <Stat label="OK" value={nf(detail.row.status.paid)} />
              <Stat label="Abandoned" value={nf(detail.row.status.abandoned)} />
              <Stat label="Failed" value={nf(detail.row.status.failed)} />
              <Stat label="Pending" value={nf(detail.row.status.pending)} />
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href={`/admin/webinars/${detail.row.id}/edit`} className="text-sm font-semibold text-primary hover:underline">
                Webinar admin →
              </Link>
              <Link href={`/admin/webinars/${detail.row.id}/registrations`} className="text-sm font-semibold text-primary hover:underline">
                Registrations →
              </Link>
              <Link href={`/admin/payments?q=${encodeURIComponent(detail.row.slug)}`} className="text-sm font-semibold text-primary hover:underline">
                Filtered payments →
              </Link>
            </div>
          </div>
        )}
        {detail?.kind === "course" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              Batch start: {detail.row.batchStart ? formatISTDateTime(detail.row.batchStart) : "—"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Seat bookings" value={nf(detail.row.seatBookings)} />
              <Stat label="Paying / admitted" value={nf(detail.row.confirmedAdmissions)} />
              <Stat label="Revenue" value={data?.canRevenue ? formatINR(detail.row.revenue) : "—"} />
              <Stat label="Progress" value={detail.row.progressLabel} />
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href={`/admin/courses/${detail.row.courseId}/edit`} className="text-sm font-semibold text-primary hover:underline">
                Edit course →
              </Link>
              <Link href={`/admin/course-payments/${detail.row.courseId}`} className="text-sm font-semibold text-primary hover:underline">
                Course payments →
              </Link>
            </div>
          </div>
        )}
        {detail?.kind === "funnel" && (
          <div className="space-y-3 text-sm">
            <p>
              Stage <strong>{detail.label}</strong>
              {funnelCourseId ? " (filtered course)" : " (all courses)"}.
            </p>
            <p className="text-xs text-muted">
              Counts unique active enrollments. Open course payments to work the matching cohort.
            </p>
            <Link
              href={funnelCourseId ? `/admin/course-payments/${funnelCourseId}` : "/admin/course-payments"}
              className="inline-block text-sm font-semibold text-primary hover:underline"
            >
              View full details →
            </Link>
          </div>
        )}
        {detail?.kind === "kpi" && (
          <div className="space-y-3 text-sm">
            <p className="leading-relaxed text-ink2">{detail.body}</p>
            <Link href={detail.href} className="inline-block text-sm font-semibold text-primary hover:underline">
              {detail.hrefLabel} →
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function WebinarTable({
  title,
  rows,
  canRevenue,
  onRow,
}: {
  title: string;
  rows: WebinarRow[];
  canRevenue: boolean;
  onRow: (row: WebinarRow) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {rows.length === 0 && <li className="px-3 py-4 text-sm text-muted">No webinars.</li>}
        {rows.map((w) => (
          <li key={w.slug}>
            <button type="button" onClick={() => onRow(w)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{w.title}</p>
                <p className="text-[11px] text-muted">{formatISTDateTime(w.datetime)}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="font-bold tabular-nums">{nf(w.registrations)} regs</p>
                <p className="text-muted">{nf(w.paid)} paid · {w.conversionPct ?? "—"}%</p>
                {canRevenue && <p className="text-[#9A7B0A]">{formatINR(w.revenue)}</p>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CourseTable({
  title,
  rows,
  canRevenue,
  onRow,
}: {
  title: string;
  rows: CourseRow[];
  canRevenue: boolean;
  onRow: (row: CourseRow) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {rows.length === 0 && <li className="px-3 py-4 text-sm text-muted">No courses.</li>}
        {rows.map((c) => (
          <li key={c.courseId}>
            <button type="button" onClick={() => onRow(c)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.title}</p>
                <p className="text-[11px] text-muted">
                  {c.batchStart ? formatISTDateTime(c.batchStart) : "No batch start"} · {c.progressLabel}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="font-bold tabular-nums">{nf(c.seatBookings)} seats</p>
                <p className="text-muted">{nf(c.confirmedAdmissions)} paying</p>
                {canRevenue && <p className="text-[#9A7B0A]">{formatINR(c.revenue)}</p>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RankList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: string; href: string }[];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="space-y-1">
        {rows.length === 0 && <li className="text-sm text-muted">None yet.</li>}
        {rows.map((r) => (
          <li key={r.key}>
            <Link
              href={r.href}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface2"
            >
              <span className="truncate font-medium">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted">{r.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
