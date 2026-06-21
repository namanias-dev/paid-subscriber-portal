"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, KpiCard, LoadingBlock, TableShell } from "@/components/admin/ui";

interface Overview { totalAttempts: number; completedAttempts: number; abandoned: number; completionRate: number; avgScore: number; leadCaptures: number; publishedQuizzes: number }
interface Report {
  overview: Overview;
  mostAttempted: { id: string; title: string; slug: string; count: number }[];
  hardestQuestions: { id: string; text: string; wrongRate: number; total: number }[];
  topPerformers: { name: string; score: number; max: number; accuracy: number; quiz: string }[];
  topicAverages: { label: string; accuracy: number; total: number }[];
  quizzes: { id: string; title: string }[];
}
interface AttemptRow { id: string; name: string; mobile: string | null; email: string | null; status: string; score: number; max_score: number; accuracy: number; time_taken_seconds: number | null; submitted_at: string | null }

function toCsv(rows: AttemptRow[]) {
  const head = ["Name", "Mobile", "Email", "Status", "Score", "Max", "Accuracy", "TimeSec", "SubmittedAt"];
  const body = rows.map((r) => [r.name, r.mobile || "", r.email || "", r.status, r.score, r.max_score, r.accuracy, r.time_taken_seconds ?? "", r.submitted_at || ""]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [head.join(","), ...body].join("\n");
}

export default function QuizReportsAdmin() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [quizId, setQuizId] = useState("");
  const [drill, setDrill] = useState<{ attempts: AttemptRow[]; analytics: { totalAttempts: number; completed: number; avgScore: number; avgAccuracy: number } } | null>(null);

  useEffect(() => {
    fetch("/api/admin/quiz-reports").then((r) => r.json()).then((d) => setReport(d.ok ? d : null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!quizId) { setDrill(null); return; }
    fetch(`/api/admin/quiz-reports?quizId=${quizId}`).then((r) => r.json()).then((d) => setDrill(d.ok ? d : null));
  }, [quizId]);

  function exportCsv() {
    if (!drill) return;
    const blob = new Blob([toCsv(drill.attempts)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `quiz-attempts-${quizId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingBlock />;
  if (!report) return <div className="card p-10 text-center text-muted">No report data.</div>;

  const o = report.overview;

  return (
    <div>
      <PageHeader title="Attempts & Reports" subtitle="Quiz performance analytics across the platform." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Attempts" value={o.totalAttempts} />
        <KpiCard label="Completed" value={o.completedAttempts} tone="green" />
        <KpiCard label="Completion" value={`${o.completionRate}%`} tone="blue" />
        <KpiCard label="Abandoned" value={o.abandoned} tone="amber" />
        <KpiCard label="Avg score" value={o.avgScore} />
        <KpiCard label="Leads captured" value={o.leadCaptures} tone="green" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Most attempted quizzes</h2>
          {report.mostAttempted.length === 0 ? <p className="text-sm text-muted">No attempts yet.</p> : (
            <div className="space-y-2">
              {report.mostAttempted.map((q) => (
                <div key={q.id} className="flex items-center justify-between text-sm">
                  <span className="line-clamp-1">{q.title}</span>
                  <span className="pill pill-blue">{q.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Hardest questions (most wrong)</h2>
          {report.hardestQuestions.length === 0 ? <p className="text-sm text-muted">Not enough data.</p> : (
            <div className="space-y-2">
              {report.hardestQuestions.map((q) => (
                <div key={q.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="line-clamp-1 flex-1">{q.text}</span>
                  <span className="pill pill-red">{q.wrongRate}% wrong</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Top performers</h2>
          {report.topPerformers.length === 0 ? <p className="text-sm text-muted">No data.</p> : (
            <div className="space-y-2">
              {report.topPerformers.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{p.name} <span className="text-muted">· {p.quiz}</span></span>
                  <span className="font-semibold text-success">{p.accuracy}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-heading text-lg font-bold">Topic-wise averages (weakest first)</h2>
          {report.topicAverages.length === 0 ? <p className="text-sm text-muted">No data.</p> : (
            <div className="space-y-2">
              {report.topicAverages.slice(0, 12).map((t) => (
                <div key={t.label} className="flex items-center justify-between text-sm">
                  <span>{t.label}</span>
                  <span className={t.accuracy >= 60 ? "text-success" : t.accuracy >= 40 ? "text-warning" : "text-danger"}>{t.accuracy}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card mt-8 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold">Per-quiz attempts</h2>
          <div className="flex gap-2">
            <select className="input max-w-xs" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
              <option value="">Select a quiz…</option>
              {report.quizzes.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
            {drill && <button onClick={exportCsv} className="btn btn-secondary text-sm">⬇ CSV</button>}
          </div>
        </div>

        {drill && (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="pill pill-gray">Attempts {drill.analytics.totalAttempts}</span>
              <span className="pill pill-green">Completed {drill.analytics.completed}</span>
              <span className="pill pill-blue">Avg {drill.analytics.avgScore}</span>
              <span className="pill pill-blue">Acc {drill.analytics.avgAccuracy}%</span>
            </div>
            {drill.attempts.length === 0 ? <p className="text-sm text-muted">No attempts.</p> : (
              <TableShell headers={["Name", "Mobile", "Status", "Score", "Accuracy", "When"]}>
                {drill.attempts.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">{a.name}</td>
                    <td className="px-4 py-3">{a.mobile || "—"}</td>
                    <td className="px-4 py-3"><span className="pill pill-gray">{a.status}</span></td>
                    <td className="px-4 py-3">{a.score}/{a.max_score}</td>
                    <td className="px-4 py-3">{a.accuracy}%</td>
                    <td className="px-4 py-3 text-muted">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString("en-IN") : "—"}</td>
                  </tr>
                ))}
              </TableShell>
            )}
          </>
        )}
        {!drill && <p className="text-sm text-muted">Choose a quiz to view individual attempts and export CSV.</p>}
      </div>

      <p className="mt-6 text-xs text-muted"><Link href="/admin/quizzes" className="text-primary">← Manage quizzes</Link></p>
    </div>
  );
}
