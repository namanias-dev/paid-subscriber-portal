"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Target, CheckCircle2, Clock, TrendingUp, Award, AlertTriangle, Sparkles,
  FileText, Download, Search, BarChart3, ListChecks,
} from "lucide-react";
import { formatISTDate } from "@/lib/dates";
import type { PerformanceData, PerfHistoryRow } from "@/lib/performance";
import QuizAttemptActions from "@/components/public/quiz/QuizAttemptActions";

/**
 * Student "My Performance" command center inside Class Hub. Renders server-
 * aggregated data only (lib/performance) — no heavy client compute. Reuses the
 * shared QuizAttemptActions (✓ score + View report + Download PDF) for available
 * quizzes and reviewable history rows, so reports/PDFs match the free-quiz flow.
 */
export default function PerformanceDashboard({ data }: { data: PerformanceData }) {
  const { quizzes, subjects, history, insight } = data;
  const hasActivity = history.length > 0 || quizzes.length > 0;

  if (!hasActivity) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface2/40 p-12 text-center">
        <p className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-[var(--ca-gold)]">
          <BarChart3 size={20} aria-hidden="true" />
        </p>
        <p className="font-heading text-lg font-bold">Attempt your first test to unlock your performance insights</p>
        <p className="mt-1 text-sm text-ink2">Your scores, subject trends and downloadable reports will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <HeroSummary data={data} insight={insight} />
      {subjects.length > 0 && <SubjectPerformance subjects={subjects} />}
      {quizzes.length > 0 && <AvailableQuizzes quizzes={quizzes} />}
      <AttemptHistory history={history} />
    </div>
  );
}

/* ----------------------------- HERO ----------------------------- */
function HeroSummary({ data, insight }: { data: PerformanceData; insight: string | null }) {
  const { hero } = data;
  return (
    <section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Target size={16} />} label="Tests available" value={hero.available} />
        <Kpi icon={<CheckCircle2 size={16} />} label="Attempted" value={hero.attempted} tone="text-success" />
        <Kpi icon={<Clock size={16} />} label="Pending" value={hero.pending} tone="text-amber-600" />
        <Kpi icon={<TrendingUp size={16} />} label="Avg accuracy" value={`${hero.avgAccuracy}%`} tone="text-primary" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted"><Award size={13} className="text-[var(--ca-gold)]" /> Best subject</p>
          <p className="mt-1 font-heading text-lg font-bold">{hero.bestSubject || "—"}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted"><AlertTriangle size={13} className="text-amber-600" /> Focus subject</p>
          <p className="mt-1 font-heading text-lg font-bold">{hero.focusSubject || "—"}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center justify-between text-xs text-muted">
            <span>Recent accuracy</span><span>{hero.totalQuestions} Qs · {hero.totalAttempts} tests</span>
          </p>
          <div className="mt-2"><Sparkline values={hero.sparkline} /></div>
        </div>
      </div>

      {insight && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] px-4 py-2.5 text-sm font-semibold text-ink">
          <Sparkles size={15} className="text-[var(--ca-gold)]" aria-hidden="true" /> {insight}
        </p>
      )}
    </section>
  );
}

