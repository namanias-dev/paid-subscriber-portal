"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface QuizRow {
  id: string; title: string; slug: string; subject: string | null; topic: string | null;
  difficulty: string; type: string; time_limit_minutes: number | null;
  requires_payment: boolean; accessible: boolean; access_reason: string | null;
  attempts: number; best_score: number | null; in_progress: boolean;
}
interface Analytics { totalAttempts: number; avgScore: number; avgAccuracy: number; bestScore: number; weakAreas: { label: string; accuracy: number }[] }
interface RecentRow { attemptId: string; slug: string; title: string; score: number; max_score: number; accuracy: number; submitted_at: string | null }

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4 text-center">
      <p className="font-heading text-2xl font-extrabold text-primary">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

export default function StudentQuizzes() {
  const [data, setData] = useState<{ quizzes: QuizRow[]; analytics: Analytics; recent: RecentRow[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/quiz/dashboard")
      .then((r) => r.json())
      .then((d) => setData(d.ok ? d : null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-16 text-center text-muted">Loading…</div>;
  if (!data) return <div className="card p-10 text-center text-muted">Please log in to view your quizzes.</div>;

  const available = data.quizzes.filter((q) => q.accessible && !q.in_progress);
  const inProgress = data.quizzes.filter((q) => q.in_progress);
  const locked = data.quizzes.filter((q) => !q.accessible);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Quizzes & MCQ Practice</h1>
        <p className="text-sm text-muted">UPSC Prelims-style practice tests with instant analysis.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Attempts" value={data.analytics.totalAttempts} />
        <Metric label="Avg score" value={data.analytics.avgScore} />
        <Metric label="Avg accuracy" value={`${data.analytics.avgAccuracy}%`} />
        <Metric label="Best score" value={data.analytics.bestScore} />
      </div>

      {data.analytics.weakAreas.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Focus areas (weakest topics)</h2>
          <div className="flex flex-wrap gap-2">
            {data.analytics.weakAreas.map((w) => (
              <span key={w.label} className="pill pill-amber">{w.label} · {w.accuracy}%</span>
            ))}
          </div>
        </div>
      )}

      {inProgress.length > 0 && (
        <Section title="Resume in-progress">
          {inProgress.map((q) => <QuizCard key={q.id} q={q} cta="Resume" />)}
        </Section>
      )}

      <Section title="Available tests">
        {available.length === 0 ? <p className="text-sm text-muted">No tests available right now.</p> : available.map((q) => <QuizCard key={q.id} q={q} cta="Start" />)}
      </Section>

      {locked.length > 0 && (
        <Section title="Unlock with enrollment">
          {locked.map((q) => <QuizCard key={q.id} q={q} cta="Locked" />)}
        </Section>
      )}

      {data.recent.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Recent attempts</h2>
          <div className="space-y-2">
            {data.recent.map((r) => (
              <Link key={r.attemptId} href={`/dashboard/quizzes/${r.slug}/result/${r.attemptId}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-surface2">
                <span className="font-medium">{r.title}</span>
                <span className="text-muted">{r.score}/{r.max_score} · {r.accuracy}%</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-heading text-lg font-bold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function QuizCard({ q, cta }: { q: QuizRow; cta: "Start" | "Resume" | "Locked" }) {
  const locked = cta === "Locked";
  const Inner = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {q.subject && <span className="pill pill-blue">{q.subject}</span>}
        <span className="pill pill-gray">{q.difficulty}</span>
        {q.requires_payment && <span className="pill pill-amber">Paid</span>}
      </div>
      <h3 className="font-heading text-base font-bold leading-snug">{q.title}</h3>
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
        {q.time_limit_minutes ? <span>⏱ {q.time_limit_minutes}m</span> : <span>Untimed</span>}
        {q.attempts > 0 && <span>Attempts: {q.attempts}</span>}
        {q.best_score != null && <span>Best: {q.best_score}</span>}
      </div>
      <span className={`btn mt-4 w-full text-sm ${locked ? "btn-secondary opacity-70" : "btn-primary"}`}>{locked ? "Locked" : cta + " →"}</span>
    </>
  );
  if (locked) return <div className="card p-5">{Inner}</div>;
  return <Link href={`/dashboard/quizzes/${q.slug}`} className="card p-5 transition hover:shadow-lg">{Inner}</Link>;
}
