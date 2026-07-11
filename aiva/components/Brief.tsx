"use client";

import { Card, Kpi, SectionTitle, SeverityPill, Skeleton, useApi, inr } from "@/components/kit";
import type { DailyBrief } from "@/lib/revenue/dailyBrief";

export default function Brief() {
  const { data, error, loading } = useApi<{ brief: DailyBrief }>("/api/brief");

  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error || !data) return <Card><p className="text-danger">Could not load brief: {error}</p></Card>;

  const b = data.brief;
  const t = b.tower;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white md:text-3xl">
          Good day, {b.greetingName}.
        </h1>
        <p className="text-sm text-muted">{b.dateLabel} · Read-only CEO brief</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Collected" value={inr(t.collected)} />
        <Kpi label="Outstanding" value={inr(t.outstanding)} />
        <Kpi label="Overdue" value={inr(t.overdueTotal.amount)} hint={`${t.overdueTotal.count} lines`} />
        <Kpi label="At-risk" value={inr(t.atRiskRevenue)} hint="overdue + abandoned" />
      </div>

      <Card>
        <SectionTitle sub="Deterministic — computed from reconciled payment truth.">What needs your attention</SectionTitle>
        <ul className="space-y-2">
          {b.attention.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 rounded-xl border p-3 ${sevBox(a.severity)}`}>
              <SeverityPill severity={a.severity} />
              <div>
                <div className="font-semibold text-white">{a.title}</div>
                <div className="text-sm text-muted">{a.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function sevBox(sev: string): string {
  if (sev === "high") return "border-danger/40 bg-danger/5";
  if (sev === "medium") return "border-warning/40 bg-warning/5";
  return "border-line bg-navy-700/30";
}