function Kpi({ icon, label, value, tone = "text-ink" }: { icon: React.ReactNode; label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted">{icon} {label}</p>
      <p className={`mt-1 font-heading text-2xl font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <p className="text-sm text-muted">No attempts yet</p>;
  const w = 240, h = 44, pad = 4;
  const max = 100, min = 0;
  const pts = values.length === 1
    ? [[pad, h - pad - ((values[0] - min) / (max - min)) * (h - 2 * pad)], [w - pad, h - pad - ((values[0] - min) / (max - min)) * (h - 2 * pad)]]
    : values.map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
        return [x, y];
      });
  const d = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-full" preserveAspectRatio="none" role="img" aria-label="Recent accuracy trend">
      <polyline points={d} fill="none" stroke="var(--ca-gold)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={1.8} fill="var(--ca-gold)" />)}
    </svg>
  );
}

/* ----------------------- SUBJECT PERFORMANCE ----------------------- */
function SubjectPerformance({ subjects }: { subjects: PerformanceData["subjects"] }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 font-heading text-base font-bold"><BarChart3 size={17} className="text-[var(--ca-gold)]" /> Subject-wise performance</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {subjects.map((s) => {
          const tone = s.avgAccuracy >= 60 ? "bg-success" : s.avgAccuracy >= 40 ? "bg-amber-500" : "bg-danger";
          return (
            <div key={s.subject} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{s.subject}</p>
                <span className={`text-sm font-bold ${s.avgAccuracy >= 60 ? "text-success" : s.avgAccuracy >= 40 ? "text-amber-600" : "text-danger"}`}>{s.avgAccuracy}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface2">
                <div className={`h-full rounded-full ${tone} transition-all duration-500 motion-reduce:transition-none`} style={{ width: `${Math.min(100, s.avgAccuracy)}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>{s.attempts} test{s.attempts !== 1 ? "s" : ""} · {s.correct}✓ / {s.wrong}✗</span>
                <MiniTrend values={s.trend} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MiniTrend({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 56, h = 16;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / 100) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-4 w-14" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ----------------------- AVAILABLE QUIZZES ----------------------- */
function AvailableQuizzes({ quizzes }: { quizzes: PerformanceData["quizzes"] }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 font-heading text-base font-bold"><ListChecks size={17} className="text-[var(--ca-gold)]" /> Available quizzes &amp; tests</h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {quizzes.map((q) => (
          <li key={q.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {q.isNew && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304]"><Sparkles size={10} /> NEW</span>
              )}
              <span className={`pill text-[10px] ${q.isPaid ? "pill-amber" : "pill-green"}`}>{q.isPaid ? "Paid" : "Free"}</span>
              {q.subject && <span className="pill pill-blue text-[10px]">{q.subject}</span>}
              <span className="pill pill-gray text-[10px]">{q.category}</span>
            </div>
            <Link href={`/quizzes/${q.slug}`} className="mt-2 block">
              <p className="line-clamp-2 font-semibold leading-snug text-ink transition hover:text-primary">{q.title}</p>
            </Link>
            <div className="mt-3">
              {q.attempt ? (
                <QuizAttemptActions slug={q.slug} status={q.attempt} />
              ) : (
                <Link href={`/quizzes/${q.slug}`} className="btn btn-primary w-full justify-center text-sm">Attempt now →</Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------- ATTEMPT HISTORY ----------------------- */
type SortKey = "latest" | "oldest" | "score_high" | "score_low";

function AttemptHistory({ history }: { history: PerfHistoryRow[] }) {
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<SortKey>("latest");

  const subjects = useMemo(() => [...new Set(history.map((h) => h.subject).filter(Boolean))] as string[], [history]);
  const categories = useMemo(() => [...new Set(history.map((h) => h.category))], [history]);

  const rows = useMemo(() => {
    let list = [...history];
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((h) => h.title.toLowerCase().includes(needle));
    if (subject) list = list.filter((h) => h.subject === subject);
    if (category) list = list.filter((h) => h.category === category);
    const t = (h: PerfHistoryRow) => (h.dateISO ? Date.parse(h.dateISO) || 0 : 0);
    const pct = (h: PerfHistoryRow) => (h.maxScore ? h.score / h.maxScore : 0);
    list.sort((a, b) => {
      if (sort === "latest") return t(b) - t(a);
      if (sort === "oldest") return t(a) - t(b);
      if (sort === "score_high") return pct(b) - pct(a);
      return pct(a) - pct(b);
    });
    return list;
  }, [history, q, subject, category, sort]);

  return (
    <section>
      <h3 className="flex items-center gap-2 font-heading text-base font-bold"><FileText size={17} className="text-[var(--ca-gold)]" /> Attempt history</h3>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative flex items-center">
          <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests…" className="input min-h-[44px] w-full pl-9" aria-label="Search attempts" />
        </label>
        <select className="input min-h-[44px]" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Filter by subject">
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input min-h-[44px]" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input min-h-[44px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="latest">Latest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score_high">Highest score</option>
          <option value="score_low">Lowest score</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-line bg-surface2/40 p-8 text-center text-sm text-ink2">No attempts match these filters.</div>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((h) => (
            <li key={h.attemptId} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug text-ink">{h.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                    {h.subject && <span>{h.subject}</span>}
                    <span>· {h.category}</span>
                    {h.dateISO && <span>· {formatISTDate(h.dateISO)}</span>}
                    {h.timeTakenSeconds != null && <span>· {Math.floor(h.timeTakenSeconds / 60)}m {h.timeTakenSeconds % 60}s</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-heading text-lg font-extrabold">{h.score}<span className="text-sm text-muted"> / {h.maxScore}</span></p>
                  <p className={`text-xs font-semibold ${h.accuracy >= 60 ? "text-success" : h.accuracy >= 40 ? "text-amber-600" : "text-danger"}`}>{h.accuracy}% accuracy</p>
                </div>
              </div>
              <div className="mt-3">
                {h.reviewable && h.slug ? (
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/quizzes/${h.slug}/result/${h.attemptId}`} className="btn btn-secondary text-sm"><FileText size={14} /> View report</Link>
                    <a href={`/quiz-print/${h.attemptId}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm"><Download size={14} /> Download PDF</a>
                  </div>
                ) : (
                  <p className="text-xs text-muted">Full question-wise review isn&apos;t available for this older attempt — score is saved above.</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
