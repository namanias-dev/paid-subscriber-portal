"use client";

import { Card, Skeleton, useApi, inr } from "@/components/kit";
import { useDrill } from "@/components/drill/DrillProvider";
import type { DailyBrief } from "@/lib/revenue/dailyBrief";

export default function Brief() {
  const { data, error, loading } = useApi<{ brief: DailyBrief }>("/api/brief");
  const { openDrill } = useDrill();

  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error || !data) return <Card><p className="text-danger">Could not load brief: {error}</p></Card>;

  const b = data.brief;
  const t = b.tower;

  const cards: { label: string; value: string; hint?: string; metric: string }[] = [
    { label: "Collected", value: inr(t.collected), hint: "last 30d records", metric: "revenue:recentpaid" },
    { label: "Outstanding", value: inr(t.outstanding), metric: "revenue:overdue" },
    { label: "Overdue", value: inr(t.overdueTotal.amount), hint: `${t.overdueTotal.count} lines`, metric: "revenue:overdue" },
    { label: "At-risk", value: inr(t.atRiskRevenue), hint: "overdue + abandoned", metric: "revenue:atrisk" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white md:text-3xl">
          Good day, {b.greetingName}.
        </h1>
        <p className="text-sm text-muted">{b.dateLabel} · Read-only CEO brief · tap a number to see the records</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            className="aiva-kpi aiva-kpi-clickable text-left"
            onClick={() => openDrill({ domain: "revenue", metric: c.metric, label: c.label })}
            aria-label={`Show records behind ${c.label}`}
          >
            <div className="aiva-label">{c.label} <span className="aiva-kpi-drill" aria-hidden>↗</span></div>
            <div className="mt-1 font-heading text-2xl font-bold text-white">{c.value}</div>
            {c.hint ? <div className="mt-0.5 text-xs text-muted">{c.hint}</div> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
