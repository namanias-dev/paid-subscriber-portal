"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { METRICS } from "@/lib/analytics/metrics";
import { Stat, SectionCard, EmptyState, nf, pctStr } from "./Shared";

interface QuizInsights {
  totals: { attempts: number; uniqueTakers: number; finished: number; inProgress: number; abandoned: number; submitRate: number | null; avgScorePct: number | null; avgAccuracy: number | null; guestAttempts: number; userAttempts: number };
  topQuizzes: { quizId: string; title: string; attempts: number; finished: number; submitRate: number | null; avgScorePct: number | null }[];
}

export default function QuizTab({ qs }: { qs: string }) {
  const [data, setData] = useState<QuizInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/quiz?${qs}`).then((r) => r.json())
      .then((d) => setData(d.ok ? d.quiz : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [qs]);

  if (loading) return <div className="space-y-4"><LoadingBlock /></div>;
  if (!data) return <SectionCard title="Quiz insights"><EmptyState>No quiz attempts in this range yet.</EmptyState></SectionCard>;
  const t = data.totals;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat def={METRICS.quizAttempts} value={nf(t.attempts)} hint={`${nf(t.guestAttempts)} guest · ${nf(t.userAttempts)} logged-in`} />
        <Stat def={METRICS.uniqueTakers} value={nf(t.uniqueTakers)} />
        <Stat def={METRICS.quizSubmitRate} value={pctStr(t.submitRate)} hint={`${nf(t.finished)} finished · ${nf(t.inProgress)} in progress · ${nf(t.abandoned)} abandoned`} />
        <Stat def={METRICS.avgScorePct} value={t.avgScorePct === null ? "N/A" : `${t.avgScorePct}%`} hint={t.avgAccuracy === null ? undefined : `${t.avgAccuracy}% accuracy`} tone="green" />
      </div>

      <SectionCard title="Top quizzes by attempts">
        {data.topQuizzes.length === 0 ? <EmptyState>No quiz attempts in this range.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2">Quiz</th>
                  <th className="px-2 py-2 text-right">Attempts</th>
                  <th className="px-2 py-2 text-right">Finished</th>
                  <th className="px-2 py-2 text-right">Submit rate</th>
                  <th className="py-2 pl-2 text-right">Avg score</th>
                </tr>
              </thead>
              <tbody>
                {data.topQuizzes.map((q) => (
                  <tr key={q.quizId} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-2 font-medium text-ink">{q.title}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(q.attempts)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(q.finished)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pctStr(q.submitRate)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{q.avgScorePct === null ? "N/A" : `${q.avgScorePct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
