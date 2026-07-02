"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Target, CheckCircle2, XCircle, MinusCircle, TrendingUp, TrendingDown, Minus,
  Award, AlertTriangle, Sparkles, BarChart3, Trophy, Flame, CalendarDays,
  ArrowUpDown, GraduationCap, Compass, Download, ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import Skeleton from "@/components/ui/Skeleton";
import QuizPerformanceReport from "@/components/dashboard/QuizPerformanceReport";
import { downloadOverallPerformancePdf } from "@/lib/performancePdf";
import type {
  OverallPerformance as OverallData, MasteryRow, QuizRankRow, TrendDirection, MissedQuestion,
} from "@/lib/overallPerformance";

type ReportTarget = { attemptId: string; slug: string | null; title: string };

/**
 * Containment utilities for user-authored HTML injected via dangerouslySetInnerHTML
 * (question stems, options, explanations). Unlike the per-attempt report — which
 * lives inside a position:fixed Modal that can't widen the document — the
 * most-missed accordion renders this HTML INLINE in page flow, so unconstrained
 * content (long unbroken tokens, <table>, <pre>, inline widths, big images) would
 * force horizontal page overflow on mobile. This forces wrapping and keeps tables/
 * pre/images scrolling or shrinking WITHIN their own box, never past the viewport.
 */
const RICH_HTML =
  "min-w-0 max-w-full break-words [overflow-wrap:anywhere] " +
  "[&_img]:h-auto [&_img]:max-w-full " +
  "[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap " +
  "[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto";

/**
 * Class Hub "Overall Performance" tab (read-only). Aggregate self-assessment
 * across ALL of a learner's quizzes — a UPSC aspirant's study-decision board.
 * Data is server-aggregated (GET /api/public/quiz/overall) and fetched lazily
 * on open. Reuses Feature-1 patterns (score ring, stat cards, per-attempt report
 * modal, skeleton/empty/error, entrance fade) and existing design tokens. The
 * whole board is screenshot-friendly: student + batch + date are always visible
 * and no key number hides behind hover. Zero changes to quiz taking/scoring.
 */
/**
 * Dual-context: student-front passes `courseId` (fetches /api/public/quiz/overall);
 * the admin per-student view passes an explicit `endpoint` (the role-gated admin
 * API). Both endpoints return the SAME { ok, overall } shape from the SAME
 * buildOverallPerformance aggregation, so numbers are identical in both contexts.
 * `enablePdfExport` shows a Download-PDF action (used in the faculty view).
 */
