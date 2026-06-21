"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ResultData {
  quiz: { id: string; title: string; slug: string; subject: string | null; marks_per_question: number };
  attempt: {
    id: string; status: string; score: number; max_score: number;
    correct_count: number; incorrect_count: number; unattempted_count: number;
    accuracy: number; negative_marks: number; time_taken_seconds: number | null;
    percentile: number | null; rank: number | null; submitted_at: string | null; student_name: string | null;
  };
  settings: Record<string, boolean | undefined>;
  reveal: boolean;
  topic_breakdown: { label: string; subject: string | null; correct: number; incorrect: number; total: number }[];
  subject_breakdown: { label: string; subject: string | null; correct: number; incorrect: number; total: number }[];
  questions: {
    order: number; question_html: string; question_image: string | null;
    options: { key: string; html: string }[];
    your_option: string | null; correct_option: string | null;
    is_correct: boolean; is_unattempted: boolean; explanation_html: string | null;
    subject: string | null; topic: string | null;
    marks_awarded: number; negative_marks_deducted: number;
  }[];
  disclaimer: string;
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="card p-4 text-center">
      <p className={`font-heading text-2xl font-extrabold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

export default function ResultView({
  apiBase,
  attemptId,
  retakeHref,
  dashboardHref,
  printHref,
  whatsappHref,
}: {
  apiBase: string;
  attemptId: string;
  retakeHref?: string;
  dashboardHref?: string;
  printHref?: string;
  whatsappHref?: string;
}) {
  const [data, setData] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/result?attemptId=${attemptId}`)
      .then((r) => r.json())
      .then((d) => setData(d.ok ? d.result : null))
      .finally(() => setLoading(false));
  }, [apiBase, attemptId]);

  if (loading) return <div className="container-narrow py-20 text-center text-muted">Loading result…</div>;
  if (!data) return <div className="container-narrow py-20 text-center text-muted">Result not found or access denied.</div>;

  const { attempt, settings, quiz } = data;
  const pct = attempt.max_score ? Math.round((attempt.score / attempt.max_score) * 100) : 0;
  const showScore = settings.show_score !== false;

  return (
    <div className="container-wide py-8">
      <div className="mb-6">
        <Link href="/quizzes" className="text-sm text-primary">← All Quizzes</Link>
        <h1 className="mt-2 font-heading text-2xl font-extrabold sm:text-3xl">{quiz.title}</h1>
        <p className="text-sm text-muted">Result {attempt.student_name ? `· ${attempt.student_name}` : ""}{attempt.status === "AUTO_SUBMITTED" ? " · auto-submitted (time up)" : ""}</p>
      </div>

      {showScore && (
        <div className="card mb-6 flex flex-col items-center gap-6 p-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-5">
            <div
              className="grid h-28 w-28 place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--primary) ${pct * 3.6}deg, var(--surface2) 0deg)` }}
            >
              <div className="grid h-20 w-20 place-items-center rounded-full bg-white">
                <span className="font-heading text-xl font-extrabold">{pct}%</span>
              </div>
            </div>
            <div>
              <p className="font-heading text-3xl font-extrabold">{attempt.score} <span className="text-lg text-muted">/ {attempt.max_score}</span></p>
              <p className="text-sm text-muted">Accuracy {attempt.accuracy}%{attempt.time_taken_seconds != null ? ` · ${Math.floor(attempt.time_taken_seconds / 60)}m ${attempt.time_taken_seconds % 60}s` : ""}</p>
              {settings.show_rank_percentile !== false && (attempt.percentile != null || attempt.rank != null) && (
                <p className="mt-1 text-sm font-semibold text-primary">{attempt.percentile != null ? `Percentile ${attempt.percentile}` : ""}{attempt.rank != null ? ` · Rank #${attempt.rank}` : ""}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {printHref && settings.show_pdf_download !== false && <a href={printHref} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm">⬇ Download PDF</a>}
            {retakeHref && <Link href={retakeHref} className="btn btn-secondary text-sm">↻ Retake</Link>}
            {dashboardHref && <Link href={dashboardHref} className="btn btn-secondary text-sm">Dashboard</Link>}
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Correct" value={attempt.correct_count} tone="text-success" />
        <StatCard label="Incorrect" value={attempt.incorrect_count} tone="text-danger" />
        <StatCard label="Unattempted" value={attempt.unattempted_count} tone="text-ink2" />
        <StatCard label="Negative marks" value={`-${attempt.negative_marks}`} tone="text-warning" />
      </div>

      {settings.show_topic_analysis !== false && data.topic_breakdown.length > 0 && (
        <div className="card mb-6 overflow-x-auto p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Topic-wise performance</h2>
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase text-muted"><th className="py-2">Topic</th><th>Subject</th><th>Correct</th><th>Total</th><th>Accuracy</th></tr></thead>
            <tbody>
              {data.topic_breakdown.map((t) => {
                const acc = t.correct + t.incorrect ? Math.round((t.correct / (t.correct + t.incorrect)) * 100) : 0;
                return (
                  <tr key={t.label} className="border-b border-line last:border-0">
                    <td className="py-2 font-medium">{t.label}</td>
                    <td>{t.subject || "—"}</td>
                    <td>{t.correct}</td>
                    <td>{t.total}</td>
                    <td><span className={acc >= 60 ? "text-success" : acc >= 40 ? "text-warning" : "text-danger"}>{acc}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.reveal && settings.show_correct_answers !== false && (
        <div className="card p-5">
          <h2 className="mb-4 font-heading text-lg font-bold">Answer review</h2>
          <div className="space-y-2">
            {data.questions.map((qq, i) => {
              const isOpen = open === i;
              const badge = qq.is_unattempted ? "bg-surface2 text-ink2" : qq.is_correct ? "bg-success text-white" : "bg-danger text-white";
              return (
                <div key={i} className="rounded-xl border border-line">
                  <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center gap-3 p-3.5 text-left">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge}`}>{qq.order}</span>
                    <span className="quiz-rich flex-1 text-sm" dangerouslySetInnerHTML={{ __html: qq.question_html }} />
                    <span className="text-xs text-muted">{qq.is_unattempted ? "Skipped" : qq.is_correct ? `+${qq.marks_awarded}` : `-${qq.negative_marks_deducted}`}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-line p-3.5 text-sm">
                      <div className="space-y-1.5">
                        {qq.options.map((o) => {
                          const isCorrect = o.key === qq.correct_option;
                          const isYours = o.key === qq.your_option;
                          return (
                            <div key={o.key} className={`flex gap-2 rounded-lg px-3 py-2 ${isCorrect ? "bg-success/10" : isYours ? "bg-danger/10" : ""}`}>
                              <span className="font-bold">{o.key}.</span>
                              <span className="quiz-rich flex-1" dangerouslySetInnerHTML={{ __html: o.html }} />
                              {isCorrect && <span className="text-xs font-semibold text-success">Correct</span>}
                              {isYours && !isCorrect && <span className="text-xs font-semibold text-danger">Your answer</span>}
                            </div>
                          );
                        })}
                      </div>
                      {qq.explanation_html && (
                        <div className="mt-3 rounded-lg bg-surface p-3">
                          <p className="mb-1 text-xs font-semibold uppercase text-muted">Explanation</p>
                          <div className="quiz-rich text-sm" dangerouslySetInnerHTML={{ __html: qq.explanation_html }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card mt-6 flex flex-col items-center gap-3 bg-primary/5 p-6 text-center">
        <h3 className="font-heading text-lg font-bold">Keep practising with Naman IAS Academy</h3>
        <div className="flex flex-wrap justify-center gap-2">
          {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Join WhatsApp Group</a>}
          <Link href="/courses" className="btn btn-secondary">Explore Courses</Link>
          <Link href="/quizzes" className="btn btn-ghost">More Quizzes</Link>
        </div>
      </div>

      <div className="mt-8 border-t border-line pt-5 text-center text-sm text-ink2">
        <p className="font-heading font-bold text-ink">NAMAN SHARMA IAS ACADEMY</p>
        <p className="mt-1">Address: SCO 173-174, Sec-17C, Chandigarh</p>
        <p>Call/WhatsApp: +91-843-768-6541</p>
      </div>
    </div>
  );
}
