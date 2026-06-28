"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { METRICS } from "@/lib/analytics/metrics";
import { Stat, SectionCard, EmptyState, nf } from "./Shared";

interface Activity { metrics: Record<string, number>; notTracked: { label: string; note: string }[] }

export default function ActivityTab({ qs }: { qs: string }) {
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/student-activity?${qs}`).then((r) => r.json())
      .then((d) => setData(d.ok ? d.activity : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [qs]);

  if (loading) return <div className="space-y-4"><LoadingBlock /></div>;
  if (!data) return <SectionCard title="Student activity"><EmptyState>No activity in this range yet.</EmptyState></SectionCard>;
  const m = data.metrics;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat def={METRICS.loggedInStudents} value={nf(m.loggedInStudents)} />
        <Stat def={METRICS.viewedDashboard} value={nf(m.viewedDashboard)} />
        <Stat def={METRICS.attemptedQuiz} value={nf(m.attemptedQuiz)} />
        <Stat def={METRICS.startedQuizNotSubmitted} value={nf(m.startedQuizNotSubmitted)} tone="amber" />
        <Stat def={METRICS.paidNotLoggedIn} value={nf(m.paidNotLoggedIn)} tone="red" />
        <Stat def={METRICS.loggedInNoStudy} value={nf(m.loggedInNoStudy)} tone="amber" />
      </div>

      {data.notTracked.length > 0 && (
        <SectionCard title="Not tracked yet">
          <ul className="space-y-2 text-sm text-ink2">
            {data.notTracked.map((n) => (
              <li key={n.label} className="flex gap-2">
                <Info size={15} className="mt-0.5 shrink-0 text-muted" />
                <span><span className="font-semibold text-ink">{n.label}:</span> {n.note}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
