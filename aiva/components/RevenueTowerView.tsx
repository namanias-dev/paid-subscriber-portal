"use client";

import { Card, Kpi, SectionTitle, Skeleton, useApi, inr } from "@/components/kit";
import type { RevenueTower } from "@/lib/revenue/tower";

export default function RevenueTowerView() {
  const { data, error, loading } = useApi<{ tower: RevenueTower }>("/api/revenue");
  if (loading) return <Skeleton lines={6} />;
  if (error || !data) return <Card><p className="text-danger">Could not load revenue: {error}</p></Card>;
  const t = data.tower;

  const buckets: { label: string; count: number; amount: number; tone: string }[] = [
    { label: "Due today", count: t.dueToday.count, amount: t.dueToday.amount, tone: "border-line" },
    { label: "Overdue 1–3 days", count: t.overdue1_3.count, amount: t.overdue1_3.amount, tone: "border-warning/40" },
    { label: "Overdue 4–7 days", count: t.overdue4_7.count, amount: t.overdue4_7.amount, tone: "border-warning/50" },
    { label: "Overdue 8+ days", count: t.overdue8plus.count, amount: t.overdue8plus.amount, tone: "border-danger/50" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Collected" value={inr(t.collected)} hint={`${t.paidCount} paid rows`} />
        <Kpi label="Outstanding" value={inr(t.outstanding)} hint={`${t.activeEnrollments} active enrollments`} />
        <Kpi label="Expected" value={inr(t.expected)} />
        <Kpi label="At-risk" value={inr(t.atRiskRevenue)} />
      </div>

      <Card>
        <SectionTitle sub="Overdue is computed from active enrollment schedules — the per-course source of truth.">
          Installment health
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.label} className={`rounded-xl border ${b.tone} bg-navy-700/30 p-4`}>
              <div className="aiva-label">{b.label}</div>
              <div className="mt-1 font-heading text-xl font-bold text-white">{inr(b.amount)}</div>
              <div className="text-xs text-muted">{b.count} installment(s)</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi label="Proofs pending review" value={String(t.proofsPending)} />
        <Kpi label="Abandoned checkouts" value={inr(t.abandoned.amount)} hint={`${t.abandoned.count} checkouts`} />
        <Kpi label="Paid without enrollment" value={String(t.paidWithoutActiveEnrollment)} hint="review for access gaps" />
      </div>

      <p className="text-xs text-muted">
        Reconciliation reuses the portal&apos;s own primitives (isPaidStatus, dedupePaidRows, deriveEnrollment). No reminders
        are sent and no records are modified — this is a read-only tower.
      </p>
    </div>
  );
}
