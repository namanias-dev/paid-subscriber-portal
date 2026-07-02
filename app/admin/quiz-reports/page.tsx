"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader, KpiCard, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";

interface Overview { totalAttempts: number; completedAttempts: number; abandoned: number; completionRate: number; avgScore: number; leadCaptures: number; publishedQuizzes: number }
interface HardQuestion { id: string; text: string; wrongRate: number; wrong: number; total: number; options: Record<string, string | null> | null; correct_option: string | null; subject: string | null; topic: string | null }
interface Report {
  overview: Overview;
  mostAttempted: { id: string; title: string; slug: string; count: number }[];
  hardestQuestions: HardQuestion[];
  topPerformers: { name: string; score: number; max: number; accuracy: number; quiz: string }[];
  topicAverages: { label: string; accuracy: number; total: number }[];
  quizzes: { id: string; title: string }[];
}

type CardKey = "mostAttempted" | "hardest" | "performers" | "topics";
interface AttemptRow { id: string; name: string; mobile: string | null; email: string | null; loginCode?: string | null; isRegistered?: boolean; status: string; score: number; max_score: number; accuracy: number; time_taken_seconds: number | null; submitted_at: string | null }

function toCsv(rows: AttemptRow[]) {
  const head = ["Name", "Mobile", "Email", "LoginCode", "Registered", "Status", "Score", "Max", "Accuracy", "TimeSec", "SubmittedAt"];
  const body = rows.map((r) => [r.name, r.mobile || "", r.email || "", r.loginCode || "", r.isRegistered ? "Yes" : "No", r.status, r.score, r.max_score, r.accuracy, r.time_taken_seconds ?? "", r.submitted_at || ""]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [head.join(","), ...body].join("\n");
}

export default function QuizReportsAdmin() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [openCard, setOpenCard] = useState<CardKey | null>(null);
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
        <SectionCard title="Most attempted quizzes" count={report.mostAttempted.length} empty={report.mostAttempted.length === 0} emptyText="No attempts yet." onOpen={() => setOpenCard("mostAttempted")}>
          <div className="space-y-2">
            {report.mostAttempted.slice(0, 10).map((q) => (
              <div key={q.id} className="flex items-center justify-between text-sm">
                <span className="line-clamp-1">{q.title}</span>
                <span className="pill pill-blue">{q.count}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Hardest questions (most wrong)" count={report.hardestQuestions.length} empty={report.hardestQuestions.length === 0} emptyText="Not enough data." onOpen={() => setOpenCard("hardest")}>
          <div className="space-y-2">
            {report.hardestQuestions.slice(0, 10).map((q) => (
              <div key={q.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="line-clamp-1 flex-1">{q.text}</span>
                <span className="pill pill-red shrink-0">{q.wrongRate}% wrong</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Top performers" count={report.topPerformers.length} empty={report.topPerformers.length === 0} emptyText="No data." onOpen={() => setOpenCard("performers")}>
          <div className="space-y-2">
            {report.topPerformers.slice(0, 8).map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="line-clamp-1">{p.name} <span className="text-muted">· {p.quiz}</span></span>
                <span className="shrink-0 font-semibold text-success">{p.accuracy}%</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Topic-wise averages (weakest first)" count={report.topicAverages.length} empty={report.topicAverages.length === 0} emptyText="No data." onOpen={() => setOpenCard("topics")}>
          <div className="space-y-2">
            {report.topicAverages.slice(0, 12).map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="line-clamp-1">{t.label}</span>
                <span className={`shrink-0 ${t.accuracy >= 60 ? "text-success" : t.accuracy >= 40 ? "text-warning" : "text-danger"}`}>{t.accuracy}%</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <ReportDetailModal openCard={openCard} report={report} onClose={() => setOpenCard(null)} />

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
              <TableShell headers={["Name", "Mobile", "Login code", "Status", "Score", "Accuracy", "When"]}>
                {drill.attempts.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      {a.name}
                      {a.isRegistered
                        ? <span className="pill pill-green ml-2 text-[10px]">Registered</span>
                        : <span className="pill pill-gray ml-2 text-[10px]">Guest</span>}
                    </td>
                    <td className="px-4 py-3">{a.mobile || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{a.loginCode || "—"}</td>
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

/** Clickable analytics card — preserves the summary list, adds a "View all" affordance + detail view. */
function SectionCard({ title, count, empty, emptyText, onOpen, children }: {
  title: string; count: number; empty: boolean; emptyText: string; onOpen: () => void; children: React.ReactNode;
}) {
  if (empty) {
    return (
      <div className="card p-5">
        <h2 className="mb-3 font-heading text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card group w-full p-5 text-left transition hover:border-primary/30 hover:shadow-md"
      title={`View all ${count}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary opacity-80 transition group-hover:opacity-100">
          View all {count} <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      {children}
    </button>
  );
}

const CARD_TITLES: Record<CardKey, string> = {
  mostAttempted: "Most attempted quizzes",
  hardest: "Hardest questions (most wrong)",
  performers: "Top performers",
  topics: "Topic-wise averages (weakest first)",
};

/** Full detail view for a clicked analytics card — reuses already-fetched report data (no extra network call). */
function ReportDetailModal({ openCard, report, onClose }: { openCard: CardKey | null; report: Report; onClose: () => void }) {
  return (
    <Modal open={openCard !== null} onClose={onClose} title={openCard ? CARD_TITLES[openCard] : ""} maxWidth="max-w-3xl">
      <div className="animate-fade-up max-h-[74vh] overflow-y-auto">
        {openCard === "mostAttempted" && (
          <div className="space-y-1.5">
            {report.mostAttempted.map((q) => (
              <div key={q.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{q.title}</span>
                <span className="pill pill-blue shrink-0">{q.count} attempts</span>
              </div>
            ))}
          </div>
        )}

        {openCard === "hardest" && (
          <div className="space-y-3">
            {report.hardestQuestions.map((q, idx) => (
              <div key={q.id} className="rounded-xl border border-line p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="pill pill-gray">#{idx + 1}</span>
                    {q.subject && <span className="pill pill-blue">{q.subject}</span>}
                    {q.topic && <span className="pill pill-gray">{q.topic}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="pill pill-red">{q.wrongRate}% wrong</span>
                    <span className="text-muted">{q.wrong}/{q.total} wrong</span>
                  </div>
                </div>
                <p className="text-sm font-medium text-ink">{q.text || "(no question text)"}</p>
                {q.options && (
                  <ul className="mt-2 space-y-1">
                    {Object.entries(q.options).filter(([, v]) => v).map(([key, val]) => {
                      const isCorrect = q.correct_option === key;
                      return (
                        <li key={key} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${isCorrect ? "border-success/50 bg-success/10 text-ink" : "border-line text-ink2"}`}>
                          <span className="font-bold">{key}.</span>
                          <span className="min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: val || "" }} />
                          {isCorrect && <span className="ml-auto shrink-0 font-semibold text-success">Correct</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {openCard === "performers" && (
          <div className="space-y-1.5">
            {report.topPerformers.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="mr-2 text-xs font-bold text-muted">#{i + 1}</span>
                  {p.name} <span className="text-muted">· {p.quiz}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-semibold text-success">{p.accuracy}%</span>
                  <span className="ml-2 text-xs text-muted">{p.score}/{p.max}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {openCard === "topics" && (
          <div className="space-y-1.5">
            {report.topicAverages.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.label} <span className="text-xs text-muted">· {t.total} answers</span></span>
                <span className={`shrink-0 font-semibold ${t.accuracy >= 60 ? "text-success" : t.accuracy >= 40 ? "text-warning" : "text-danger"}`}>{t.accuracy}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