export default function OverallPerformance({
  courseId,
  endpoint,
  enablePdfExport = false,
}: {
  courseId?: string;
  endpoint?: string;
  enablePdfExport?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverallData | null>(null);
  // Per-attempt report modal state lives here (top level) so the modal renders
  // OUTSIDE #overall-performance-board — see the render note at the bottom.
  const [report, setReport] = useState<ReportTarget | null>(null);

  const url = endpoint ?? `/api/public/quiz/overall?courseId=${encodeURIComponent(courseId ?? "")}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setData(d.overall as OverallData);
        else setError(d.error || "Could not load your performance.");
      })
      .catch(() => !cancelled && setError("Could not load your performance."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <OverallSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface2 px-6 py-12 text-center">
        <AlertTriangle size={26} className="mb-3 text-amber-500" aria-hidden="true" />
        <p className="font-heading text-lg text-ink">{error}</p>
        <p className="mt-1 max-w-xs text-sm text-ink2">Please refresh the page and try again.</p>
      </div>
    );
  }

  if (!data || !data.hasData) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface2/40 p-12 text-center">
        <p className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-[var(--ca-gold)]">
          <BarChart3 size={20} aria-hidden="true" />
        </p>
        <p className="font-heading text-lg font-bold">Take your first quiz to unlock your overall performance</p>
        <p className="mt-1 text-sm text-ink2">Once you attempt a test, your subject mastery, accuracy trend and focus areas will appear here.</p>
      </div>
    );
  }

  return (
    <>
      <div id="overall-performance-board" className="animate-fade-up space-y-8 motion-reduce:animate-none">
        <SnapshotHeader data={data} enablePdfExport={enablePdfExport} />
        <HeroSummary data={data} />
        <MasterySection subjects={data.subjects} topics={data.topics} />
        <QuizRanking quizzes={data.quizzes} onOpenReport={setReport} />
        <AccuracyTrend data={data} />
        <FocusAreas data={data} />
      </div>

      {/*
        Root-cause fix (Bug 1): #overall-performance-board uses `animate-fade-up`,
        whose keyframe runs with `animation-fill-mode: both` and leaves the board
        with a retained `transform: translateY(0)`. Any non-`none` transform on an
        ancestor turns it into the containing block for `position: fixed`
        descendants — so the shared Modal's `fixed inset-0` overlay was being
        clipped/offset into the board's box and read as a "blank black box".
        Rendering the report as a SIBLING of the board (not a descendant) keeps the
        modal viewport-anchored, exactly like the working Quizzes-tab report.
      */}
      {report && (
        <QuizPerformanceReport
          attemptId={report.attemptId}
          slug={report.slug}
          fallbackTitle={report.title}
          open={!!report}
          onClose={() => setReport(null)}
        />
      )}
    </>
  );
}

/* ----------------------------- SNAPSHOT HEADER ----------------------------- */
function SnapshotHeader({ data, enablePdfExport }: { data: OverallData; enablePdfExport?: boolean }) {
  const date = new Date(data.snapshotISO).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="rounded-2xl border border-[rgba(212,175,55,0.3)] bg-gradient-to-br from-[rgba(212,175,55,0.1)] to-transparent p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ca-gold)]">
            <GraduationCap size={14} aria-hidden="true" /> Overall Performance
          </p>
          <h3 className="mt-1 truncate font-heading text-2xl font-extrabold text-ink">{data.studentName}</h3>
          {data.batchLabel && <p className="mt-0.5 truncate text-sm text-ink2">{data.batchLabel}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enablePdfExport && (
            <button
              type="button"
              onClick={() => downloadOverallPerformancePdf(data)}
              className="ca-focus inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink2 hover:text-ink"
            >
              <Download size={13} aria-hidden="true" /> Download PDF
            </button>
          )}
          <p className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink2">
            <CalendarDays size={13} aria-hidden="true" /> {date}
          </p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- HERO ---------------------------------- */
function HeroSummary({ data }: { data: OverallData }) {
  const { hero } = data;
  return (
    <section className="grid gap-3 lg:grid-cols-[auto,1fr]">
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5">
        <ScoreRing accuracy={hero.accuracy} />
        <div className="min-w-0">
          <p className="text-xs text-muted">Overall accuracy</p>
          <p className="font-heading text-3xl font-extrabold text-ink">{hero.accuracy}%</p>
          <p className="mt-0.5 text-xs text-muted">{hero.correct} correct of {hero.correct + hero.incorrect} attempted</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        <Stat icon={<Award size={15} />} label="Quizzes" value={hero.totalQuizzes} tone="text-ink" hint={`${hero.totalAttempts} attempt${hero.totalAttempts !== 1 ? "s" : ""}`} />
        <Stat icon={<Target size={15} />} label="Questions" value={hero.totalQuestions} tone="text-ink" hint="faced overall" />
        <Stat icon={<TrendingUp size={15} />} label="Attempt rate" value={`${hero.attemptRate}%`} tone={hero.attemptRate >= 80 ? "text-success" : hero.attemptRate >= 60 ? "text-amber-600" : "text-danger"} hint={`${hero.unattemptedRate}% left blank`} />
        <Stat icon={<CheckCircle2 size={15} />} label="Correct" value={hero.correct} tone="text-success" />
        <Stat icon={<XCircle size={15} />} label="Incorrect" value={hero.incorrect} tone="text-danger" />
        <Stat icon={<MinusCircle size={15} />} label="Skipped" value={hero.skipped} tone="text-ink2" />
      </div>
    </section>
  );
}

function Stat({ icon, label, value, tone, hint }: { icon: React.ReactNode; label: string; value: string | number; tone: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] text-muted">{icon} {label}</p>
      <p className={`mt-0.5 font-heading text-2xl font-extrabold ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function ScoreRing({ accuracy }: { accuracy: number }) {
  const pct = Math.max(0, Math.min(100, accuracy));
  const r = 32, c = 2 * Math.PI * r;
  const stroke = pct >= 75 ? "var(--success)" : pct >= 40 ? "#f59e0b" : "var(--danger)";
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`Overall accuracy ${pct}%`} className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle
        cx="44" cy="44" r={r} fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} transform="rotate(-90 44 44)"
        className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
      />
      <text x="44" y="49" textAnchor="middle" className="fill-ink font-heading" style={{ fontSize: 19, fontWeight: 800 }}>{pct}%</text>
    </svg>
  );
}

/* --------------------------- SUBJECT / TOPIC MASTERY --------------------------- */
type SortDir = "weak" | "strong";

