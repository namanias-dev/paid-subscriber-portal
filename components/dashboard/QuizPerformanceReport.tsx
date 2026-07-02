"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, MinusCircle, Target, Clock, FileText, Download, AlertTriangle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";
import FilterTabs from "@/components/ui/FilterTabs";
import type { ResultPayload, ResultQuestion } from "@/lib/quizResult";

/**
 * In-hub Quiz Performance Report (read-only). Opens as a modal from Attempt
 * History and renders the SAME data the standalone result page uses — fetched
 * from the existing GET /api/public/quiz/result endpoint (no new network logic,
 * no change to quiz taking/scoring/submission). Adds premium summary stat cards
 * (score ring, accuracy, correct/incorrect/skipped) and a filterable per-question
 * breakdown with clear color semantics. Skeleton + empty state + entrance fade
 * are built in (Feature 5).
 */

type FilterKey = "all" | "correct" | "incorrect" | "skipped";

export default function QuizPerformanceReport({
  attemptId,
  open,
  onClose,
  slug,
  fallbackTitle,
}: {
  attemptId: string;
  open: boolean;
  onClose: () => void;
  slug?: string | null;
  fallbackTitle?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFilter("all");
    fetch(`/api/public/quiz/result?attemptId=${encodeURIComponent(attemptId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setResult(d.result as ResultPayload);
        else setError(d.error || "Could not load this report.");
      })
      .catch(() => !cancelled && setError("Could not load this report."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, attemptId]);

  const questions = result?.questions ?? [];
  const counts = useMemo(() => {
    const correct = questions.filter((q) => q.is_correct).length;
    const skipped = questions.filter((q) => q.is_unattempted).length;
    const incorrect = questions.filter((q) => !q.is_correct && !q.is_unattempted).length;
    return { correct, incorrect, skipped, total: questions.length };
  }, [questions]);

  const visible = useMemo(() => {
    if (filter === "correct") return questions.filter((q) => q.is_correct);
    if (filter === "incorrect") return questions.filter((q) => !q.is_correct && !q.is_unattempted);
    if (filter === "skipped") return questions.filter((q) => q.is_unattempted);
    return questions;
  }, [questions, filter]);

  const title = result?.quiz.title || fallbackTitle || "Performance report";

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-3xl">
      {loading ? (
        <ReportSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface2 px-6 py-12 text-center">
          <AlertTriangle size={26} className="mb-3 text-amber-500" aria-hidden="true" />
          <p className="font-heading text-lg text-ink">{error}</p>
          <p className="mt-1 max-w-xs text-sm text-ink2">This can happen for older attempts without a saved question-wise breakdown.</p>
        </div>
      ) : result ? (
        <div className="animate-fade-up space-y-5">
          <SummaryCards result={result} counts={counts} />

          <div>
            <FilterTabs
              options={[
                { id: "all", label: `All (${counts.total})` },
                { id: "correct", label: `Correct (${counts.correct})` },
                { id: "incorrect", label: `Incorrect (${counts.incorrect})` },
                { id: "skipped", label: `Skipped (${counts.skipped})` },
              ]}
              active={filter}
              onChange={(id) => setFilter(id as FilterKey)}
            />
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface2 px-6 py-10 text-center text-sm text-ink2">
              No questions in this category.
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((q) => <QuestionCard key={q.order} q={q} reveal={result.reveal} />)}
            </ul>
          )}

          {slug && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <a href={`/quizzes/${slug}/result/${attemptId}`} className="btn btn-secondary text-sm"><FileText size={14} /> Open full result page</a>
              <a href={`/quiz-print/${attemptId}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm"><Download size={14} /> Download PDF</a>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------ summary ------------------------------ */
function SummaryCards({ result, counts }: { result: ResultPayload; counts: { correct: number; incorrect: number; skipped: number; total: number } }) {
  const a = result.attempt;
  const time = a.time_taken_seconds != null ? `${Math.floor(a.time_taken_seconds / 60)}m ${a.time_taken_seconds % 60}s` : "—";
  return (
    <div className="grid gap-3 sm:grid-cols-[auto,1fr]">
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
        <ScoreRing accuracy={a.accuracy} />
        <div>
          <p className="text-xs text-muted">Score</p>
          <p className="font-heading text-2xl font-extrabold text-ink">{a.score}<span className="text-base text-muted"> / {a.max_score}</span></p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Clock size={12} /> {time}{a.rank != null ? ` · Rank ${a.rank}` : ""}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Target size={15} />} label="Accuracy" value={`${a.accuracy}%`} tone="text-primary" />
        <StatCard icon={<CheckCircle2 size={15} />} label="Correct" value={counts.correct} tone="text-success" />
        <StatCard icon={<XCircle size={15} />} label="Incorrect" value={counts.incorrect} tone="text-danger" />
        <StatCard icon={<MinusCircle size={15} />} label="Skipped" value={counts.skipped} tone="text-ink2" />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted">{icon} {label}</p>
      <p className={`mt-0.5 font-heading text-xl font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}

function ScoreRing({ accuracy }: { accuracy: number }) {
  const pct = Math.max(0, Math.min(100, accuracy));
  const r = 26, c = 2 * Math.PI * r;
  const stroke = pct >= 60 ? "var(--success)" : pct >= 40 ? "#f59e0b" : "var(--danger)";
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`Accuracy ${pct}%`} className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
      <circle
        cx="36" cy="36" r={r} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} transform="rotate(-90 36 36)"
        className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
      />
      <text x="36" y="40" textAnchor="middle" className="fill-ink font-heading" style={{ fontSize: 15, fontWeight: 800 }}>{pct}%</text>
    </svg>
  );
}

/* ------------------------------ question ------------------------------ */
function QuestionCard({ q, reveal }: { q: ResultQuestion; reveal: boolean }) {
  const state: FilterKey = q.is_correct ? "correct" : q.is_unattempted ? "skipped" : "incorrect";
  const border = state === "correct" ? "border-l-success" : state === "incorrect" ? "border-l-danger" : "border-l-ink2/30";
  const badge = state === "correct"
    ? <span className="pill pill-green"><CheckCircle2 size={12} /> Correct</span>
    : state === "incorrect"
      ? <span className="pill pill-red"><XCircle size={12} /> Incorrect</span>
      : <span className="pill pill-gray"><MinusCircle size={12} /> Skipped</span>;

  return (
    <li className={`rounded-2xl border border-line border-l-[3px] bg-surface p-4 ${border}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold text-muted">Q{q.order}</p>
        <div className="flex items-center gap-2">
          {badge}
          <span className="text-xs font-semibold text-muted">{q.marks_awarded > 0 ? `+${q.marks_awarded}` : q.negative_marks_deducted > 0 ? `−${q.negative_marks_deducted}` : "0"}</span>
        </div>
      </div>
      <div className="prose-quiz mt-1 text-sm text-ink [&_img]:max-w-full" dangerouslySetInnerHTML={{ __html: q.question_html }} />
      {q.question_image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.question_image} alt="" className="mt-2 max-h-64 rounded-lg border border-line" />
      )}
      <ul className="mt-3 space-y-1.5">
        {q.options.map((opt) => {
          const isCorrect = reveal && q.correct_option === opt.key;
          const isYours = q.your_option === opt.key;
          const wrongPick = isYours && !q.is_correct && !q.is_unattempted;
          const cls = isCorrect
            ? "border-success/50 bg-success/10 text-ink"
            : wrongPick
              ? "border-danger/50 bg-danger/10 text-ink"
              : "border-line bg-surface2/50 text-ink2";
          return (
            <li key={opt.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
              <span className="font-bold">{opt.key}.</span>
              <span className="min-w-0 flex-1 [&_img]:max-w-full" dangerouslySetInnerHTML={{ __html: opt.html }} />
              <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] font-semibold">
                {isYours && <span className={wrongPick ? "text-danger" : "text-success"}>Your answer</span>}
                {isCorrect && !isYours && <span className="text-success">Correct</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {q.explanation_html && (
        <details className="group mt-3 rounded-lg border border-line bg-surface2/40 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-primary">Explanation</summary>
          <div className="prose-quiz mt-2 text-sm text-ink2 [&_img]:max-w-full" dangerouslySetInnerHTML={{ __html: q.explanation_html }} />
        </details>
      )}
    </li>
  );
}

/* ------------------------------ skeleton ------------------------------ */
function ReportSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-[auto,1fr]">
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
          <Skeleton className="h-[72px] w-[72px] rounded-full" height={72} />
          <div className="space-y-2">
            <Skeleton className="w-16" height={12} />
            <Skeleton className="w-24" height={22} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-3">
              <Skeleton className="mb-2 w-14" height={11} />
              <Skeleton className="w-10" height={20} />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="w-full" height={34} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-4">
          <Skeleton className="mb-3 w-2/3" height={14} />
          <Skeleton className="mb-2 w-full" height={30} />
          <Skeleton className="w-full" height={30} />
        </div>
      ))}
    </div>
  );
}
