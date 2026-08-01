"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { formatINR, formatISTDateTime, istTodayYMD } from "@/lib/dates";

const ChartFallback = () => <div className="skeleton h-40 w-full animate-shimmer rounded-xl" />;
const SparkArea = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.SparkArea), { ssr: false, loading: ChartFallback });
const MiniBars = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.MiniBars), { ssr: false, loading: ChartFallback });
const FunnelBars = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.FunnelBars), { ssr: false, loading: ChartFallback });
const ExplorerLines = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.ExplorerLines), { ssr: false, loading: ChartFallback });
const CssSpark = dynamic(() => import("@/components/admin/ExecutiveCharts").then((m) => m.CssSpark), {
  ssr: false,
  loading: () => <div className="h-11 w-24 animate-shimmer rounded bg-surface2" />,
});

type Preset = "today" | "7d" | "30d" | "this_month" | "all_time";
type TrafficWindow = "7d" | "14d" | "30d";
type ExplorerFrame = "7d" | "14d" | "30d" | "90d" | "this_month" | "all" | "custom";

interface MetricDelta {
  value: number | null;
  prev: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  scope: "today" | "period" | "all_time";
  unavailableReason?: string;
}
interface SparkPoint { day: string; value: number }
interface HistorySeries {
  visitors: SparkPoint[];
  logins: SparkPoint[];
  loginUsers: SparkPoint[];
  webinarPaid: SparkPoint[];
  leads: SparkPoint[];
  seatBookings: SparkPoint[];
  webinarRevenue: SparkPoint[];
  courseRevenue: SparkPoint[];
}
interface WebinarRow {
  id: string; slug: string; title: string; datetime: string;
  registrations: number; paid: number; revenue: number; conversionPct: number | null;
  status: { paid: number; abandoned: number; failed: number; pending: number };
}
interface CourseRow {
  courseId: string; slug: string; title: string; batchStart: string | null;
  seatBookings: number; confirmedAdmissions: number; revenue: number; progressLabel: string;
}

interface PulseData {
  generatedAt: string;
  range: { from: string; to: string };
  preset: string;
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
  history: HistorySeries;
  unavailable: string[];
}

interface BodyData {
  activity: {
    visitors: MetricDelta; pageViews: MetricDelta; logins: MetricDelta; loginUsers: MetricDelta;
    loginCodesGenerated: MetricDelta; visitorTrend: SparkPoint[]; loginTrend: SparkPoint[];
    loginAverages: { daily: number | null; weekly: number | null; monthly: number | null };
    topPages: { path: string; views: number; uniqueVisitors: number; clicks: number; prevViews: number | null }[];
    newVsReturningLogins: { unavailableReason?: string };
  };
  leads: {
    totalPeriod: MetricDelta; today: MetricDelta; metaToday: MetricDelta; metaPeriod: MetricDelta;
    trend: SparkPoint[]; bySource: { source: string; count: number }[];
  };
  webinars: {
    regsToday: MetricDelta; revenue: MetricDelta; trend: SparkPoint[];
    top: WebinarRow[]; recent: WebinarRow[];
    paymentFunnel: { paid: number; abandoned: number; failed: number; pending: number };
  };
  courses: {
    seatBookingsToday: MetricDelta; seatBookingsAllTime: MetricDelta; revenue: MetricDelta;
    trend: SparkPoint[]; top: CourseRow[]; recent: CourseRow[];
  };
  admissionFunnel: {
    stages: { key: string; label: string; count: number }[];
    byCourse: { courseId: string; title: string; stages: { key: string; label: string; count: number }[] }[];
  };
  collections: {
    overdueCount: MetricDelta; overdueAmount: MetricDelta; blockedCount: MetricDelta; graceCount: MetricDelta;
    aging: { bucket: string; count: number; amount: number }[];
    upcomingDue: { count: number; amount: number };
  };
  engagement: {
    quizAttemptsToday: MetricDelta; quizUniqueToday: MetricDelta; quizTrend: SparkPoint[];
    topQuizzes: { id: string; title: string; attempts: number; uniqueStudents: number }[];
    caTop: { slug: string; title: string; views: number }[];
    resourceDownloads: { id: string; title: string; downloads: number }[];
    resourceDownloadEvents: MetricDelta;
  };
  sms: {
    sent: number; delivered: number | null; failed: number; pending: number;
    deliveryRate: number | null; failureRate: number | null; deliveryKnown: boolean; trend: SparkPoint[];
  };
  unavailable?: string[];
}