function MasterySection({ subjects, topics }: { subjects: MasteryRow[]; topics: MasteryRow[] }) {
  const [dir, setDir] = useState<SortDir>("weak");
  const [view, setView] = useState<"subject" | "topic">("subject");

  const rows = view === "subject" ? subjects : topics;
  const sorted = useMemo(() => (dir === "weak" ? rows : [...rows].reverse()), [rows, dir]);

  if (subjects.length === 0 && topics.length === 0) return null;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-heading text-base font-bold">
          <BarChart3 size={17} className="text-[var(--ca-gold)]" /> Subject &amp; topic mastery
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-line bg-surface p-0.5 text-xs font-semibold">
            {(["subject", "topic"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                disabled={v === "subject" ? subjects.length === 0 : topics.length === 0}
                className={`ca-focus rounded-full px-3 py-1 capitalize transition disabled:opacity-40 ${view === v ? "bg-[var(--ca-gold)] text-[#1a1304]" : "text-ink2 hover:text-ink"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDir((d) => (d === "weak" ? "strong" : "weak"))}
            className="ca-focus inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink2 hover:text-ink"
            title="Toggle sort order"
          >
            <ArrowUpDown size={13} /> {dir === "weak" ? "Weakest first" : "Strongest first"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {sorted.map((r) => <MasteryBar key={`${view}-${r.label}`} row={r} />)}
      </div>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <LegendDot cls="bg-success" label="Strong ≥ 75%" />
        <LegendDot cls="bg-amber-500" label="Moderate 40–74%" />
        <LegendDot cls="bg-danger" label="Weak < 40%" />
      </p>
    </section>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${cls}`} /> {label}</span>;
}

function bandText(band: MasteryRow["band"]) {
  return band === "strong" ? "text-success" : band === "moderate" ? "text-amber-600" : "text-danger";
}
function bandBar(band: MasteryRow["band"]) {
  return band === "strong" ? "bg-success" : band === "moderate" ? "bg-amber-500" : "bg-danger";
}

function MasteryBar({ row }: { row: MasteryRow }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-ink" title={row.label}>{row.label}</p>
        <span className={`shrink-0 text-sm font-bold ${bandText(row.band)}`}>{row.accuracy}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface2">
        <div className={`h-full rounded-full ${bandBar(row.band)} transition-all duration-500 motion-reduce:transition-none`} style={{ width: `${Math.min(100, row.accuracy)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">
        {row.correct}/{row.attempted} correct · across {row.quizzes} quiz{row.quizzes !== 1 ? "zes" : ""}
        {row.subject && row.subject !== row.label ? ` · ${row.subject}` : ""}
      </p>
    </div>
  );
}

/* ----------------------------- QUIZ RANKING ----------------------------- */
function QuizRanking({ quizzes, onOpenReport }: { quizzes: QuizRankRow[]; onOpenReport: (r: ReportTarget) => void }) {
  if (quizzes.length === 0) return null;

  const small = quizzes.length <= 3;
  const best = quizzes.slice(0, 3);
  const weakest = small ? [] : quizzes.slice(-3).reverse();

  const open = (q: QuizRankRow) => {
    if (q.reviewable) onOpenReport({ attemptId: q.attemptId, slug: q.slug, title: q.title });
  };

  return (
    <section>
      <h3 className="flex items-center gap-2 font-heading text-base font-bold">
        <Trophy size={17} className="text-[var(--ca-gold)]" /> Best &amp; weakest quizzes
      </h3>
      <div className={`mt-3 grid gap-4 ${small ? "" : "lg:grid-cols-2"}`}>
        <RankList title="Top performers" icon={<Trophy size={14} className="text-success" />} rows={best} onOpen={open} />
        {!small && <RankList title="Needs work" icon={<Flame size={14} className="text-danger" />} rows={weakest} onOpen={open} />}
      </div>
    </section>
  );
}

function RankList({ title, icon, rows, onOpen }: { title: string; icon: React.ReactNode; rows: QuizRankRow[]; onOpen: (q: QuizRankRow) => void }) {
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">{icon} {title}</p>
      <ul className="space-y-2">
        {rows.map((q) => {
          const tone = q.accuracy >= 75 ? "text-success" : q.accuracy >= 40 ? "text-amber-600" : "text-danger";
          const clickable = q.reviewable;
          return (
            <li key={q.attemptId}>
              <button
                type="button"
                onClick={() => onOpen(q)}
                disabled={!clickable}
                className={`ca-focus flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left transition ${clickable ? "hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.5)] hover:shadow-soft motion-reduce:transform-none" : "cursor-not-allowed opacity-60"}`}
                title={clickable ? "Open per-attempt report" : "No question-wise report available for this attempt"}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{q.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {q.subject ? `${q.subject} · ` : ""}{date(q.dateISO)} · {q.score}/{q.maxScore}
                  </p>
                </div>
                <span className={`shrink-0 font-heading text-lg font-extrabold ${tone}`}>{q.accuracy}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ----------------------------- ACCURACY TREND ----------------------------- */
const TREND_META: Record<TrendDirection, { label: string; icon: React.ReactNode; cls: string }> = {
  improving: { label: "Improving", icon: <TrendingUp size={14} />, cls: "text-success bg-success/10" },
  declining: { label: "Declining", icon: <TrendingDown size={14} />, cls: "text-danger bg-danger/10" },
  steady: { label: "Steady", icon: <Minus size={14} />, cls: "text-amber-600 bg-amber-500/10" },
  insufficient: { label: "Not enough data", icon: <Minus size={14} />, cls: "text-ink2 bg-surface2" },
};

function AccuracyTrend({ data }: { data: OverallData }) {
  const meta = TREND_META[data.trendDirection];
  const enough = data.trend.length >= 2;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-heading text-base font-bold">
          <TrendingUp size={17} className="text-[var(--ca-gold)]" /> Accuracy trend
        </h3>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${meta.cls}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      {!enough ? (
        <div className="mt-3 rounded-2xl border border-dashed border-line bg-surface2/40 p-8 text-center text-sm text-ink2">
          Not enough data for a trend yet — attempt one more quiz to see how your accuracy is moving.
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="accGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ca-gold)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--ca-gold)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={34} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
                  formatter={(v) => [`${v}%`, "Accuracy"]}
                  labelFormatter={(_, p) => (p && p[0] ? String((p[0].payload as { title?: string }).title ?? "") : "")}
                />
                <Area type="monotone" dataKey="accuracy" stroke="var(--ca-gold)" strokeWidth={2.5} fill="url(#accGradient)" isAnimationActive={false} dot={{ r: 2.5, fill: "var(--ca-gold)" }} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-center text-xs text-muted">Accuracy per attempt, oldest → newest</p>
        </div>
      )}
    </section>
  );
}

/* ----------------------------- FOCUS AREAS ----------------------------- */
function FocusAreas({ data }: { data: OverallData }) {
  const { focusTopics, mostMissed } = data;
  if (focusTopics.length === 0 && mostMissed.length === 0) return null;

  const priority = focusTopics.map((t) => t.label).slice(0, 3).join(", ");

  return (
    <section>
      <h3 className="flex items-center gap-2 font-heading text-base font-bold">
        <Compass size={17} className="text-[var(--ca-gold)]" /> What to work on
      </h3>

      {priority && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] px-4 py-3 text-sm font-semibold text-ink">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-[var(--ca-gold)]" aria-hidden="true" />
          <span>Prioritize: {priority}. Focus your revision here to lift your overall accuracy.</span>
        </p>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {focusTopics.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Weakest topics</p>
            <ul className="space-y-2">
              {focusTopics.map((t) => (
                <li key={t.label} className="rounded-2xl border border-line border-l-[3px] border-l-danger bg-surface p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-semibold text-ink" title={t.label}>{t.label}</p>
                    <span className={`shrink-0 text-sm font-bold ${bandText(t.band)}`}>{t.accuracy}%</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t.incorrect} wrong of {t.attempted} attempted · {t.quizzes} quiz{t.quizzes !== 1 ? "zes" : ""}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mostMissed.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Most-missed questions</p>
            <MostMissedAccordion items={mostMissed} />
          </div>
        )}
      </div>
    </section>
  );
}

/* --------------------- MOST-MISSED QUESTIONS (ACCORDION) --------------------- */
/**
 * Single-open accordion for the learner's most-missed questions. Collapsed rows
 * show a truncated stem + chips; expanding one smoothly collapses any other so
 * only one question is open at a time. The expanded panel is a mini per-attempt
 * card (full stem, option chips with your ✕ / correct ✓, explanation callout)
 * mirroring the Feature-1 report. Height/opacity animate with an eased grid-rows
 * transition; `motion-reduce` renders instantly. Rows are keyboard-operable.
 */
function MostMissedAccordion({ items }: { items: MissedQuestion[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <MissedRow
          key={m.questionId}
          m={m}
          open={openId === m.questionId}
          onToggle={() => setOpenId((cur) => (cur === m.questionId ? null : m.questionId))}
        />
      ))}
    </ul>
  );
}

function MissedRow({ m, open, onToggle }: { m: MissedQuestion; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const panelId = `most-missed-${m.questionId}`;

  useEffect(() => {
    if (!open || !ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Let the expand transition begin, then nudge the row into view if it sits
    // below the fold. `block: "nearest"` keeps the tapped row anchored (no jump).
    const t = window.setTimeout(
      () => ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }),
      reduce ? 0 : 90,
    );
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <li
      ref={ref}
      className={`overflow-hidden rounded-2xl border bg-surface transition-colors duration-200 ${
        open ? "border-l-[3px] border-danger/50 border-l-danger shadow-soft" : "border-line hover:border-[rgba(212,175,55,0.4)]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="ca-focus flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-surface2/40"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{m.text}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="pill pill-red shrink-0"><XCircle size={11} aria-hidden="true" /> Incorrect</span>
            {m.topic && <span className="pill pill-blue max-w-full break-words">{m.topic}</span>}
            {m.subject && m.subject !== m.topic && <span className="pill pill-gray max-w-full break-words">{m.subject}</span>}
            {m.wrong > 1 && <span className="pill pill-amber shrink-0">Missed {m.wrong}× of {m.seen}</span>}
          </div>
        </div>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div
        id={panelId}
        role="region"
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`border-t border-line px-3.5 pb-4 pt-3 transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
          >
            {open && <MissedPanel m={m} />}
          </div>
        </div>
      </div>
    </li>
  );
}

function MissedPanel({ m }: { m: MissedQuestion }) {
  const answersHidden = m.correctOption == null && m.explanationHtml == null && m.options.length > 0;
  return (
    <div className="animate-fade-up max-w-full space-y-3 motion-reduce:animate-none">
      {m.questionHtml ? (
        <div className={`prose-quiz text-sm leading-relaxed text-ink ${RICH_HTML}`} dangerouslySetInnerHTML={{ __html: m.questionHtml }} />
      ) : (
        <p className="max-w-full break-words text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{m.text}</p>
      )}
      {m.questionImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.questionImage} alt="" className="h-auto max-h-64 max-w-full rounded-lg border border-line" />
      )}

      {m.options.length > 0 && (
        <ul className="space-y-1.5">
          {m.options.map((opt) => {
            const isCorrect = m.correctOption === opt.key;
            const isYours = m.yourOption === opt.key;
            const wrongPick = isYours && !isCorrect;
            const cls = isCorrect
              ? "border-success/50 bg-success/10"
              : wrongPick
              ? "border-danger/50 bg-danger/10"
              : "border-line bg-surface2/40";
            return (
              <li key={opt.key} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${cls}`}>
                {isCorrect ? (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                ) : wrongPick ? (
                  <XCircle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                ) : (
                  <span className="mt-0.5 shrink-0 text-xs font-bold text-muted">{opt.key}.</span>
                )}
                <span className={`flex-1 text-ink ${RICH_HTML}`} dangerouslySetInnerHTML={{ __html: opt.html }} />
                {(isYours || isCorrect) && (
                  <span
                    className={`ml-auto shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wide ${
                      isCorrect ? "text-success" : "text-danger"
                    }`}
                  >
                    {isCorrect ? "Correct" : "Your answer"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {m.explanationHtml && (
        <div className="max-w-full overflow-hidden rounded-xl border border-[rgba(0,87,255,0.18)] bg-[rgba(0,87,255,0.05)] p-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            <Sparkles size={12} aria-hidden="true" /> Explanation
          </p>
          <div className={`prose-quiz text-sm leading-relaxed text-ink2 ${RICH_HTML}`} dangerouslySetInnerHTML={{ __html: m.explanationHtml }} />
        </div>
      )}

      {answersHidden && (
        <p className="text-xs italic text-muted">The answer key for this quiz isn’t revealed yet — your selected option is marked above.</p>
      )}
      {m.options.length === 0 && (
        <p className="text-xs italic text-muted">Detailed review isn’t available for this question.</p>
      )}
    </div>
  );
}

/* ------------------------------- SKELETON ------------------------------- */
function OverallSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <Skeleton className="w-full rounded-2xl" height={92} />
      <div className="grid gap-3 lg:grid-cols-[auto,1fr]">
        <Skeleton className="w-full rounded-2xl sm:w-64" height={120} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="w-full rounded-2xl" height={84} />)}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="w-full rounded-2xl" height={96} />)}
      </div>
      <Skeleton className="w-full rounded-2xl" height={224} />
    </div>
  );
}