const nf = (n: number) => n.toLocaleString("en-IN");

/** Body sections use a fixed 30d window — no page-level time filter. */
const BODY_PRESET: Preset = "30d";

const TRAFFIC_WINDOWS: { id: TrafficWindow; label: string }[] = [
  { id: "7d", label: "7D" },
  { id: "14d", label: "14D" },
  { id: "30d", label: "30D" },
];

const EXPLORER_FRAMES: { id: ExplorerFrame; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "this_month", label: "This month" },
  { id: "all", label: "All available" },
];

/** Payments-style entry card — restored from Overview v2 (68f0df51). */
const CARD =
  "card flex h-full min-h-[104px] w-full items-center gap-4 p-4 text-left transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/30 motion-reduce:transform-none motion-reduce:transition-none";

function fmtVal(m: MetricDelta, money = false): string {
  if (m.value === null) return "—";
  return money ? formatINR(m.value) : nf(m.value);
}

function safeDeltaPct(value: number, prev: number): number | null {
  if (prev === 0) return null;
  const pct = ((value - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}

function sumSeriesMonth(series: SparkPoint[] | undefined, yyyymm: string): number {
  if (!series?.length) return 0;
  return series.reduce((acc, p) => (p.day.startsWith(yyyymm) ? acc + p.value : acc), 0);
}

function buildExplorerPoints(
  history: HistorySeries | undefined,
  frame: ExplorerFrame,
  customFrom: string,
  customTo: string,
): { day: string; visitors: number; logins: number; webinarPaid: number }[] {
  if (!history?.visitors?.length) return [];
  const visitors = history.visitors;
  const loginByDay = new Map(history.loginUsers.map((p) => [p.day, p.value]));
  const webinarByDay = new Map(history.webinarPaid.map((p) => [p.day, p.value]));

  let days = visitors.map((v) => v.day);
  if (frame === "custom" && customFrom && customTo) {
    days = days.filter((d) => d >= customFrom && d <= customTo);
  } else if (frame === "this_month") {
    const ym = istTodayYMD().slice(0, 7);
    days = days.filter((d) => d.startsWith(ym));
  } else if (frame === "all" || frame === "90d") {
    // API history is ~60d — 90d = all available
  } else if (frame === "7d" || frame === "14d" || frame === "30d") {
    const n = frame === "7d" ? 7 : frame === "14d" ? 14 : 30;
    days = days.slice(-n);
  }

  return days.map((day) => ({
    day,
    visitors: visitors.find((v) => v.day === day)?.value ?? 0,
    logins: loginByDay.get(day) ?? 0,
    webinarPaid: webinarByDay.get(day) ?? 0,
  }));
}

/** Delta — never Infinity/NaN. Shows "New" when prev===0 and value>0. */
function Delta({ m, invert }: { m: MetricDelta; invert?: boolean }) {
  if (m.value === null || m.prev === null) return null;
  if (m.prev === 0 && m.value === 0) return null;
  const priorLabel = m.scope === "today" ? "vs yesterday" : "vs prior";
  if (m.prev === 0 && m.value > 0) {
    return (
      <span className="text-[11px] font-semibold text-emerald-600">
        New
        <span className="ml-1 font-normal text-muted">{priorLabel}</span>
      </span>
    );
  }
  const abs = m.deltaAbs ?? m.value - m.prev;
  if (!Number.isFinite(abs)) return null;
  const flat = abs === 0;
  const up = abs > 0;
  const good = invert ? !up : up;
  const color = flat ? "text-muted" : good ? "text-emerald-600" : "text-red-600";
  const pct = m.deltaPct !== null && Number.isFinite(m.deltaPct)
    ? m.deltaPct
    : safeDeltaPct(m.value, m.prev);
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${color}`}>
      {flat ? "→" : up ? "↑" : "↓"} {Math.abs(abs).toLocaleString("en-IN")}
      {pct !== null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}
      <span className="ml-1 font-normal text-muted">{priorLabel}</span>
    </span>
  );
}

/** Mount children only when near viewport — progressive section load. */
function LazyMount({ children, rootMargin = "280px", minHeight = 120 }: { children: ReactNode; rootMargin?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    if (typeof IntersectionObserver === "undefined") { setShow(true); return; }
    const io = new IntersectionObserver(
      ([e]) => { if (e?.isIntersecting) { setShow(true); io.disconnect(); } },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show, rootMargin]);
  return <div ref={ref} style={!show ? { minHeight } : undefined}>{show ? children : <div className="skeleton h-28 w-full animate-shimmer rounded-2xl" />}</div>;
}

/** KPI card visual from Overview v2 (68f0df51) — current metric values. */
function PremiumKpi({
  label,
  metric,
  spark,
  sparkColor = "#0057FF",
  money,
  gold,
  scopeHint,
  secondary,
  onClick,
  href,
}: {
  label: string;
  metric: MetricDelta;
  spark?: SparkPoint[];
  sparkColor?: string;
  money?: boolean;
  gold?: boolean;
  scopeHint?: string;
  secondary?: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className={`mt-1 font-heading text-2xl font-extrabold leading-none tabular-nums sm:text-3xl ${gold ? "text-[#9A7B0A]" : "text-ink"}`}>
          {fmtVal(metric, money)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Delta m={metric} />
          {scopeHint && <span className="text-[10px] text-muted">{scopeHint}</span>}
        </div>
        {secondary && <p className="mt-1 text-[11px] tabular-nums text-muted">{secondary}</p>}
      </div>
      {spark && spark.length > 0 && (
        <div className="shrink-0">
          <CssSpark points={spark} color={sparkColor} />
        </div>
      )}
      <span className="shrink-0 text-xs font-semibold text-primary">View →</span>
    </>
  );
  if (href) {
    return <Link href={href} className={CARD} title={label}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={onClick} className={CARD} title={label}>
      {inner}
    </button>
  );
}

function SectionShell({
  title,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="font-heading text-base font-bold tracking-tight">{title}</h2>
        {href && (
          <Link href={href} className="text-xs font-semibold text-primary hover:underline">
            {hrefLabel || "Open →"}
          </Link>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function MetricToggle({
  label,
  checked,
  onChange,
  accent,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent?: string;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        checked ? "border-primary/40 bg-primary/5 text-ink" : "border-line bg-surface2 text-ink2"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--primary)]"
        style={accent ? { accentColor: accent } : undefined}
      />
      {label}
    </label>
  );
}

export default function ExecutiveDashboard() {
  const [excludeAdmin, setExcludeAdmin] = useState(false);
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [body, setBody] = useState<BodyData | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState(false);

  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("14d");
  const [showVisitors, setShowVisitors] = useState(true);
  const [showLogins, setShowLogins] = useState(false);
  const [showWebinar, setShowWebinar] = useState(false);

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerFrame, setExplorerFrame] = useState<ExplorerFrame>("14d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [funnelCourseId, setFunnelCourseId] = useState("");
  const [webinarDetail, setWebinarDetail] = useState<WebinarRow | null>(null);
  const [courseDetail, setCourseDetail] = useState<CourseRow | null>(null);
  const bodyRequested = useRef(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ preset: BODY_PRESET });
    if (excludeAdmin) p.set("excludeAdmin", "1");
    return p.toString();
  }, [excludeAdmin]);

  const loadPulse = useCallback(() => {
    setPulseLoading(true);
    setError(false);
    bodyRequested.current = false;
    setBody(null);
    fetch(`/api/admin/executive-overview?part=pulse&${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPulse(d.overview);
        else { setPulse(null); setError(true); }
      })
      .catch(() => { setPulse(null); setError(true); })
      .finally(() => setPulseLoading(false));
  }, [qs]);

  const loadBody = useCallback(() => {
    if (bodyRequested.current) return;
    bodyRequested.current = true;
    setBodyLoading(true);
    fetch(`/api/admin/executive-overview?part=body&${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setBody(d.overview); })
      .catch(() => { bodyRequested.current = false; })
      .finally(() => setBodyLoading(false));
  }, [qs]);

  useEffect(() => { loadPulse(); }, [loadPulse]);

  const history = pulse?.history;
  const last14 = (s?: SparkPoint[]) => (s || []).slice(-14);
  const monthPrefix = istTodayYMD().slice(0, 7);
  const webinarMtd = useMemo(() => sumSeriesMonth(history?.webinarRevenue, monthPrefix), [history, monthPrefix]);
  const courseMtd = useMemo(() => sumSeriesMonth(history?.courseRevenue, monthPrefix), [history, monthPrefix]);

  const inlineChartPoints = useMemo(() => {
    if (!history) return [];
    const n = trafficWindow === "7d" ? 7 : trafficWindow === "14d" ? 14 : 30;
    return buildExplorerPoints(history, "all", "", "").slice(-n);
  }, [history, trafficWindow]);

  const explorerPoints = useMemo(
    () => buildExplorerPoints(history, explorerFrame, customFrom, customTo),
    [history, explorerFrame, customFrom, customTo],
  );

  const explorerSummary = useMemo(() => {
    if (!explorerPoints.length) return null;
    const total = explorerPoints.reduce((a, p) => a + p.visitors, 0);
    const days = explorerPoints.length;
    const avg = days ? total / days : 0;
    // Prior equal-length window from full history
    if (!history?.visitors?.length) {
      return { total, avg, priorTotal: null as number | null, priorDeltaPct: null as number | null };
    }
    const endIdx = history.visitors.findIndex((v) => v.day === explorerPoints[0]?.day);
    let priorTotal: number | null = null;
    let priorDeltaPct: number | null = null;
    if (endIdx > 0) {
      const prior = history.visitors.slice(Math.max(0, endIdx - days), endIdx);
      if (prior.length === days) {
        priorTotal = prior.reduce((a, p) => a + p.value, 0);
        priorDeltaPct = safeDeltaPct(total, priorTotal);
      }
    }
    return { total, avg, priorTotal, priorDeltaPct };
  }, [explorerPoints, history]);

  const funnelStages = useMemo(() => {
    if (!body) return [];
    if (!funnelCourseId) return body.admissionFunnel.stages;
    return body.admissionFunnel.byCourse.find((c) => c.courseId === funnelCourseId)?.stages || body.admissionFunnel.stages;
  }, [body, funnelCourseId]);

  const openExplorer = (opts?: { logins?: boolean; webinar?: boolean }) => {
    if (opts?.logins) setShowLogins(true);
    if (opts?.webinar) setShowWebinar(true);
    setExplorerFrame(trafficWindow);
    setExplorerOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        subtitle="Executive command · Asia/Kolkata · paid registrations match Payments"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={excludeAdmin}
                onChange={(e) => setExcludeAdmin(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Exclude admin
            </label>
            <button
              type="button"
              onClick={loadPulse}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold hover:border-primary/40"
            >
              Refresh
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {pulse && (
          <p className="mr-auto text-[11px] text-muted">
            Updated {formatISTDateTime(pulse.generatedAt)}
          </p>
        )}
      </div>

      {error && !pulse && (
        <div className="card border-red-200 bg-red-50/50 p-5 text-sm text-red-700">
          Could not load overview. Refresh to retry.
        </div>
      )}

      {pulseLoading && !pulse && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-[104px] animate-shimmer rounded-[20px]" />
          ))}
        </div>
      )}

      {pulse && (
        <div className="space-y-5">
          {/* Executive pulse */}
          <div>
            <div className="mb-3 flex items-end justify-between gap-2">
              <h2 className="font-heading text-xs font-bold uppercase tracking-[0.14em] text-muted">Executive pulse</h2>
              <p className="text-[11px] text-muted">Sparklines · last 14 days · Today · IST</p>
            </div>
            <div className="pay-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PremiumKpi
                label="Website visitors"
                metric={pulse.pulse.visitorsToday}
                spark={last14(history?.visitors)}
                sparkColor="#0057FF"
                scopeHint="Today · IST"
                onClick={() => openExplorer()}
              />
              <PremiumKpi
                label="Logged-in users"
                metric={pulse.pulse.loginUsersToday}
                spark={last14(history?.loginUsers)}
                sparkColor="#0B1F4D"
                scopeHint="Today · IST"
                onClick={() => openExplorer({ logins: true })}
              />
              <PremiumKpi
                label="Login codes"
                metric={pulse.pulse.loginCodesToday}
                sparkColor="#64748B"
                scopeHint="Today · IST"
                href="/admin/students"
              />
              <PremiumKpi
                label="Leads collected"
                metric={pulse.pulse.leadsToday}
                spark={last14(history?.leads)}
                sparkColor="#7C3AED"
                scopeHint="Today · IST"
                href="/admin/leads"
              />
              <PremiumKpi
                label="Paid webinar regs"
                metric={pulse.pulse.webinarRegsToday}
                spark={last14(history?.webinarPaid)}
                sparkColor="#C9A227"
                scopeHint="Today · IST"
                href="/admin/payments"
              />
              <PremiumKpi
                label="Course seat bookings"
                metric={pulse.pulse.seatBookingsToday}
                spark={last14(history?.seatBookings)}
                sparkColor="#0891B2"
                scopeHint="Today · IST"
                href="/admin/course-payments"
              />
              <PremiumKpi
                label="Webinar revenue"
                metric={pulse.pulse.webinarRevenue}
                spark={last14(history?.webinarRevenue)}
                sparkColor="#C9A227"
                money
                gold
                scopeHint="Today · IST"
                secondary={pulse.canRevenue ? `MTD ${formatINR(webinarMtd)}` : undefined}
                href="/admin/payments"
              />
              <PremiumKpi
                label="Course revenue"
                metric={pulse.pulse.courseRevenue}
                spark={last14(history?.courseRevenue)}
                sparkColor="#C9A227"
                money
                gold
                scopeHint="Today · IST"
                secondary={pulse.canRevenue ? `MTD ${formatINR(courseMtd)}` : undefined}
                href="/admin/course-payments"
              />
            </div>
          </div>

          {/* INLINE Traffic & conversion — directly below pulse */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
              <h2 className="font-heading text-base font-bold tracking-tight">Traffic &amp; conversion</h2>
              <button
                type="button"
                onClick={() => openExplorer()}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Expand →
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {TRAFFIC_WINDOWS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setTrafficWindow(w.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      trafficWindow === w.id ? "bg-primary text-white shadow-sm" : "bg-surface2 text-ink2 hover:bg-line/50"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <MetricToggle label="Website Visitors" checked={showVisitors} onChange={setShowVisitors} />
                  <MetricToggle label="Unique Portal Logins" checked={showLogins} onChange={setShowLogins} accent="#0B1F4D" />
                  <MetricToggle label="Paid Webinar Regs" checked={showWebinar} onChange={setShowWebinar} accent={GOLD} />
                </div>
              </div>
              <ExplorerLines
                points={inlineChartPoints}
                showVisitors={showVisitors}
                showLogins={showLogins}
                showWebinar={showWebinar}
                height={200}
              />
              <p className="text-[11px] text-muted">
                Visitors = unique visitor_id · Logins = unique portal users · Webinar regs = paid distinct seats.
              </p>
            </div>
          </section>

          {/* Trigger body load near fold */}
          <LazyMount rootMargin="400px" minHeight={40}>
            <BodyLoader onVisible={loadBody} loading={bodyLoading && !body} />
          </LazyMount>

          {body && (
            <>
              <LazyMount>
                <SectionShell title="Website & portal" href="/admin/analytics" hrefLabel="Analytics →">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <MiniStat label="Visitors" m={body.activity.visitors} />
                    <MiniStat label="Page views" m={body.activity.pageViews} />
                    <MiniStat label="Login events" m={body.activity.logins} />
                    <MiniStat label="Unique logins" m={body.activity.loginUsers} />
                    <MiniStat label="Login codes" m={body.activity.loginCodesGenerated} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Visitor trend</p>
                      <SparkArea points={body.activity.visitorTrend} color="#0057FF" />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Login trend</p>
                      <SparkArea points={body.activity.loginTrend} color="#0B1F4D" />
                    </div>
                  </div>
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                          <th className="pb-2 font-semibold">Page</th>
                          <th className="pb-2 font-semibold">Views</th>
                          <th className="pb-2 font-semibold">Unique</th>
                          <th className="pb-2 font-semibold">Clicks</th>
                          <th className="pb-2 font-semibold">Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {body.activity.topPages.map((row) => {
                          const delta = row.prevViews !== null ? row.views - row.prevViews : null;
                          return (
                            <tr key={row.path} className="border-b border-line/60">
                              <td className="py-2.5">
                                <Link href={row.path} className="font-medium text-primary hover:underline" target="_blank">
                                  {row.path}
                                </Link>
                              </td>
                              <td className="py-2.5 tabular-nums">{nf(row.views)}</td>
                              <td className="py-2.5 tabular-nums">{nf(row.uniqueVisitors)}</td>
                              <td className="py-2.5 tabular-nums">{nf(row.clicks)}</td>
                              <td className={`py-2.5 text-xs font-semibold tabular-nums ${delta === null ? "text-muted" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted"}`}>
                                {delta === null ? "—" : `${delta > 0 ? "+" : ""}${nf(delta)}`}
                              </td>
                            </tr>
                          );
                        })}
                        {body.activity.topPages.length === 0 && (
                          <tr><td colSpan={5} className="py-6 text-center text-muted">No page views in range.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="Leads" href="/admin/leads" hrefLabel="Leads CRM →">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat label="Leads (period)" m={body.leads.totalPeriod} />
                    <MiniStat label="Leads today" m={body.leads.today} />
                    <MiniStat label="Meta today" m={body.leads.metaToday} hint="Subset — not additive" />
                    <MiniStat label="Meta (period)" m={body.leads.metaPeriod} hint="Subset — not additive" />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Daily lead volume</p>
                      <MiniBars points={body.leads.trend} color="#7C3AED" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By source</p>
                      {body.leads.bySource.map((s) => (
                        <div key={s.source} className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-sm">
                          <span className="truncate font-medium">{s.source}</span>
                          <span className="tabular-nums font-semibold">{nf(s.count)}</span>
                        </div>
                      ))}
                      {body.leads.bySource.length === 0 && <p className="text-sm text-muted">No leads in range.</p>}
                    </div>
                  </div>
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="Webinars" href="/admin/webinars" hrefLabel="Webinars →">
                  <p className="mb-3 text-[11px] text-muted">
                    Registrations = distinct paid webinar seats (PAID/captured) — same as Payments.
                  </p>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MiniStat label="Paid regs today" m={body.webinars.regsToday} />
                    <MiniStat label="Confirmed revenue" m={body.webinars.revenue} money gold={pulse.canRevenue} />
                    <div className="rounded-2xl border border-line bg-surface p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Payment attempts</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-muted">Successful</span><p className="font-bold tabular-nums text-emerald-700">{nf(body.webinars.paymentFunnel.paid)}</p></div>
                        <div><span className="text-muted">Abandoned</span><p className="font-bold tabular-nums">{nf(body.webinars.paymentFunnel.abandoned)}</p></div>
                        <div><span className="text-muted">Failed</span><p className="font-bold tabular-nums text-red-600">{nf(body.webinars.paymentFunnel.failed)}</p></div>
                        <div><span className="text-muted">Pending</span><p className="font-bold tabular-nums">{nf(body.webinars.paymentFunnel.pending)}</p></div>
                      </div>
                    </div>
                  </div>
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Paid registration trend</p>
                    <SparkArea points={body.webinars.trend} color="#C9A227" />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <EntityList
                      title="Top by paid regs"
                      rows={body.webinars.top.map((w) => ({
                        key: w.slug,
                        title: w.title,
                        sub: formatISTDateTime(w.datetime),
                        a: `${nf(w.paid)} paid`,
                        b: pulse.canRevenue ? formatINR(w.revenue) : undefined,
                        onClick: () => setWebinarDetail(w),
                      }))}
                    />
                    <EntityList
                      title="Latest webinars"
                      rows={body.webinars.recent.map((w) => ({
                        key: w.slug,
                        title: w.title,
                        sub: formatISTDateTime(w.datetime),
                        a: `${nf(w.paid)} paid`,
                        b: pulse.canRevenue ? formatINR(w.revenue) : undefined,
                        onClick: () => setWebinarDetail(w),
                      }))}
                    />
                  </div>
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="Courses" href="/admin/course-payments" hrefLabel="Course payments →">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MiniStat label="Seat bookings today" m={body.courses.seatBookingsToday} />
                    <MiniStat label="Seat bookings (all time)" m={body.courses.seatBookingsAllTime} />
                    <MiniStat label="Course revenue" m={body.courses.revenue} money gold={pulse.canRevenue} />
                  </div>
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Course revenue trend</p>
                    <SparkArea points={body.courses.trend} color="#C9A227" money />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <EntityList
                      title="Top by seat bookings"
                      rows={body.courses.top.map((c) => ({
                        key: c.courseId,
                        title: c.title,
                        sub: c.progressLabel,
                        a: `${nf(c.seatBookings)} seats`,
                        b: pulse.canRevenue ? formatINR(c.revenue) : undefined,
                        onClick: () => setCourseDetail(c),
                      }))}
                    />
                    <EntityList
                      title="Latest batches"
                      rows={body.courses.recent.map((c) => ({
                        key: c.courseId,
                        title: c.title,
                        sub: c.batchStart ? formatISTDateTime(c.batchStart) : "No batch start",
                        a: `${nf(c.seatBookings)} seats`,
                        b: pulse.canRevenue ? formatINR(c.revenue) : undefined,
                        onClick: () => setCourseDetail(c),
                      }))}
                    />
                  </div>
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="Admission funnel" href="/admin/course-payments" hrefLabel="Course payments →">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <select value={funnelCourseId} onChange={(e) => setFunnelCourseId(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
                      <option value="">All courses</option>
                      {body.admissionFunnel.byCourse.map((c) => (
                        <option key={c.courseId} value={c.courseId}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  <FunnelBars stages={funnelStages} />
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="Collections" href="/admin/access-risk" hrefLabel="Access at risk →">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat label="Overdue enrollments" m={body.collections.overdueCount} />
                    <MiniStat label="Overdue amount" m={body.collections.overdueAmount} money />
                    <MiniStat label="Access blocked" m={body.collections.blockedCount} />
                    <MiniStat label="In grace" m={body.collections.graceCount} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ul className="space-y-1.5">
                      {body.collections.aging.map((a) => (
                        <li key={a.bucket} className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-sm">
                          <span>{a.bucket}</span>
                          <span className="tabular-nums">
                            <strong>{nf(a.count)}</strong>
                            {pulse.canRevenue ? <span className="ml-2 text-muted">{formatINR(a.amount)}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="rounded-2xl border border-line p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Upcoming installments</p>
                      <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums">{nf(body.collections.upcomingDue.count)}</p>
                      <p className="text-sm text-ink2">
                        {pulse.canRevenue ? formatINR(body.collections.upcomingDue.amount) : "Amount hidden"} next due
                      </p>
                    </div>
                  </div>
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="Content & learning" href="/admin/quizzes" hrefLabel="Quizzes →">
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <MiniStat label="Quiz attempts today" m={body.engagement.quizAttemptsToday} />
                    <MiniStat label="Unique students today" m={body.engagement.quizUniqueToday} />
                    <MiniStat label="Resource download events" m={body.engagement.resourceDownloadEvents} />
                  </div>
                  <MiniBars points={body.engagement.quizTrend} color="#0891B2" />
                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    <RankList
                      title="Top quizzes"
                      rows={body.engagement.topQuizzes.map((q) => ({
                        key: q.id,
                        label: q.title,
                        value: `${nf(q.attempts)} · ${nf(q.uniqueStudents)} unique`,
                        href: `/admin/quizzes/${q.id}/edit`,
                      }))}
                    />
                    <RankList title="Top current affairs" rows={body.engagement.caTop.map((a) => ({ key: a.slug, label: a.title, value: nf(a.views), href: "/admin/current-affairs" }))} />
                    <RankList title="Top downloads" rows={body.engagement.resourceDownloads.map((r) => ({ key: r.id, label: r.title, value: nf(r.downloads), href: "/admin/current-affairs/pdfs" }))} />
                  </div>
                </SectionShell>
              </LazyMount>

              <LazyMount>
                <SectionShell title="SMS" href="/admin/communications/sms" hrefLabel="Mission Control →">
                  <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <MiniNum label="Sent" value={nf(body.sms.sent)} />
                    <MiniNum label="Delivered" value={body.sms.delivered === null ? "—" : nf(body.sms.delivered)} tone="green" />
                    <MiniNum label="Failed" value={nf(body.sms.failed)} tone="red" />
                    <MiniNum label="Pending" value={nf(body.sms.pending)} />
                    <MiniNum label="Delivery rate" value={body.sms.deliveryRate === null ? "—" : `${body.sms.deliveryRate}%`} />
                  </div>
                  <p className="mb-2 text-[11px] text-muted">delivered + failed + pending = sent</p>
                  <SparkArea points={body.sms.trend} color="#0891B2" />
                </SectionShell>
              </LazyMount>
            </>
          )}

          {pulse.unavailable.length > 0 && (
            <details className="card overflow-hidden">
              <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-muted hover:text-ink">
                Unavailable metrics ({pulse.unavailable.length})
              </summary>
              <ul className="space-y-1 border-t border-line px-5 py-3 text-sm text-ink2">
                {pulse.unavailable.map((note) => (
                  <li key={note} className="list-inside list-disc">{note}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Full explorer modal */}
      <Modal open={explorerOpen} onClose={() => setExplorerOpen(false)} title="Traffic & conversion explorer" maxWidth="max-w-3xl">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {EXPLORER_FRAMES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setExplorerFrame(f.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  explorerFrame === f.id ? "bg-primary text-white" : "bg-surface2 text-ink2 hover:bg-surface"
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setExplorerFrame("custom")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                explorerFrame === "custom" ? "bg-primary text-white" : "bg-surface2 text-ink2 hover:bg-surface"
              }`}
            >
              Custom
            </button>
          </div>

          {explorerFrame === "custom" && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface2/50 p-3">
              <label className="text-xs font-semibold text-muted">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-1 block rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="text-xs font-semibold text-muted">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 block rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <MetricToggle label="Website Visitors" checked={showVisitors} onChange={setShowVisitors} />
            <MetricToggle label="Unique Portal Logins" checked={showLogins} onChange={setShowLogins} accent="#0B1F4D" />
            <MetricToggle label="Paid Webinar Regs" checked={showWebinar} onChange={setShowWebinar} accent={GOLD} />
          </div>

          <ExplorerLines
            points={explorerPoints}
            showVisitors={showVisitors}
            showLogins={showLogins}
            showWebinar={showWebinar}
            height={280}
          />

          {explorerSummary && (
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniNum label="Total visitors" value={nf(explorerSummary.total)} />
              <MiniNum label="Daily average" value={nf(Math.round(explorerSummary.avg))} />
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Vs prior window</p>
                {explorerSummary.priorTotal === null ? (
                  <p className="mt-2 text-sm text-muted">—</p>
                ) : (
                  <>
                    <p className="mt-2 font-heading text-xl font-extrabold tabular-nums">{nf(explorerSummary.priorTotal)}</p>
                    {explorerSummary.priorDeltaPct !== null && (
                      <p className={`text-xs font-semibold ${explorerSummary.priorDeltaPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {explorerSummary.priorDeltaPct > 0 ? "+" : ""}{explorerSummary.priorDeltaPct}% vs prior {explorerPoints.length}d
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-muted">
            History window is ~60 days. “90 days” shows all available points. Visitors = unique visitor_id · Logins = unique portal users · Webinar regs = paid distinct seats.
          </p>
          <Link href="/admin/analytics" className="inline-block text-sm font-semibold text-primary hover:underline">
            Open full analytics →
          </Link>
        </div>
      </Modal>

      <Modal open={!!webinarDetail} onClose={() => setWebinarDetail(null)} title={webinarDetail?.title} maxWidth="max-w-xl">
        {webinarDetail && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{formatISTDateTime(webinarDetail.datetime)}</p>
            <div className="grid grid-cols-2 gap-2">
              <MiniNum label="Paid regs" value={nf(webinarDetail.paid)} />
              <MiniNum label="Revenue" value={pulse?.canRevenue ? formatINR(webinarDetail.revenue) : "—"} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/admin/webinars/${webinarDetail.id}/edit`} className="font-semibold text-primary hover:underline">Webinar admin →</Link>
              <Link href={`/admin/webinars/${webinarDetail.id}/registrations`} className="font-semibold text-primary hover:underline">Registrations →</Link>
              <Link href={`/admin/payments?q=${encodeURIComponent(webinarDetail.slug)}`} className="font-semibold text-primary hover:underline">Payments →</Link>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!courseDetail} onClose={() => setCourseDetail(null)} title={courseDetail?.title} maxWidth="max-w-xl">
        {courseDetail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <MiniNum label="Seat bookings" value={nf(courseDetail.seatBookings)} />
              <MiniNum label="Paying" value={nf(courseDetail.confirmedAdmissions)} />
              <MiniNum label="Revenue" value={pulse?.canRevenue ? formatINR(courseDetail.revenue) : "—"} />
              <MiniNum label="Progress" value={courseDetail.progressLabel} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/admin/courses/${courseDetail.courseId}/edit`} className="font-semibold text-primary hover:underline">Edit course →</Link>
              <Link href={`/admin/course-payments/${courseDetail.courseId}`} className="font-semibold text-primary hover:underline">Course payments →</Link>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function BodyLoader({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  useEffect(() => { onVisible(); }, [onVisible]);
  if (!loading) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface2/60 px-4 py-3 text-sm text-muted">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      Loading deeper analytics…
    </div>
  );
}

function MiniStat({ label, m, money, gold, hint }: { label: string; m: MetricDelta; money?: boolean; gold?: boolean; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 font-heading text-2xl font-extrabold tabular-nums ${gold ? "text-[#9A7B0A]" : ""}`}>{fmtVal(m, money)}</p>
      <div className="mt-1"><Delta m={m} /></div>
      {hint && <p className="mt-1 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

function MiniNum({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 font-heading text-xl font-extrabold tabular-nums ${tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-600" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function EntityList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; title: string; sub: string; a: string; b?: string; onClick: () => void }[];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {rows.length === 0 && <li className="px-3 py-4 text-sm text-muted">None yet.</li>}
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" onClick={r.onClick} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{r.title}</p>
                <p className="text-[11px] text-muted">{r.sub}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="font-bold tabular-nums">{r.a}</p>
                {r.b && <p className="text-[#9A7B0A]">{r.b}</p>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RankList({ title, rows }: { title: string; rows: { key: string; label: string; value: string; href: string }[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="space-y-1">
        {rows.length === 0 && <li className="text-sm text-muted">None yet.</li>}
        {rows.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface2">
              <span className="truncate font-medium">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted">{r.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
